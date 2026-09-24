import { ASSET_PATHS } from '../config/assets.js';
import { logger } from '../util/logger.js';

const SCOPE = 'MusicTrack';

/**
 * The level this track sits at under the effects. A mastered mp3 is far
 * louder than the synthesised effects, so it is mixed down to let a landing
 * or a backflip always cut through. The portal's music slider multiplies this.
 */
const BASE_LEVEL = 0.35;

/**
 * The background music: `assets/audio/background.mp3`, looped.
 *
 * STREAMED through an `<audio>` element rather than decoded into an
 * AudioBuffer - a decoded track of this length is tens of megabytes of PCM
 * held in memory for the whole session, which a phone does not have to spare.
 * The element is routed into the game's Web Audio graph, so the master
 * volume, mute and the portal's music slider all apply exactly as they did to
 * the old synthesised loop, and the public interface is unchanged.
 *
 * Created inside the user gesture that starts audio (see AudioEngine.begin),
 * which is what browsers require before media may play with sound.
 */
export class MusicTrack {
  private readonly element: HTMLAudioElement;
  private readonly source: MediaElementAudioSourceNode;
  private readonly bus: GainNode;
  private wanted = false;

  constructor(ctx: AudioContext, destination: AudioNode) {
    this.element = new Audio(ASSET_PATHS.backgroundMusic);
    this.element.loop = true;
    this.element.preload = 'auto';
    this.element.crossOrigin = 'anonymous';

    this.source = ctx.createMediaElementSource(this.element);
    this.bus = ctx.createGain();
    this.bus.gain.value = BASE_LEVEL;
    this.source.connect(this.bus);
    this.bus.connect(destination);

    this.element.addEventListener('error', this.onError);
  }

  /**
   * Music level, independent of the master.
   *
   * The portal offers separate master and music sliders, so the track has a
   * level of its own - scaling the master would move the effects with it.
   * The setting multiplies `BASE_LEVEL`, so "100%" is the level the game was
   * mixed at.
   */
  setLevel(level01: number): void {
    const clamped = Number.isFinite(level01) ? Math.min(Math.max(level01, 0), 1) : 1;
    this.bus.gain.value = BASE_LEVEL * clamped;
  }

  start(): void {
    this.wanted = true;
    // play() is refused without a user gesture; AudioEngine calls this from
    // one. A refusal is logged and retried on the next start rather than
    // treated as fatal - the game is fully playable silent.
    this.element.play().catch((error: unknown) => {
      logger.warn(SCOPE, 'background music could not start yet', error);
    });
  }

  stop(): void {
    this.wanted = false;
    this.element.pause();
  }

  dispose(): void {
    this.stop();
    this.element.removeEventListener('error', this.onError);
    this.source.disconnect();
    this.bus.disconnect();
    this.element.removeAttribute('src');
    this.element.load();
  }

  /** True while the track should be playing (for diagnostics). */
  get playing(): boolean {
    return this.wanted && !this.element.paused;
  }

  private readonly onError = (): void => {
    logger.warn(SCOPE, `could not load ${ASSET_PATHS.backgroundMusic} - continuing without music`);
  };
}
