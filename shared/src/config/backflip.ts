/**
 * Backflip GAMEPLAY rules. Visual timing lives in the client's animation
 * config; this file holds only what the server must agree on.
 *
 * Two different things are tracked, and they must not be conflated:
 *   - "available backflips": how many flips a player MAY perform before
 *     touching the ground again. Server-authoritative.
 *   - "flips being performed": how many are actually in flight right now.
 *     Purely a consequence of player input.
 * Having availability never causes a flip to happen on its own.
 */
export interface BackflipConfig {
  /**
   * Flips a player has at level 1, before any Speed has been farmed.
   *
   * Capacity is otherwise EQUAL TO LEVEL: level 15 means fifteen flips in one
   * airborne window. SpeedService owns that; this is only the starting point.
   */
  readonly defaultCapacity: number;
  /** Hard ceiling the server will accept, regardless of progression. */
  readonly maxCapacity: number;

  /**
   * Upward velocity granted by the FIRST flip of an airborne window.
   *
   * A flip is a traversal move, not just an animation: it re-launches the
   * player mid-air. Applied by the player simulation, never by the animator.
   */
  readonly liftBase: number;
  /**
   * Extra lift added by each successive flip in the same airborne window, so
   * chaining flips climbs higher and higher.
   */
  readonly liftPerChain: number;
  /** Ceiling on a single flip's lift, so a long chain cannot escape the gorge. */
  readonly liftMax: number;
  /** Forward speed added along the player's facing on each flip. */
  readonly forwardImpulse: number;
  /** Cap on horizontal speed reachable by chaining flips. */
  readonly maxAirSpeed: number;
}

export const BACKFLIP: BackflipConfig = {
  defaultCapacity: 1,
  maxCapacity: 50,
  liftBase: 14,
  liftPerChain: 2.6,
  liftMax: 24,
  forwardImpulse: 3.2,
  maxAirSpeed: 26,
};
