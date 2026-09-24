/**
 * Transform-only view of a player, used for both the local prediction and the
 * replicated remote players.
 */
export interface PlayerTransform {
  x: number;
  y: number;
  z: number;
  /** Yaw in radians. Pitch/roll are not replicated - the character stays upright. */
  rotationY: number;
}

/**
 * Visual states the character animator can be in.
 *
 * These describe PRESENTATION only. Gameplay authority (position, progression,
 * how many flips a player may perform) never lives here.
 */
export const PlayerAnimationState = {
  Idle: 'idle',
  Walk: 'walk',
  Run: 'run',
  JumpStart: 'jumpStart',
  Airborne: 'airborne',
  Landing: 'landing',
  Backflip: 'backflip',
  /** Second or later flip within a single airborne window. */
  ChainedBackflip: 'chainedBackflip',
} as const;

export type PlayerAnimationState =
  (typeof PlayerAnimationState)[keyof typeof PlayerAnimationState];

/**
 * The compact, per-player signals a client needs to reconstruct another
 * player's animation locally. Bone transforms are NEVER sent over the network.
 */
export interface PlayerMotionState {
  /** Horizontal speed in world units per second. Drives walk/run blending. */
  speed: number;
  /** Vertical velocity in world units per second. Distinguishes rise from fall. */
  verticalVelocity: number;
  /** True while standing on a surface. */
  grounded: boolean;
  /**
   * Monotonically increasing count of flips this player has STARTED.
   * Remote clients trigger a flip when this value increases - one small
   * integer replaces any per-frame rotation stream.
   */
  flipCount: number;
}

/** Server-authoritative progression snapshot. Not driven by gameplay yet. */
export interface PlayerProgression {
  level: number;
  progression: number;
  rebirths: number;
  backflips: number;
  /** Trophy wins collected. Awarded by the server only. */
  wins: number;
  /**
   * Lifetime Speed farmed by moving. The progression currency: crossing each
   * level threshold grants one more backflip. Awarded by the server only.
   */
  totalSpeed: number;
  /** Slot of the currently equipped boot - the best one owned. */
  bootSlot: number;
  /** Bitmask of boots bought, one bit per slot. */
  ownedBoots: number;
  /**
   * Authoritative movement multiplier, resolved by the server from level,
   * rebirth and (later) boots. The client moves at exactly this.
   */
  moveMultiplier: number;
  /** Highest level reachable at the current rebirth. */
  maxLevel: number;
}

/** Everything the client knows about a replicated player. */
export interface PlayerSnapshot
  extends PlayerTransform,
    PlayerMotionState,
    PlayerProgression {
  sessionId: string;
  animation: PlayerAnimationState;
}
