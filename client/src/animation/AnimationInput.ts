/**
 * The gameplay signals the animator consumes each frame.
 *
 * This is the whole contract between gameplay and presentation. The animator
 * reads it and never writes back: it cannot move the player, cannot change
 * velocity, and cannot decide whether a flip is allowed.
 *
 * The identical struct is produced by the local player from its own simulation
 * and by each remote player from replicated network state, so local and remote
 * characters run the exact same animation code.
 */
export interface AnimationInput {
  /** Standing on a surface. */
  grounded: boolean;
  /** Horizontal speed in world units per second. */
  horizontalSpeed: number;
  /** Vertical velocity in world units per second; negative is falling. */
  verticalVelocity: number;
  /** True on the frame the player leaves the ground under their own power. */
  jumpStarted: boolean;
  /** True on the frame the player touches down. */
  landed: boolean;
  /** True on the frame a new flip should begin. Gameplay has already
   *  validated and consumed the availability by the time this is set. */
  backflipRequested: boolean;
}

export const createAnimationInput = (): AnimationInput => ({
  grounded: true,
  horizontalSpeed: 0,
  verticalVelocity: 0,
  jumpStarted: false,
  landed: false,
  backflipRequested: false,
});
