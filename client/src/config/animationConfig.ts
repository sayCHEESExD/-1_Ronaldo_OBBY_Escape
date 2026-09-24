import type { PoseDefinition } from '../animation/PoseBuffer.js';

const deg = (degrees: number): number => (degrees * Math.PI) / 180;

/**
 * Procedural animation tuning. Data-driven: every number the animator uses
 * lives here, so the character can be re-tuned without touching logic.
 *
 * All rotations are in character space (see PlayerRig): +X pitch swings a limb
 * backward, +Y is yaw about the character's up axis, +Z is roll.
 */

/** Height of the flip pivot above the feet, in world units (hip height). */
export const FLIP_PIVOT_HEIGHT = 1.6;

export const LOCOMOTION = {
  /** World units travelled per full two-step cycle. Sets cadence from speed. */
  strideDistance: 5.0,
  /** Cycle frequency clamp, in cycles per second. */
  minFrequency: 0.6,
  maxFrequency: 3.6,
  /** Speed at which the walk pose is fully in effect. */
  walkSpeed: 9,
  /** Speed at which the run pose is fully in effect. */
  runSpeed: 15,
  /** Below this speed the character is idle. */
  idleSpeed: 0.35,

  /** Peak thigh swing, walk -> run. */
  hipSwing: { walk: deg(26), run: deg(38) },
  /** Peak knee flexion, walk -> run. Knees only bend one way. */
  kneeBend: { walk: deg(34), run: deg(62) },
  /** Peak shoulder counter-swing, walk -> run. */
  armSwing: { walk: deg(22), run: deg(34) },
  /** Constant elbow flexion, walk -> run. */
  elbowBend: { walk: deg(14), run: deg(38) },
  /** Torso counter-rotation about the up axis. */
  torsoTwist: { walk: deg(5), run: deg(9) },
  /** Forward lean of the whole spine. */
  torsoLean: { walk: deg(4), run: deg(11) },
  /** Head counter-twist, keeping the gaze forward. */
  headCounterTwist: { walk: deg(3), run: deg(5) },
  /** Vertical bob amplitude in world units (visual only). */
  bob: { walk: 0.055, run: 0.11 },
  /** Side-to-side roll of the torso. */
  torsoRoll: { walk: deg(2), run: deg(4) },
} as const;

export const IDLE = {
  /** Breathing cycles per second. */
  breathFrequency: 0.35,
  breathAmount: deg(2.2),
  breathBob: 0.018,
  /** Base standing pose - arms hang slightly out from the body. */
  basePose: {
    ArmL1: { z: deg(-5) },
    ArmR1: { z: deg(5) },
    ArmL2: { x: deg(6) },
    ArmR2: { x: deg(6) },
    Spine1: { x: deg(1.5) },
  } satisfies PoseDefinition,
} as const;

/** Crouch-and-launch pose held briefly as the player leaves the ground. */
export const JUMP_START = {
  duration: 0.13,
  pose: {
    Spine1: { x: deg(14) },
    Spine2: { x: deg(6) },
    Neck1: { x: deg(-8) },
    LegL1: { x: deg(-26) },
    LegR1: { x: deg(-26) },
    LegL2: { x: deg(48) },
    LegR2: { x: deg(48) },
    ArmL1: { x: deg(52), z: deg(-12) },
    ArmR1: { x: deg(52), z: deg(12) },
    ArmL2: { x: deg(26) },
    ArmR2: { x: deg(26) },
  } satisfies PoseDefinition,
  bobY: -0.14,
} as const;

/** Airborne poses. Blended by vertical velocity: rising -> apex -> falling. */
export const AIRBORNE = {
  /** |verticalVelocity| at which the rise/fall pose is fully applied. */
  velocityReference: 12,
  rise: {
    Spine1: { x: deg(-6) },
    Neck1: { x: deg(4) },
    LegL1: { x: deg(-18) },
    LegR1: { x: deg(6) },
    LegL2: { x: deg(46) },
    LegR2: { x: deg(16) },
    ArmL1: { x: deg(-58), z: deg(-18) },
    ArmR1: { x: deg(-58), z: deg(18) },
    ArmL2: { x: deg(18) },
    ArmR2: { x: deg(18) },
  } satisfies PoseDefinition,
  fall: {
    Spine1: { x: deg(7) },
    Neck1: { x: deg(-6) },
    LegL1: { x: deg(-12) },
    LegR1: { x: deg(14) },
    LegL2: { x: deg(26) },
    LegR2: { x: deg(20) },
    ArmL1: { x: deg(-92), z: deg(-30) },
    ArmR1: { x: deg(-92), z: deg(30) },
    ArmL2: { x: deg(34) },
    ArmR2: { x: deg(34) },
  } satisfies PoseDefinition,
} as const;

/** Absorbing crouch on touchdown, then recovery into locomotion. */
export const LANDING = {
  duration: 0.22,
  pose: {
    Spine1: { x: deg(20) },
    Spine2: { x: deg(8) },
    Neck1: { x: deg(-12) },
    LegL1: { x: deg(-30) },
    LegR1: { x: deg(-30) },
    LegL2: { x: deg(62) },
    LegR2: { x: deg(62) },
    ArmL1: { x: deg(30), z: deg(-22) },
    ArmR1: { x: deg(30), z: deg(22) },
    ArmL2: { x: deg(40) },
    ArmR2: { x: deg(40) },
  } satisfies PoseDefinition,
  bobY: -0.22,
} as const;

export const BACKFLIP_ANIM = {
  /**
   * Seconds for one full 360 degree rotation.
   *
   * Must stay comfortably below the airtime of a standing jump
   * (2 * MOVEMENT.jumpVelocity / MOVEMENT.gravity = 0.73s) or a single flip
   * gets cut short by the landing. At 0.45s one flip completes with margin,
   * and longer drops chain several.
   */
  rotationDuration: 0.45,
  /** Seconds to ease the pivot back to upright if a flip is cut short. */
  abortDuration: 0.14,
  /** How hard the character tucks at the middle of the rotation. */
  tuckPose: {
    Spine1: { x: deg(34) },
    Spine2: { x: deg(20) },
    Neck1: { x: deg(-16) },
    LegL1: { x: deg(-84) },
    LegR1: { x: deg(-84) },
    LegL2: { x: deg(112) },
    LegR2: { x: deg(112) },
    ArmL1: { x: deg(46), z: deg(-26) },
    ArmR1: { x: deg(46), z: deg(26) },
    ArmL2: { x: deg(78) },
    ArmR2: { x: deg(78) },
  } satisfies PoseDefinition,
  /** Slight asymmetry so the flip does not look mechanically perfect. */
  tuckAsymmetry: deg(6),
} as const;

/**
 * Cross-fade durations, in seconds, between animation states.
 * Anything unlisted uses `default`.
 */
export const TRANSITIONS = {
  default: 0.16,
  toLocomotion: 0.18,
  toJumpStart: 0.06,
  toAirborne: 0.14,
  toLanding: 0.06,
  toBackflip: 0.08,
} as const;
