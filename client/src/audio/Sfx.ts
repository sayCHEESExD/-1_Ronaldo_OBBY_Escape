import { createNoiseBuffer, envelope } from './Synth.js';

/**
 * Minimum gap between two landing sounds, in seconds.
 *
 * The landing EDGE is already one-shot, so this is not what stops a repeat -
 * it is a guard against two landings inside a frame or two stacking into one
 * unpleasantly loud hit.
 */
const LANDING_COOLDOWN = 0.06;

/**
 * Synthesised one-shot sound effects - the landing.
 *
 * The backflip ("SIUUU") and the Win cheer are recorded samples and live in
 * `Samples`.
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

  dispose(): void {
    this.bus.disconnect();
  }
}
