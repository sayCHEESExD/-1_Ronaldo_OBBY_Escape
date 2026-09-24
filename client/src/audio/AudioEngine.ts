import { logger } from '../util/logger.js';
import { MusicTrack } from './MusicTrack.js';
import { Samples } from './Samples.js';
import { Sfx } from './Sfx.js';

const SCOPE = 'AudioEngine';

const VOLUME_KEY = 'obby.audio.volume';
const MUTED_KEY = 'obby.audio.muted';

const DEFAULT_VOLUME = 0.55;

/**
 * The single owner of the game's audio.
 *
 * Nothing else creates an `AudioContext`, and nothing else decides whether
 * sound is allowed to play. Callers just say what happened - `land()` - and
 * this works out whether there is anywhere to play it.
 *
 * AUTOPLAY: the context is not created until the first real user gesture. A
 * context built before one starts suspended and every browser logs a warning
 * about it; deferring construction means there is never anything to warn
 * about, and the first `resume()` always happens inside a gesture where it is
 * guaranteed to be honoured.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private music: MusicTrack | null = null;
  /** Music level from the portal settings, applied when the graph is built. */
  private musicLevel = 1;
  private sfx: Sfx | null = null;
  private samples: Samples | null = null;

  private volumeValue: number;
  private mutedValue: boolean;
  private starting = false;

  private readonly listeners = new Set<() => void>();

  constructor() {
    this.volumeValue = readNumber(VOLUME_KEY, DEFAULT_VOLUME);
    this.mutedValue = readBoolean(MUTED_KEY, false);
  }

  get volume(): number {
    return this.volumeValue;
  }

  get muted(): boolean {
    return this.mutedValue;
  }

  /** True once audio is actually running. */
  get active(): boolean {
    return this.ctx !== null;
  }

  /**
   * Arm the first-gesture handlers.
   *
   * Both pointer and key, because the player may reach for either first, and
   * `once` so neither outlives its purpose.
   */
  attach(): void {
    const begin = (): void => {
      void this.begin();
    };
    window.addEventListener('pointerdown', begin, { once: true });
    window.addEventListener('keydown', begin, { once: true });
    // A tab that has been in the background comes back suspended.
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  detach(): void {
    document.removeEventListener('visibilitychange', this.onVisibility);
  }

  setVolume(volume: number): void {
    const clamped = Number.isFinite(volume) ? Math.min(Math.max(volume, 0), 1) : DEFAULT_VOLUME;
    this.volumeValue = clamped;
    write(VOLUME_KEY, String(clamped));
    this.applyGain();
    this.notify();
  }

  /**
   * Set the music level, 0..1, independently of the master volume.
   *
   * Remembered even when the graph has not been built yet: audio only starts
   * inside a user gesture, and the portal pushes its settings well before
   * that, so a value that was not stored would simply be lost.
   */
  setMusicVolume(level01: number): void {
    const clamped = Number.isFinite(level01) ? Math.min(Math.max(level01, 0), 1) : 1;
    this.musicLevel = clamped;
    this.music?.setLevel(clamped);
  }

  /**
   * Move the volume by a step, for the keyboard controls.
   *
   * Raising it un-mutes, the same way dragging the slider up does: a player
   * reaching for "louder" is asking to hear something, and leaving them muted
   * while the number climbs is the kind of control that feels broken.
   */
  nudgeVolume(delta: number): void {
    if (!Number.isFinite(delta) || delta === 0) return;
    const next = Math.min(Math.max(this.volumeValue + delta, 0), 1);
    if (delta > 0 && this.mutedValue && next > 0) this.setMuted(false);
    this.setVolume(next);
  }

  setMuted(muted: boolean): void {
    this.mutedValue = muted;
    write(MUTED_KEY, muted ? '1' : '0');
    this.applyGain();
    this.notify();
  }

  toggleMuted(): void {
    this.setMuted(!this.mutedValue);
  }

  /** Called when the state a control renders from changes. */
  onChange(listener: () => void): void {
    this.listeners.add(listener);
  }

  /** The local player just landed on something solid. */
  land(): void {
    this.sfx?.land();
  }

  /**
   * A backflip just STARTED - one call per flip.
   *
   * The caller is expected to have counted actual flips rather than button
   * presses, so a flip the simulation refused never reaches here.
   */
  backflip(chainIndex = 0): void {
    this.sfx?.backflip(chainIndex);
  }

  /**
   * The local player left the ground from a NORMAL jump - never a flip, which
   * has its own sound in `backflip`.
   */
  jump(): void {
    this.samples?.jump();
  }

  /** The local player died. One call per death. */
  death(): void {
    this.samples?.death();
  }

  /**
   * Whether footsteps should be sounding. Call every frame; the loop starts
   * and stops only on a change, so it never restarts or doubles up.
   */
  setWalking(walking: boolean): void {
    this.samples?.setWalking(walking);
  }

  /** Wins were awarded by the server. One call per award. */
  win(): void {
    this.sfx?.win();
  }

  dispose(): void {
    this.detach();
    this.music?.dispose();
    this.sfx?.dispose();
    this.samples?.dispose();
    void this.ctx?.close();
    this.ctx = null;
  }

  /** Build the graph and start the music. Runs once, inside a user gesture. */
  private async begin(): Promise<void> {
    if (this.ctx || this.starting) return;
    this.starting = true;

    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) {
      logger.warn(SCOPE, 'Web Audio unavailable - running silent');
      return;
    }

    try {
      const ctx = new Ctor();
      if (ctx.state === 'suspended') await ctx.resume();

      const master = ctx.createGain();
      master.gain.value = this.mutedValue ? 0 : this.volumeValue;
      master.connect(ctx.destination);

      this.ctx = ctx;
      this.master = master;
      this.sfx = new Sfx(ctx, master);
      this.samples = new Samples(ctx, master);
      this.music = new MusicTrack(ctx, master);
      this.music.setLevel(this.musicLevel);
      this.music.start();

      logger.info(SCOPE, `started at ${ctx.sampleRate}Hz, volume ${this.volumeValue}`);
      this.notify();
    } catch (error: unknown) {
      logger.warn(SCOPE, 'could not start audio', error);
    }
  }

  private readonly onVisibility = (): void => {
    if (document.hidden || !this.ctx) return;
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  };

  private applyGain(): void {
    if (!this.master || !this.ctx) return;
    const target = this.mutedValue ? 0 : this.volumeValue;
    // A short ramp rather than a jump, so changing volume never clicks.
    this.master.gain.setTargetAtTime(target, this.ctx.currentTime, 0.02);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

const readNumber = (key: string, fallback: number): number => {
  try {
    const raw = window.localStorage.getItem(key);
    const value = raw === null ? Number.NaN : Number.parseFloat(raw);
    return Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : fallback;
  } catch {
    return fallback;
  }
};

const readBoolean = (key: string, fallback: boolean): boolean => {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : raw === '1';
  } catch {
    return fallback;
  }
};

const write = (key: string, value: string): void => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // A blocked storage quota must never take the audio down with it.
  }
};
