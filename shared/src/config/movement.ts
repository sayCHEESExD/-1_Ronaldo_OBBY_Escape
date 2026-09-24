/**
 * Data-driven movement tuning. The client simulates locally with these values
 * and the server validates against the same numbers, so they must not diverge.
 */
export interface MovementConfig {
  /** Ground speed in world units per second. */
  readonly walkSpeed: number;
  /** Speed while sprinting, in world units per second. */
  readonly runSpeed: number;
  /** Ground acceleration, world units per second squared. */
  readonly acceleration: number;
  /** Ground deceleration when no input is held. */
  readonly deceleration: number;
  /** Fraction of ground acceleration retained while airborne (0..1). */
  readonly airControl: number;
  /** Downward acceleration, world units per second squared. */
  readonly gravity: number;
  /** Upward velocity applied on jump, world units per second. */
  readonly jumpVelocity: number;
  /** Model turn rate toward the movement direction, radians per second. */
  readonly turnSpeed: number;
  /**
   * Horizontal speed at or above which a jump is considered a "fast" jump.
   * Velocity determines jump distance, so this is the gate for long gaps.
   */
  readonly fastJumpSpeedThreshold: number;
}

export const MOVEMENT: MovementConfig = {
  walkSpeed: 9,
  runSpeed: 15,
  acceleration: 60,
  deceleration: 45,
  airControl: 0.35,
  gravity: 55,
  jumpVelocity: 20,
  turnSpeed: 12,
  fastJumpSpeedThreshold: 12,
};
