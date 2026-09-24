import { LOCOMOTION } from '../config/animationConfig.js';
import type { PoseBuffer } from './PoseBuffer.js';

const TAU = Math.PI * 2;

const clamp = (value: number, min: number, max: number): number =>
  value < min ? min : value > max ? max : value;

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Smooth 0..1 ramp between two thresholds. */
const smoothstep = (edge0: number, edge1: number, value: number): number => {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * One procedural walk/run cycle driven by a phase.
 *
 * Walk and run are the SAME cycle: `runBlend` (derived from actual movement
 * speed) raises the cadence and strengthens the pose, so the character
 * transitions continuously from a stroll to a sprint rather than snapping
 * between two canned animations.
 *
 * Phase advances with distance travelled, not with wall-clock time, so the
 * feet stay planted in step with real movement at any speed.
 */
export class LocomotionCycle {
  private phase = 0;

  /** Current cycle phase in radians, for diagnostics. */
  get currentPhase(): number {
    return this.phase;
  }

  /** How strongly the run pose is applied, 0..1. */
  runBlend(speed: number): number {
    return smoothstep(LOCOMOTION.walkSpeed, LOCOMOTION.runSpeed, speed);
  }

  /** Advance the cycle. Returns the frequency used, in cycles per second. */
  advance(delta: number, speed: number): number {
    const frequency = clamp(
      speed / LOCOMOTION.strideDistance,
      LOCOMOTION.minFrequency,
      LOCOMOTION.maxFrequency,
    );
    this.phase = (this.phase + frequency * TAU * delta) % TAU;
    return frequency;
  }

  /**
   * Ease the cycle back toward a neutral standing phase. Used while idle so
   * that starting to walk does not begin mid-stride.
   */
  settleTowardNeutral(delta: number): void {
    const target = this.phase > Math.PI ? TAU : 0;
    const alpha = 1 - Math.exp(-8 * delta);
    this.phase += (target - this.phase) * alpha;
    if (this.phase >= TAU - 1e-4) this.phase = 0;
  }

  /**
   * Write the locomotion pose for the current phase.
   *
   * Legs alternate a half cycle apart, arms counter-swing against the legs on
   * the opposite diagonal, and the torso and head add secondary motion.
   */
  writePose(out: PoseBuffer, speed: number): void {
    const blend = this.runBlend(speed);
    const phase = this.phase;

    const hip = lerp(LOCOMOTION.hipSwing.walk, LOCOMOTION.hipSwing.run, blend);
    const knee = lerp(LOCOMOTION.kneeBend.walk, LOCOMOTION.kneeBend.run, blend);
    const arm = lerp(LOCOMOTION.armSwing.walk, LOCOMOTION.armSwing.run, blend);
    const elbow = lerp(LOCOMOTION.elbowBend.walk, LOCOMOTION.elbowBend.run, blend);
    const twist = lerp(LOCOMOTION.torsoTwist.walk, LOCOMOTION.torsoTwist.run, blend);
    const lean = lerp(LOCOMOTION.torsoLean.walk, LOCOMOTION.torsoLean.run, blend);
    const headTwist = lerp(
      LOCOMOTION.headCounterTwist.walk,
      LOCOMOTION.headCounterTwist.run,
      blend,
    );
    const roll = lerp(LOCOMOTION.torsoRoll.walk, LOCOMOTION.torsoRoll.run, blend);
    const bob = lerp(LOCOMOTION.bob.walk, LOCOMOTION.bob.run, blend);

    const swing = Math.sin(phase);
    const oppositeSwing = -swing;

    out.reset();

    // Thighs: a half cycle apart, so the feet alternate.
    out.set('LegL1', hip * swing);
    out.set('LegR1', hip * oppositeSwing);

    // Knees bend during the swing-through only - a straight-through knee
    // reads as a limp, and knees must never hyperextend backward.
    out.set('LegL2', knee * kneeCurve(phase));
    out.set('LegR2', knee * kneeCurve(phase + Math.PI));

    // Arms counter-swing against the leg on the same side.
    out.set('ArmL1', arm * oppositeSwing);
    out.set('ArmR1', arm * swing);
    out.set('ArmL2', elbow + elbow * 0.35 * Math.max(0, oppositeSwing));
    out.set('ArmR2', elbow + elbow * 0.35 * Math.max(0, swing));

    // Secondary torso and head motion at twice the leg cadence for the bounce,
    // and once per cycle for the twist.
    out.set('Spine1', lean, twist * oppositeSwing, roll * Math.sin(phase * 2));
    out.set('Spine2', lean * 0.4, twist * 0.5 * oppositeSwing, 0);
    out.set('Neck1', -lean * 0.5, headTwist * swing, 0);

    // Body rises twice per cycle, once per footfall. Visual only.
    out.bobY = -bob * Math.cos(phase * 2);
  }
}

/**
 * Knee flexion over one cycle: zero while the leg is planted and extending,
 * rising to a peak as the foot lifts and passes under the body.
 */
const kneeCurve = (phase: number): number => {
  const raw = Math.sin(phase - Math.PI / 2.6);
  return raw > 0 ? raw * raw : 0;
};
