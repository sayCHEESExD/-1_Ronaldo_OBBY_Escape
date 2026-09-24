import { BACKFLIP } from '../config/backflip.js';
import { MOVEMENT } from '../config/movement.js';
import {
  NO_TREADMILL,
  TREADMILL_DECK_Y,
  TREADMILL_ROW,
  treadmillEntryAt,
  treadmillRunX,
} from '../config/treadmills.js';
import { PLAYER_HEIGHT, SPAWN_POSITION, SPAWN_ROTATION_Y } from '../constants/world.js';
import type { WorldCollision } from './WorldCollision.js';

/**
 * The authoritative physics step, shared by the server and by client
 * prediction.
 *
 * This is THE movement simulation. The server runs it to own the result and
 * the client runs the identical function to predict ahead of the network, so
 * the two can only disagree through inputs, never through different maths.
 * Do not reimplement any part of it anywhere else.
 *
 * Deliberately framework-free and allocation-free: plain numbers on a mutable
 * state object, so it can run in Node and in the browser at any tick rate.
 */

/** Everything that makes up a player's physical state. */
export interface PlayerMotion {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  grounded: boolean;
  /** Edge-detect for the jump control, so holding it does not re-fire. */
  jumpLatched: boolean;
  /** Flips left before touching down. */
  backflipsRemaining: number;
  /** Flips performed since leaving the ground; drives the escalating lift. */
  flipsThisAirtime: number;
  /** Monotonic count of flips started, replicated so remotes can mirror them. */
  flipCount: number;
  /**
   * Treadmill the player is RUNNING ON, or 0.
   *
   * Distinct from the deck they happen to be standing on: this is the pinned
   * state, entered by stopping on an unlocked machine and left the instant any
   * movement control is touched. The simulation owns it, so the server decides
   * it and the client predicts the identical result.
   */
  treadmillTier: number;
}

/** One frame of player intent. Carries no position - only what was pressed. */
export interface MovementInput {
  /** -1..1, camera-relative. */
  moveX: number;
  /** -1..1, camera-relative. */
  moveZ: number;
  jump: boolean;
  sprint: boolean;
  /** Yaw the camera faced, so movement can be camera-relative. */
  cameraYaw: number;
}

/** Server-owned tuning the step reads but never changes. */
export interface SimParams {
  /** Authoritative movement multiplier from level and rebirth. */
  moveMultiplier: number;
  /** Flips allowed per airborne window - the player's level. */
  backflipCapacity: number;
  /**
   * Highest treadmill tier this player may use; 0 for none.
   *
   * Resolved from the rebirth count by the SERVER and replicated, so a client
   * cannot predict its way onto a machine it has not unlocked - and if it
   * tries, the server simply never enters and the prediction is corrected.
   */
  maxTreadmillTier: number;
}

/** Edges the step produced, consumed by the animator. */
export interface SimEvents {
  jumpStarted: boolean;
  landed: boolean;
  backflipRequested: boolean;
  /** Stepped onto a treadmill this step. */
  treadmillEntered: boolean;
  /** Left a treadmill this step. */
  treadmillExited: boolean;
}

/** Largest single step the simulation will take, in seconds. */
export const MAX_SIM_DELTA = 0.1;


export const createMotion = (): PlayerMotion => ({
  x: SPAWN_POSITION.x,
  y: SPAWN_POSITION.y,
  z: SPAWN_POSITION.z,
  vx: 0,
  vy: 0,
  vz: 0,
  yaw: SPAWN_ROTATION_Y,
  grounded: true,
  jumpLatched: false,
  backflipsRemaining: 1,
  flipsThisAirtime: 0,
  flipCount: 0,
  treadmillTier: NO_TREADMILL,
});

export const createSimEvents = (): SimEvents => ({
  jumpStarted: false,
  landed: false,
  backflipRequested: false,
  treadmillEntered: false,
  treadmillExited: false,
});

export const createMovementInput = (): MovementInput => ({
  moveX: 0,
  moveZ: 0,
  jump: false,
  sprint: false,
  cameraYaw: 0,
});

/** Copy motion state, e.g. when snapping prediction to the server. */
export const copyMotion = (from: PlayerMotion, to: PlayerMotion): void => {
  to.x = from.x;
  to.y = from.y;
  to.z = from.z;
  to.vx = from.vx;
  to.vy = from.vy;
  to.vz = from.vz;
  to.yaw = from.yaw;
  to.grounded = from.grounded;
  to.jumpLatched = from.jumpLatched;
  to.backflipsRemaining = from.backflipsRemaining;
  to.flipsThisAirtime = from.flipsThisAirtime;
  to.flipCount = from.flipCount;
  to.treadmillTier = from.treadmillTier;
};

/** Reset to a spawn transform. Used by both sides on respawn. */
export const resetMotion = (
  motion: PlayerMotion,
  capacity: number,
  x = SPAWN_POSITION.x,
  y = SPAWN_POSITION.y,
  z = SPAWN_POSITION.z,
  yaw = SPAWN_ROTATION_Y,
): void => {
  motion.x = x;
  motion.y = y;
  motion.z = z;
  motion.vx = 0;
  motion.vy = 0;
  motion.vz = 0;
  motion.yaw = yaw;
  motion.grounded = true;
  motion.jumpLatched = false;
  motion.backflipsRemaining = Math.max(0, capacity);
  motion.flipsThisAirtime = 0;
  // A respawn always takes the player off a machine.
  motion.treadmillTier = NO_TREADMILL;
};

export const horizontalSpeed = (motion: PlayerMotion): number =>
  Math.hypot(motion.vx, motion.vz);

/**
 * Sanitise one input before it is simulated.
 *
 * Applied on the SERVER to every arriving input: a client can send whatever it
 * likes, but the stick is clamped to the unit disc and every field is forced
 * finite, so an out-of-range or NaN input cannot become out-of-range movement.
 */
export const sanitiseInput = (input: Partial<MovementInput> | undefined): MovementInput => {
  const finite = (value: unknown): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : 0;

  let moveX = finite(input?.moveX);
  let moveZ = finite(input?.moveZ);
  const magnitude = Math.hypot(moveX, moveZ);
  if (magnitude > 1) {
    moveX /= magnitude;
    moveZ /= magnitude;
  }

  return {
    moveX,
    moveZ,
    jump: input?.jump === true,
    sprint: input?.sprint === true,
    cameraYaw: finite(input?.cameraYaw),
  };
};

/**
 * Advance one player by one step.
 *
 * @param motion    mutated in place
 * @param input     already sanitised intent
 * @param params    server-owned tuning
 * @param delta     seconds; clamped internally to [0, MAX_SIM_DELTA]
 * @param collision the world the player moves through
 * @param events    mutated in place with the edges this step produced
 */
export const stepPlayer = (
  motion: PlayerMotion,
  input: MovementInput,
  params: SimParams,
  delta: number,
  collision: WorldCollision,
  events: SimEvents,
): void => {
  events.jumpStarted = false;
  events.landed = false;
  events.backflipRequested = false;
  events.treadmillEntered = false;
  events.treadmillExited = false;

  const dt = Number.isFinite(delta) ? Math.min(Math.max(delta, 0), MAX_SIM_DELTA) : 0;
  if (dt === 0) return;

  // Running on a machine replaces the whole movement step: no acceleration, no
  // gravity, no displacement. Returning here is what keeps the player on the
  // spot instead of travelling through the map.
  if (updateTreadmill(motion, input, params, events)) return;

  const wasGrounded = motion.grounded;

  applyActions(motion, input, params, events);
  applyHorizontal(motion, input, params, dt);
  motion.vy -= MOVEMENT.gravity * dt;

  const previousY = motion.y;
  motion.x += motion.vx * dt;
  motion.y += motion.vy * dt;
  motion.z += motion.vz * dt;

  // Invisible boundaries: the banks are scenery, and the starting area is
  // walled on the left, the back and the shop side.
  collision.clampToBounds(motion.x, motion.z, BOUNDS);
  motion.x = BOUNDS.x;
  motion.z = BOUNDS.z;

  resolveCeiling(motion, previousY, collision);
  resolveGround(motion, previousY, collision);

  if (!wasGrounded && motion.grounded) {
    events.landed = true;
    motion.backflipsRemaining = params.backflipCapacity;
    motion.flipsThisAirtime = 0;
  }
};

/** Scratch for the boundary clamp. Single-threaded, so sharing is safe. */
const BOUNDS = { x: 0, z: 0 };

/** Stick deflection below which the player counts as not steering. */
const TREADMILL_INPUT_DEADZONE = 0.15;

/** Yaw a runner faces: toward the console at the back of the deck. */
const TREADMILL_FACING = Math.PI;

/**
 * Enter, hold or leave a treadmill.
 *
 * @returns true when the player is pinned and the rest of the step must be
 *          skipped entirely.
 *
 * Entry is automatic: come to a stop on an unlocked deck and the machine takes
 * you. Exit is any control at all - a nudge of the stick or the jump button -
 * and it happens on the SAME step, so the input that leaves also moves you.
 * That pairing is why entry requires a still stick: otherwise walking on would
 * enter and leave on alternating steps.
 *
 * Both decisions come from state the simulation owns - position, grounded, and
 * the server-resolved `maxTreadmillTier` - so a client can neither claim a
 * machine it is not at nor one it has not unlocked.
 */
const updateTreadmill = (
  motion: PlayerMotion,
  input: MovementInput,
  params: SimParams,
  events: SimEvents,
): boolean => {
  const steering =
    Math.hypot(input.moveX, input.moveZ) > TREADMILL_INPUT_DEADZONE || input.jump;

  if (motion.treadmillTier !== NO_TREADMILL) {
    if (steering) {
      motion.treadmillTier = NO_TREADMILL;
      events.treadmillExited = true;
      // Deliberately NOT pinned any more, and deliberately not moved: the
      // player carries on from exactly where they were standing, so leaving
      // never reads as a teleport.
      motion.jumpLatched = input.jump;
      return false;
    }

    // Held in place. Velocity stays zero so nothing downstream mistakes a
    // runner for someone travelling.
    motion.vx = 0;
    motion.vy = 0;
    motion.vz = 0;
    motion.y = TREADMILL_DECK_Y;
    motion.grounded = true;
    motion.backflipsRemaining = params.backflipCapacity;
    motion.flipsThisAirtime = 0;
    return true;
  }

  if (steering || !motion.grounded) return false;

  const tier = treadmillEntryAt(motion.x, motion.y, motion.z);
  if (tier === NO_TREADMILL || tier > params.maxTreadmillTier) return false;

  motion.treadmillTier = tier;
  // Snap onto the belt: X is preserved inside the lane so two players sharing
  // one machine keep their own spot, Z centres them under the console.
  motion.x = treadmillRunX(tier, motion.x);
  motion.z = TREADMILL_ROW.centerZ;
  motion.y = TREADMILL_DECK_Y;
  motion.vx = 0;
  motion.vy = 0;
  motion.vz = 0;
  motion.yaw = TREADMILL_FACING;
  motion.grounded = true;
  events.treadmillEntered = true;
  return true;
};

/**
 * Jump and backflip both come from the jump control: pressing it on the ground
 * jumps, pressing it again in the air spends one available flip.
 *
 * Both decisions are made from the SIMULATION's own state, so a client cannot
 * jump in mid-air or flip without an allowance no matter what it sends.
 */
const applyActions = (
  motion: PlayerMotion,
  input: MovementInput,
  params: SimParams,
  events: SimEvents,
): void => {
  const pressed = input.jump && !motion.jumpLatched;
  motion.jumpLatched = input.jump;
  if (!pressed) return;

  if (motion.grounded) {
    motion.vy = MOVEMENT.jumpVelocity;
    motion.grounded = false;
    events.jumpStarted = true;
    return;
  }

  if (motion.backflipsRemaining > 0) {
    motion.backflipsRemaining -= 1;
    motion.flipCount += 1;
    events.backflipRequested = true;
    applyFlipImpulse(motion, params);
  }
};

/**
 * Re-launch the player off a backflip.
 *
 * A flip is a traversal move: it replaces vertical velocity with a fresh
 * upward impulse and adds forward speed, so chaining flips climbs higher and
 * carries the player further down the gorge. Each successive flip in the same
 * airborne window lifts harder than the last.
 */
const applyFlipImpulse = (motion: PlayerMotion, params: SimParams): void => {
  const lift = Math.min(
    BACKFLIP.liftBase + BACKFLIP.liftPerChain * motion.flipsThisAirtime,
    BACKFLIP.liftMax,
  );
  motion.flipsThisAirtime += 1;

  // Replace rather than add, so a flip late in a fall still pops cleanly.
  motion.vy = lift;

  motion.vx += Math.sin(motion.yaw) * BACKFLIP.forwardImpulse;
  motion.vz += Math.cos(motion.yaw) * BACKFLIP.forwardImpulse;

  // The air-speed ceiling scales with the player's own movement multiplier, so
  // a faster player is not clamped back to a beginner's top speed mid-flip.
  const ceiling = BACKFLIP.maxAirSpeed * Math.max(1, params.moveMultiplier);
  const speed = horizontalSpeed(motion);
  if (speed > ceiling) {
    const scale = ceiling / speed;
    motion.vx *= scale;
    motion.vz *= scale;
  }
};

const applyHorizontal = (
  motion: PlayerMotion,
  input: MovementInput,
  params: SimParams,
  dt: number,
): void => {
  const hasInput = input.moveX !== 0 || input.moveZ !== 0;

  // Rotate the raw stick input into world space using the camera's yaw.
  //
  // The camera looks along (sin, cos); its RIGHT is (-cos, sin), because with
  // Y up and X to the right of screen, +Z runs away from the viewer - which is
  // why +X is the player's left when running down the gorge. Strafe used to be
  // built from +(cos, -sin) and therefore sent D to the left; nothing noticed
  // while the camera trailed the player's own facing, because pressing D
  // turned the character and the camera swung round after it. With the camera
  // held still by the mouse, the inversion is immediately visible.
  const sin = Math.sin(input.cameraYaw);
  const cos = Math.cos(input.cameraYaw);
  const dirX = input.moveZ * sin - input.moveX * cos;
  const dirZ = input.moveZ * cos + input.moveX * sin;

  const base = input.sprint ? MOVEMENT.runSpeed : MOVEMENT.walkSpeed;
  const targetSpeed = base * params.moveMultiplier;
  const control = motion.grounded ? 1 : MOVEMENT.airControl;

  if (hasInput) {
    const accel = MOVEMENT.acceleration * control * dt;
    const rate = Math.min(accel / targetSpeed, 1);
    motion.vx += (dirX * targetSpeed - motion.vx) * rate;
    motion.vz += (dirZ * targetSpeed - motion.vz) * rate;

    const desiredYaw = Math.atan2(dirX, dirZ);
    motion.yaw = rotateTowards(motion.yaw, desiredYaw, MOVEMENT.turnSpeed * dt);
  } else if (motion.grounded) {
    const drop = MOVEMENT.deceleration * dt;
    const speed = horizontalSpeed(motion);
    // The speed guard matters independently of `drop`: dividing by a zero
    // speed would yield Infinity, and 0 * Infinity is NaN.
    if (speed <= drop || speed < 1e-6) {
      motion.vx = 0;
      motion.vz = 0;
    } else {
      const scale = (speed - drop) / speed;
      motion.vx *= scale;
      motion.vz *= scale;
    }
  }
};

/**
 * Stop a rising player at the underside of the platform above them.
 *
 * Runs BEFORE the ground test, because a player pushed down out of a ceiling
 * may immediately be standing on something, and the ground test should see the
 * corrected height rather than the one that was inside a slab.
 */
const resolveCeiling = (
  motion: PlayerMotion,
  previousY: number,
  collision: WorldCollision,
): void => {
  if (motion.vy <= 0) return;

  const ceiling = collision.ceilingYAt(motion.x, motion.z, previousY + PLAYER_HEIGHT);
  if (ceiling === null) return;
  if (motion.y + PLAYER_HEIGHT <= ceiling) return;

  motion.y = ceiling - PLAYER_HEIGHT;
  // The climb stops dead; horizontal travel is untouched, so a player who
  // clips a corner slides along under it rather than being halted.
  motion.vy = 0;
};

/**
 * Land on whatever platform is under the player, or keep falling.
 *
 * Leaving the ground by ANY means - jumping, walking off a platform edge -
 * must clear `grounded`, or the fall animation never plays and a second ground
 * jump stays available in mid-air.
 */
const resolveGround = (
  motion: PlayerMotion,
  previousY: number,
  collision: WorldCollision,
): void => {
  const surfaceY = collision.surfaceYAt(motion.x, motion.z);

  if (surfaceY === null || motion.vy > 0 || motion.y > surfaceY) {
    motion.grounded = false;
    return;
  }

  // Only land when falling onto the surface from above; a player who has
  // already dropped past a platform must not be snapped back up onto it.
  if (!collision.canLandOn(previousY, surfaceY)) {
    motion.grounded = false;
    return;
  }

  motion.y = surfaceY;
  motion.vy = 0;
  motion.grounded = true;
};

/** Shortest-path rotation from `current` toward `target`, capped at `maxDelta`. */
const rotateTowards = (current: number, target: number, maxDelta: number): number => {
  let diff = target - current;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  if (Math.abs(diff) <= maxDelta) return target;
  return current + Math.sign(diff) * maxDelta;
};
