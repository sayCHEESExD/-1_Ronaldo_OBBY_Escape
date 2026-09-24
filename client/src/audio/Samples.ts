import { ASSET_PATHS } from '../config/assets.js';
import { logger } from '../util/logger.js';

const SCOPE = 'Samples';

/** The recorded effects in `assets/audio/`. */
type SampleName = 'jump' | 'death' | 'walk';

const SAMPLE_PATHS: Readonly<Record<SampleName, string>> = {
  jump: ASSET_PATHS.jumpSound,
  death: ASSET_PATHS.deathSound,
  walk: ASSET_PATHS.walkSound,
};

/** Mix level of each sample against the synthesised effects. */
const LEVEL: Readonly<Record<SampleName, number>> = {
  jump: 0.7,
  death: 0.8,
  walk: 0.45,
};

/**
 * Shortest gap between two plays of a one-shot, in seconds.
 *
 * The callers already fire on one-shot EDGES; this only stops two edges a
 * frame apart stacking into one doubled, louder copy.
 */
const ONE_SHOT_COOLDOWN: Readonly<Record<'jump' | 'death', number>> = {
  jump: 0.08,
  death: 0.5,
};

/** Fade on starting and stopping the footstep loop, so it never clicks. */
const WALK_FADE_IN = 0.04;
const WALK_FADE_OUT = 0.06;

/**
 * The recorded sound effects: jump, death and the footstep loop.
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
    this.bus.disconnect();
  }

  private playOnce(name: 'jump' | 'death'): void {
    const buffer = this.buffers.get(name);
    if (!buffer) return;
    const time = this.ctx.currentTime;
    const last = this.lastPlayedAt.get(name);
    if (last !== undefined && time - last < ONE_SHOT_COOLDOWN[name]) return;
    this.lastPlayedAt.set(name, time);

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    const gain = this.ctx.createGain();
    gain.gain.value = LEVEL[name];
    source.connect(gain).connect(this.bus);
    source.onended = () => gain.disconnect();
    source.start(time);
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
