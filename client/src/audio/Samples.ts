import { ASSET_PATHS } from '../config/assets.js';
import { logger } from '../util/logger.js';

const SCOPE = 'Samples';

/** The recorded effects in `assets/audio/`. */
type SampleName = 'jump' | 'death' | 'walk' | 'win' | 'siuu';

/** The one-shots - everything except the footstep loop. */
type OneShot = Exclude<SampleName, 'walk'>;

const SAMPLE_PATHS: Readonly<Record<SampleName, string>> = {
  jump: ASSET_PATHS.jumpSound,
  death: ASSET_PATHS.deathSound,
  walk: ASSET_PATHS.walkSound,
  win: ASSET_PATHS.winSound,
  siuu: ASSET_PATHS.siuuSound,
};

/**
 * Mix level of each sample against the synthesised effects.
 *
 * Set by ear against each file's own loudness: the crowd cheer peaks at full
 * scale while "sui" is recorded at under half of it, so the cheer is brought
 * down and the voice left at full level to sit together in the mix.
 */
const LEVEL: Readonly<Record<SampleName, number>> = {
  jump: 0.7,
  death: 0.85,
  walk: 0.45,
  win: 0.55,
  siuu: 1,
};

/**
 * Shortest gap between two plays of a one-shot, in seconds.
 *
 * The callers already fire on one-shot EDGES; this only stops two edges a
 * frame apart stacking into one doubled, louder copy.
 */
const ONE_SHOT_COOLDOWN: Readonly<Record<OneShot, number>> = {
  jump: 0.08,
  death: 0.5,
  win: 0.3,
  siuu: 0.05,
};

/**
 * One-shots that only ever sound ONE copy at a time: a new play fades the
 * previous one out rather than layering over it.
 *
 * Both are long - the cheer 4.4s, "sui" 2.2s - against events that can come
 * much faster: a chain of flips lands several a second, and Wins can bank
 * back to back. Layered, a chain would be a wall of overlapping voices; as
 * one voice it reads "si-si-SIUUU", each flip cutting in on the last.
 */
const MONOPHONIC: ReadonlySet<OneShot> = new Set(['win', 'siuu']);

/** How fast a cut-off copy of a monophonic sample fades, in seconds. */
const CUT_FADE = 0.06;

/** Fade on starting and stopping the footstep loop, so it never clicks. */
const WALK_FADE_IN = 0.04;
const WALK_FADE_OUT = 0.06;

/**
 * Semitones each flip in a chain raises the "SIUUU" by, and the ceiling on
 * that. A chain is the skill expression, so it should sound like one climbing;
 * capped low, because pitching a voice far moves it from excited to cartoon.
 */
const SIUU_CHAIN_STEP = 1;
const SIUU_CHAIN_MAX = 4;

/** A one-shot copy that is still sounding. */
interface Voice {
  readonly source: AudioBufferSourceNode;
  readonly gain: GainNode;
}

/**
 * The recorded sound effects: jump, death, the Win cheer, the "SIUUU" and
 * the footstep loop.
 *
 * Built by `AudioEngine` inside the gesture that starts audio, on the same
 * context and into the same master gain as the synthesised effects - so the
 * volume, mute and portal settings apply to these exactly as to everything
 * else. The files are small, so each is DECODED once into a buffer (unlike
 * the music, which is streamed) and every play is a cheap buffer source.
 *
 * Until a file has decoded, requests for it are simply silent - the game
 * never waits on audio.
 */
export class Samples {
  private readonly ctx: AudioContext;
  private readonly bus: GainNode;
  private readonly buffers = new Map<SampleName, AudioBuffer>();
  private readonly lastPlayedAt = new Map<SampleName, number>();
  /** The sounding copy of each monophonic one-shot. */
  private readonly voices = new Map<OneShot, Voice>();

  /** The ONE footstep loop, while it plays. Never more than one. */
  private walkSource: AudioBufferSourceNode | null = null;
  private walkGain: GainNode | null = null;
  private disposed = false;

  constructor(ctx: AudioContext, destination: AudioNode) {
    this.ctx = ctx;
    this.bus = ctx.createGain();
    this.bus.connect(destination);
    for (const name of Object.keys(SAMPLE_PATHS) as SampleName[]) void this.load(name);
  }

  /** The player left the ground from a normal jump. */
  jump(): void {
    this.playOnce('jump');
  }

  /** The player died. */
  death(): void {
    this.playOnce('death');
  }

  /** Wins were banked: the crowd goes up. */
  win(): void {
    this.playOnce('win');
  }

  /**
   * A backflip started: "SIUUU".
   *
   * @param chainIndex 0 for the first flip of an airborne window, rising after
   *                   - each one is pitched a little higher, so a chain climbs.
   */
  siuu(chainIndex = 0): void {
    const steps = Math.min(Math.max(chainIndex, 0) * SIUU_CHAIN_STEP, SIUU_CHAIN_MAX);
    this.playOnce('siuu', 2 ** (steps / 12));
  }

  /**
   * Whether footsteps should be sounding right now.
   *
   * Idempotent - call it every frame. The loop is started once when this
   * turns true and faded out once when it turns false, so there is never a
   * restart per frame and never a second overlapping copy.
   */
  setWalking(walking: boolean): void {
    if (walking) this.startWalk();
    else this.stopWalk();
  }

  dispose(): void {
    this.disposed = true;
    this.stopWalk();
    for (const voice of this.voices.values()) this.fadeOut(voice);
    this.voices.clear();
    this.bus.disconnect();
  }

  private playOnce(name: OneShot, rate = 1): void {
    const buffer = this.buffers.get(name);
    if (!buffer) return;
    const time = this.ctx.currentTime;
    const last = this.lastPlayedAt.get(name);
    if (last !== undefined && time - last < ONE_SHOT_COOLDOWN[name]) return;
    this.lastPlayedAt.set(name, time);

    const mono = MONOPHONIC.has(name);
    if (mono) {
      const previous = this.voices.get(name);
      if (previous) this.fadeOut(previous);
    }

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    const gain = this.ctx.createGain();
    gain.gain.value = LEVEL[name];
    source.connect(gain).connect(this.bus);
    const voice: Voice = { source, gain };
    source.onended = () => {
      gain.disconnect();
      if (this.voices.get(name) === voice) this.voices.delete(name);
    };
    source.start(time);
    if (mono) this.voices.set(name, voice);
  }

  /** Fade a sounding copy out quickly and stop it, without a click. */
  private fadeOut(voice: Voice): void {
    const time = this.ctx.currentTime;
    const level = voice.gain.gain;
    level.cancelScheduledValues(time);
    level.setValueAtTime(level.value, time);
    level.linearRampToValueAtTime(0, time + CUT_FADE);
    try {
      voice.source.stop(time + CUT_FADE + 0.01);
    } catch {
      // Already stopped - nothing left to fade.
    }
  }

  private startWalk(): void {
    if (this.walkSource) return;
    const buffer = this.buffers.get('walk');
    if (!buffer) return;

    const time = this.ctx.currentTime;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(LEVEL.walk, time + WALK_FADE_IN);
    source.connect(gain).connect(this.bus);
    source.start(time);

    this.walkSource = source;
    this.walkGain = gain;
  }

  private stopWalk(): void {
    const source = this.walkSource;
    const gain = this.walkGain;
    if (!source || !gain) return;
    this.walkSource = null;
    this.walkGain = null;

    const time = this.ctx.currentTime;
    gain.gain.cancelScheduledValues(time);
    gain.gain.setValueAtTime(gain.gain.value, time);
    gain.gain.linearRampToValueAtTime(0, time + WALK_FADE_OUT);
    source.onended = () => gain.disconnect();
    source.stop(time + WALK_FADE_OUT + 0.01);
  }

  private async load(name: SampleName): Promise<void> {
    const path = SAMPLE_PATHS[name];
    try {
      const response = await fetch(path);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.arrayBuffer();
      const buffer = await this.ctx.decodeAudioData(data);
      if (!this.disposed) this.buffers.set(name, buffer);
    } catch (error: unknown) {
      logger.warn(SCOPE, `could not load ${path} - continuing without it`, error);
    }
  }
}
