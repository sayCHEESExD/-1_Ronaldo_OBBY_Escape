import { createNoiseBuffer, envelope, midiToFreq } from './Synth.js';

/**
 * Minimum gap between two landing sounds, in seconds.
 *
 * The landing EDGE is already one-shot, so this is not what stops a repeat -
 * it is a guard against two landings inside a frame or two stacking into one
 * unpleasantly loud hit.
 */
const LANDING_COOLDOWN = 0.06;

/**
 * Semitones each flip in a chain rises by, and the ceiling on that.
 *
 * A chain is the skill expression in this game, so it should sound like one
 * going up rather than the same sample five times. Capped so a long chain does
 * not climb out of the audible range it started in.
 */
const FLIP_CHAIN_STEP = 2;
const FLIP_CHAIN_MAX = 12;

/** Notes of the Win fanfare, as MIDI, and the gap between them in seconds. */
const WIN_ARPEGGIO = [76, 81, 88] as const;
const WIN_NOTE_GAP = 0.055;

/**
 * One-shot sound effects.
 *
 * Every voice is built from oscillators and a noise buffer at the moment it
 * plays, then thrown away - Web Audio nodes are cheap, single-use and garbage
 * collected once they stop, so there is nothing to pool and nothing to load.
 */
export class Sfx {
  private readonly ctx: AudioContext;
  private readonly bus: GainNode;
  private readonly noise: AudioBuffer;
  private lastLandingAt = -1;

  constructor(ctx: AudioContext, destination: AudioNode) {
    this.ctx = ctx;
    this.noise = createNoiseBuffer(ctx);
    this.bus = ctx.createGain();
    this.bus.gain.value = 0.9;
    this.bus.connect(destination);
  }

  /**
   * A heavy landing on concrete.
   *
   * Three layers, which is what separates "thud" from "landed on something
   * hard": a pitch-dropping sine for the body weight, a band-passed noise
   * burst for the scrape of the surface, and a very short high click for the
   * initial contact. Each landing is detuned slightly so a run of jumps does
   * not sound like a looped sample.
   */
  land(): void {
    const time = this.ctx.currentTime;
    if (time - this.lastLandingAt < LANDING_COOLDOWN) return;
    this.lastLandingAt = time;

    const detune = 0.9 + Math.random() * 0.22;

    // Body: the weight going through the slab.
    const thump = this.ctx.createOscillator();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(98 * detune, time);
    thump.frequency.exponentialRampToValueAtTime(36 * detune, time + 0.1);
    const thumpGain = envelope(this.ctx, time, 0.85, 0.004, 0.15);
    thump.connect(thumpGain).connect(this.bus);
    thump.start(time);
    thump.stop(time + 0.2);

    // Surface: grit under the boot.
    const grit = this.ctx.createBufferSource();
    grit.buffer = this.noise;
    const band = this.ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 1400 * detune;
    band.Q.value = 0.7;
    const gritGain = envelope(this.ctx, time, 0.42, 0.002, 0.085);
    grit.connect(band).connect(gritGain).connect(this.bus);
    grit.start(time);
    grit.stop(time + 0.12);

    // Contact: the hard, bright edge of the hit.
    const click = this.ctx.createBufferSource();
    click.buffer = this.noise;
    const high = this.ctx.createBiquadFilter();
    high.type = 'highpass';
    high.frequency.value = 4200;
    const clickGain = envelope(this.ctx, time, 0.22, 0.001, 0.028);
    click.connect(high).connect(clickGain).connect(this.bus);
    click.start(time);
    click.stop(time + 0.05);
  }

  /**
   * A backflip launching.
   *
   * A short upward whoosh with a bright blip on top - the whoosh sells the
   * rotation and the blip gives it an attack sharp enough to be heard over a
   * chain of them. Deliberately under 200ms: at the top of a chain these land
   * a few frames apart, and anything longer turns into mush.
   *
   * @param chainIndex 0 for the first flip of an airborne window, rising after
   *                   - each one is pitched up, so a chain reads as a climb.
   */
  backflip(chainIndex = 0): void {
    const time = this.ctx.currentTime;
    const steps = Math.min(chainIndex * FLIP_CHAIN_STEP, FLIP_CHAIN_MAX);
    const rise = 2 ** (steps / 12);

    // Whoosh: band-passed noise sweeping up, which is the rotation itself.
    const air = this.ctx.createBufferSource();
    air.buffer = this.noise;
    const band = this.ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 1.6;
    band.frequency.setValueAtTime(620 * rise, time);
    band.frequency.exponentialRampToValueAtTime(2600 * rise, time + 0.16);
    const airGain = envelope(this.ctx, time, 0.3, 0.012, 0.15);
    air.connect(band).connect(airGain).connect(this.bus);
    air.start(time);
    air.stop(time + 0.2);

    // Blip: the launch, and the part that survives a chain.
    const blip = this.ctx.createOscillator();
    blip.type = 'triangle';
    blip.frequency.setValueAtTime(midiToFreq(69) * rise, time);
    blip.frequency.exponentialRampToValueAtTime(midiToFreq(81) * rise, time + 0.09);
    const blipGain = envelope(this.ctx, time, 0.24, 0.004, 0.1);
    blip.connect(blipGain).connect(this.bus);
    blip.start(time);
    blip.stop(time + 0.16);
  }

  /**
   * Wins banked.
   *
   * A rising three-note arpeggio with a little noise sparkle - short enough to
   * stay out of the way of a fast run, bright enough to read as a reward. The
   * caller decides WHEN a reward happened; this only makes the noise.
   */
  win(): void {
    const start = this.ctx.currentTime;

    WIN_ARPEGGIO.forEach((note, i) => {
      const time = start + i * WIN_NOTE_GAP;

      const tone = this.ctx.createOscillator();
      tone.type = 'triangle';
      tone.frequency.setValueAtTime(midiToFreq(note), time);
      const toneGain = envelope(this.ctx, time, 0.3, 0.006, 0.2);
      tone.connect(toneGain).connect(this.bus);
      tone.start(time);
      tone.stop(time + 0.3);

      // A quiet octave above, which is what makes it read as bright rather
      // than as three plain beeps.
      const shimmer = this.ctx.createOscillator();
      shimmer.type = 'sine';
      shimmer.frequency.setValueAtTime(midiToFreq(note + 12), time);
      const shimmerGain = envelope(this.ctx, time, 0.1, 0.006, 0.16);
      shimmer.connect(shimmerGain).connect(this.bus);
      shimmer.start(time);
      shimmer.stop(time + 0.24);
    });

    // Sparkle across the whole flourish.
    const sparkle = this.ctx.createBufferSource();
    sparkle.buffer = this.noise;
    const high = this.ctx.createBiquadFilter();
    high.type = 'highpass';
    high.frequency.value = 5200;
    const sparkleGain = envelope(this.ctx, start, 0.14, 0.01, 0.26);
    sparkle.connect(high).connect(sparkleGain).connect(this.bus);
    sparkle.start(start);
    sparkle.stop(start + 0.32);
  }

  dispose(): void {
    this.bus.disconnect();
  }
}
