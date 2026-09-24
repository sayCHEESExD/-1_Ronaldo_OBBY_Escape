import {
  BACKFLIP,
  MOVEMENT,
  WorldCollision,
  copyMotion,
  createMotion,
  createSimEvents,
  horizontalSpeed,
  resetMotion,
  stepPlayer,
  type MoveMessage,
  type MovementInput,
  type PlayerAnimationState,
  type PlayerMotion,
  type PlayerMotionState,
  type SimParams,
} from '@obby/shared';
import { Vector3 } from 'three';
import { createAnimationInput, type AnimationInput } from '../animation/AnimationInput.js';
import type { InputState } from '../input/InputState.js';
import { PlayerCharacter } from './PlayerCharacter.js';

/** Inputs kept for re-simulation. Older ones are dropped as the server acks. */
const MAX_PENDING_INPUTS = 240;

/**
 * Fixed simulation timestep, in seconds.
 *
 * The client steps - and SENDS - at exactly this cadence regardless of render
 * frame rate. That matters for authority: every simulated step has to reach
 * the server, or the server falls behind and its authoritative position lags
 * the player's. A fixed step also bounds the message rate on a high-refresh
 * display and makes the two simulations bit-comparable.
 */
const FIXED_DT = 1 / 60;

/** Most steps one render frame may run, so a stall cannot spiral. */
const MAX_STEPS_PER_FRAME = 5;

/**
 * Seconds the death squash plays before the player is placed at spawn.
 *
 * Short on purpose: it exists to give the death a beat of its own, not to be
 * a cutscene. The simulation is frozen for exactly this long.
 */
const DEATH_DURATION = 0.22;

/**
 * Ground speed above which footsteps sound. Below it the player is standing -
 * or drifting to a stop, which should fall silent rather than shuffle.
 */
const WALK_SOUND_MIN_SPEED = 0.8;

/** Seconds the character pops back up to full size after arriving at spawn. */
const ARRIVE_DURATION = 0.13;

/**
 * Longest the client will ignore authoritative state after predicting a death.
 *
 * A FAILSAFE, not the mechanism - the barrier is normally lifted by the
 * server's own Respawn message. It exists for the one case that never gets
 * one: a trophy claim the server REJECTS, where the client mispredicted a
 * respawn that is never going to happen and has to be corrected back.
 */
const RESPAWN_ACK_TIMEOUT = 1.5;

/**
 * Position error above which prediction snaps instead of easing.
 *
 * Small corrections are blended into the render position so ordinary
 * disagreement is invisible; a large one means the server did something the
 * client could not predict - a respawn, a rejected input - and should be shown
 * immediately rather than slid to.
 */
const SNAP_DISTANCE = 4;

/** How quickly a small correction is eased away, per second. */
const CORRECTION_RATE = 14;

const lerp = (from: number, to: number, alpha: number): number =>
  from + (to - from) * alpha;

/** Shared empty result, so a quiet frame allocates nothing. */
const EMPTY_INPUTS: MoveMessage[] = [];

/**
 * How the player last arrived somewhere they did not walk to.
 *
 * `respawn` is a deliberate reset of the run; `correction` is the server
 * disagreeing with prediction. Both skip the camera's smoothing, but only a
 * respawn is allowed to be seen.
 */
export type PlacementKind = 'none' | 'respawn' | 'correction';

/** One unacknowledged input, kept so it can be replayed after a correction. */
interface PendingInput {
  seq: number;
  dt: number;
  input: MovementInput;
}

/**
 * The authoritative fields the client reconciles against.
 *
 * This must cover EVERY field of `PlayerMotion`, not just the visible ones.
 * Replay re-runs `stepPlayer`, and that reads latched state - the jump edge
 * and the flips already taken this airtime - as well as the transform. Restore
 * a partial state and replay takes different decisions than the server did,
 * which is divergence the correction offset then has to hide.
 */
export interface AuthoritativeMotion {
  x: number;
  y: number;
  z: number;
  rotationY: number;
  velocityX: number;
  velocityY: number;
  velocityZ: number;
  grounded: boolean;
  flipCount: number;
  flipsRemaining: number;
  lastInputSeq: number;
  /** Treadmill the server has the player running on, or 0. */
  treadmillTier: number;
  /** Latched jump edge - whether the server had the control held down. */
  jumpLatched: boolean;
  /** Flips already taken this airtime, which sets the next flip's lift. */
  flipsThisAirtime: number;
}

/**
 * The locally controlled player: a PREDICTION of a server-owned simulation.
 *
 * The server is authoritative. This class runs the identical `stepPlayer` from
 * shared so the character responds instantly, keeps every input the server has
 * not acknowledged, and on each server update snaps to the authoritative state
 * and replays those inputs. Because both sides run the same function, replay
 * converges instead of fighting.
 *
 * Nothing here writes a transform to the network - the only thing sent is the
 * input that produced this frame.
 */
export class LocalPlayer {
  readonly character: PlayerCharacter;

  /**
   * RENDER position: the simulated state interpolated to this exact frame and
   * carrying the reconciliation offset.
   *
   * The camera and the world triggers both read this rather than the raw
   * simulation, because the raw simulation only advances on 60Hz boundaries.
   * On a 144Hz display most frames advanced it by nothing and every third
   * frame by a whole step, which is a stutter the camera then faithfully
   * reproduced.
   */
  readonly position = new Vector3();
  readonly velocity = new Vector3();

  /** Simulation state one step behind, for render interpolation. */
  private readonly previous = { x: 0, y: 0, z: 0 };

  private readonly motion: PlayerMotion = createMotion();
  private readonly events = createSimEvents();
  private readonly replayEvents = createSimEvents();
  private readonly collision: WorldCollision;
  private readonly params: SimParams = {
    moveMultiplier: 1,
    backflipCapacity: 1,
    maxTreadmillTier: 1,
  };

  private readonly pending: PendingInput[] = [];
  private nextSeq = 1;
  /** Inputs simulated but not yet handed to the network. */
  private readonly outgoing: MoveMessage[] = [];
  /** Leftover render time not yet consumed by a fixed step. */
  private accumulator = 0;

  /** Render-space offset that eases a small correction away. */
  private readonly correction = new Vector3();

  /**
   * How the player was last PLACED, cleared when read.
   *
   * The camera has to know three things apart: a player who moved (smooth), a
   * player the server corrected (arrive silently), and a player who respawned
   * (arrive, and play the spawn dolly). A correction that announced itself
   * with a zoom would fire on ordinary packet loss.
   *
   * A flag rather than a callback, so the camera is still updated exactly once
   * in the frame's normal order.
   */
  private placement: PlacementKind = 'none';

  /**
   * Seconds into the death squash, or -1 when not dying.
   *
   * While this runs the simulation does not step and NO input is emitted, so
   * the player cannot drift, fall further, or be moved by anything the player
   * presses. It is the local death transition state the whole fix hangs on.
   */
  private deathTime = -1;

  /** Seconds into the arrival pop, or -1 when not arriving. */
  private arriveTime = -1;

  /**
   * True from predicting a death until the server acknowledges it.
   *
   * THE fix for the hosted stale-state replay. Between those two moments every
   * state patch still in flight describes the player as they were an instant
   * BEFORE they died - alive, at the redline or on the pad - and applying one
   * teleports them back there for a frame. Locally that window is under a
   * frame and invisible; over a real connection it is a whole round trip.
   */
  private awaitingRespawn = false;

  /** Seconds the barrier has been up, against RESPAWN_ACK_TIMEOUT. */
  private respawnWait = 0;

  /**
   * Flips that BEGAN during the last update, for one sound each.
   *
   * Counted from `flipCount`, the simulation's own monotonic total, rather
   * than from the jump button: `stepPlayer` only increments it when a flip was
   * actually allowed, so a press with no flips left contributes nothing here
   * and can never make a sound. The animator's `backflipRequested` edge is no
   * use for this - it is ORed across a frame's substeps, so a chain that lands
   * two flips in one frame would report one.
   */
  private flipsStarted = 0;

  private readonly animationInput: AnimationInput = createAnimationInput();

  constructor(collision: WorldCollision) {
    this.collision = collision;
    this.character = new PlayerCharacter();
    this.motion.backflipsRemaining = this.params.backflipCapacity;
    this.previous.x = this.motion.x;
    this.previous.y = this.motion.y;
    this.previous.z = this.motion.z;
    this.syncFromMotion();
    this.syncCharacter();
  }

  get horizontalSpeed(): number {
    return horizontalSpeed(this.motion);
  }

  get rotationY(): number {
    return this.motion.yaw;
  }

  get isGrounded(): boolean {
    return this.motion.grounded;
  }

  /**
   * True on the frame the player touched down.
   *
   * The edge the shared simulation already produces, ORed across this frame's
   * substeps - so it fires once per landing however many steps ran, and never
   * while merely standing.
   */
  get justLanded(): boolean {
    return this.events.landed;
  }

  /**
   * True on the frame the player jumped off the ground.
   *
   * The simulation's own `jumpStarted` edge, ORed across the frame's
   * substeps. It is raised only by a GROUNDED press - an airborne press is a
   * backflip and raises `backflipRequested` instead - and reconciliation
   * replays into separate events, so a replayed jump never re-fires it.
   */
  get justJumped(): boolean {
    return this.events.jumpStarted;
  }

  /**
   * Whether the character is running on its feet right now: grounded, alive,
   * and either moving or running on a treadmill belt. What footsteps follow.
   */
  get isWalking(): boolean {
    if (this.isDying || !this.motion.grounded) return false;
    if (this.motion.treadmillTier > 0) return true;
    return this.horizontalSpeed > WALK_SOUND_MIN_SPEED;
  }

  get animationState(): PlayerAnimationState {
    return this.character.animationState;
  }

  /**
   * How many flips began during the last update.
   *
   * Zero for a press the simulation refused, and one per flip in a chain even
   * when several land in the same frame.
   */
  get flipsStartedThisFrame(): number {
    return this.flipsStarted;
  }

  /**
   * Flips performed in the CURRENT airborne window.
   *
   * The simulation's own chain counter, reset on landing - so it is the
   * position of a flip within its chain, which is what the sound rises with.
   */
  get flipChainLength(): number {
    return this.motion.flipsThisAirtime;
  }

  /** Flips the player may still perform before landing. */
  get flipsRemaining(): number {
    return this.motion.backflipsRemaining;
  }

  /** Total flips allowed per airborne window - equal to the player's level. */
  get flipCapacity(): number {
    return this.params.backflipCapacity;
  }

  /** Flips currently in flight - distinct from how many are available. */
  get flipsInProgress(): number {
    return this.character.animator.isFlipping ? this.character.animator.flipIndex : 0;
  }

  /** Compact motion state, for diagnostics only - never sent. */
  get motionState(): PlayerMotionState {
    return {
      speed: this.horizontalSpeed,
      verticalVelocity: this.motion.vy,
      grounded: this.motion.grounded,
      flipCount: this.motion.flipCount,
    };
  }

  /**
   * Take the inputs simulated since the last call.
   *
   * Every one must be sent: the server advances only by the inputs it
   * receives, so a dropped input is authoritative movement that never happens.
   */
  drainOutgoing(): MoveMessage[] {
    if (this.outgoing.length === 0) return EMPTY_INPUTS;
    const batch = this.outgoing.slice();
    this.outgoing.length = 0;
    return batch;
  }

  get movementMultiplier(): number {
    return this.params.moveMultiplier;
  }

  /** Actual sprint speed in world units per second. */
  get maxRunSpeed(): number {
    return MOVEMENT.runSpeed * this.params.moveMultiplier;
  }

  /** Show the boot the server says this player has equipped. Cosmetic only. */
  setBootSlot(slot: number): void {
    this.character.boots.setSlot(slot);
  }

  /** Show the trail and aura the server says this player has equipped. */
  setCosmetics(trailSlot: number, auraSlot: number): void {
    this.character.setCosmetics(trailSlot, auraSlot);
  }

  /**
   * Apply the server's movement multiplier.
   *
   * Resolved server-side from level and rebirth; prediction uses it so the
   * client simulates at exactly the authoritative speed.
   */
  setMoveMultiplier(multiplier: number): void {
    if (!Number.isFinite(multiplier) || multiplier <= 0) return;
    this.params.moveMultiplier = multiplier;
  }

  /**
   * Apply the server's treadmill gate.
   *
   * Prediction uses it so stepping onto a machine feels instant, but the
   * server re-derives it from its own rebirth count every step - predicting a
   * tier the player has not unlocked would simply be corrected away.
   */
  setMaxTreadmillTier(tier: number): void {
    if (!Number.isFinite(tier)) return;
    this.params.maxTreadmillTier = Math.max(0, Math.floor(tier));
  }

  /** Treadmill the player is running on, or 0. */
  get treadmillTier(): number {
    return this.motion.treadmillTier;
  }

  /** Apply the server's flip allowance. */
  setBackflipCapacity(capacity: number): void {
    const clamped = Math.max(0, Math.min(capacity, BACKFLIP.maxCapacity));
    if (clamped === this.params.backflipCapacity) return;
    this.params.backflipCapacity = clamped;
    if (this.motion.grounded) this.motion.backflipsRemaining = clamped;
  }

  /**
   * Snap the prediction to an authoritative transform.
   *
   * Used for a server respawn: pending inputs are abandoned because they
   * described a run that no longer exists.
   */
  teleport(x: number, y: number, z: number, rotationY: number): void {
    resetMotion(this.motion, this.params.backflipCapacity, x, y, z, rotationY);
    this.previous.x = x;
    this.previous.y = y;
    this.previous.z = z;
    this.pending.length = 0;
    // Anything still queued for the network describes the run that just
    // ended. Sending it would advance the server from a position the player
    // has already left.
    this.outgoing.length = 0;
    this.accumulator = 0;
    this.correction.set(0, 0, 0);
    this.placement = 'respawn';
    // The squash is over; the character pops back to full size on arrival.
    this.deathTime = -1;
    this.arriveTime = 0;
    this.character.resetAnimation();
    this.character.setVisualScale(0.1, 0.1, 0.1);
    this.syncFromMotion();
    this.syncCharacter();
  }

  /**
   * Enter the local death transition.
   *
   * Everything describing the run just ended is dropped HERE, at the moment of
   * death, rather than when the server gets round to confirming it: the
   * unacknowledged inputs, the queued outgoing ones, the reconciliation offset
   * and the velocity. The simulation then stops stepping until the player is
   * placed, so no later frame can advance the old state.
   */
  beginDeath(): void {
    if (this.deathTime >= 0) return;
    this.deathTime = 0;
    this.arriveTime = -1;
    this.awaitingRespawn = true;
    this.respawnWait = 0;
    this.pending.length = 0;
    this.outgoing.length = 0;
    this.correction.set(0, 0, 0);
    this.accumulator = 0;
    this.motion.vx = 0;
    this.motion.vy = 0;
    this.motion.vz = 0;
  }

  /** True while the death squash is playing. */
  get isDying(): boolean {
    return this.deathTime >= 0;
  }

  /** True once the squash has run its course and the player may be placed. */
  get deathComplete(): boolean {
    return this.deathTime >= DEATH_DURATION;
  }

  /**
   * The server has confirmed the respawn; stale patches can no longer arrive.
   *
   * Called from the Respawn message handler, which is ordered on the same
   * socket as the state patches - so everything the server sends after it is
   * post-respawn by construction.
   */
  acknowledgeRespawn(): void {
    this.awaitingRespawn = false;
    this.respawnWait = 0;
  }

  /**
   * Reconcile against the server's authoritative state.
   *
   * Snaps to what the server simulated, discards inputs it has already
   * consumed, and replays the rest so the prediction lands back where the
   * player expects to be.
   */
  reconcile(state: AuthoritativeMotion): void {
    // The barrier. Until the server confirms the respawn, its state still
    // describes the player alive at the place they died - applying it is
    // exactly the stale replay this guards against.
    if (this.awaitingRespawn) return;

    const predictedX = this.motion.x;
    const predictedY = this.motion.y;
    const predictedZ = this.motion.z;

    this.motion.x = state.x;
    this.motion.y = state.y;
    this.motion.z = state.z;
    this.motion.vx = state.velocityX;
    this.motion.vy = state.velocityY;
    this.motion.vz = state.velocityZ;
    this.motion.yaw = state.rotationY;
    this.motion.grounded = state.grounded;
    this.motion.flipCount = state.flipCount;
    this.motion.backflipsRemaining = state.flipsRemaining;
    this.motion.treadmillTier = state.treadmillTier;
    // The latched half. Without these two the replay below re-derives its own
    // jump and flip edges from whatever the prediction happened to be holding,
    // so a pending flip could fire twice or not at all - the allowance jumping
    // 8/9 -> 9/9 in mid air, and the arc jumping with it. They cost two bytes
    // a patch and make replay bit-exact.
    this.motion.jumpLatched = state.jumpLatched;
    this.motion.flipsThisAirtime = state.flipsThisAirtime;

    // Drop everything the server has already simulated, then replay the rest.
    let kept = 0;
    for (const entry of this.pending) {
      if (entry.seq <= state.lastInputSeq) continue;
      this.pending[kept] = entry;
      kept += 1;
    }
    this.pending.length = kept;

    for (const entry of this.pending) {
      stepPlayer(
        this.motion,
        entry.input,
        this.params,
        entry.dt,
        this.collision,
        this.replayEvents,
      );
    }

    // Carry the visible difference as an offset and ease it away, so a small
    // correction does not read as a teleport.
    const dx = predictedX - this.motion.x;
    const dy = predictedY - this.motion.y;
    const dz = predictedZ - this.motion.z;
    const snapped = Math.hypot(dx, dy, dz) > SNAP_DISTANCE;
    if (snapped) {
      this.correction.set(0, 0, 0);
    } else {
      this.correction.set(dx, dy, dz);
    }

    // The interpolation baseline is deliberately NOT collapsed onto the
    // replayed state. Replay re-runs the same inputs the client already ran,
    // so `previous` is still one step behind and interpolation stays
    // continuous; any real divergence is carried by `correction`, which eases.
    // Collapsing it here re-based the blend twenty times a second, and every
    // one of those was a visible tick in the follow.
    //
    // A SNAP is the exception: the server put the player somewhere the client
    // never simulated, so there is no earlier state worth blending from.
    if (snapped) {
      this.previous.x = this.motion.x;
      this.previous.y = this.motion.y;
      this.previous.z = this.motion.z;
      // The camera must not ease across this either. A snap is the server
      // PLACING the player, and during the round trip of a respawn there is a
      // window where an in-flight patch still carries the pre-respawn
      // position, which lands here.
      //
      // Reported as a CORRECTION, not a respawn: it must arrive invisibly.
      // A respawn already pending is not downgraded - the dolly belongs to the
      // respawn that is still on its way to being drawn.
      if (this.placement === 'none') this.placement = 'correction';
    }

    this.syncFromMotion();
    this.syncCharacter();
  }

  /**
   * Advance the prediction and record the inputs for the server.
   *
   * Simulation runs on a FIXED timestep so client and server take identical
   * steps; a render frame may therefore produce zero, one or several inputs.
   * Animation is still updated once per render frame with the real delta.
   *
   * @param input     normalised input snapshot
   * @param cameraYaw yaw the camera faces, so movement is camera-relative
   */
  update(delta: number, input: Readonly<InputState>, cameraYaw: number): void {
    this.tickRespawnBarrier(delta);

    // Frozen. No step, no input emitted, no gravity - the old state cannot
    // advance, and nothing the player presses can move a dead character.
    this.flipsStarted = 0;

    if (this.deathTime >= 0) {
      // No step runs, so no edge can happen - clear the last live frame's, or
      // a jump or landing on the frame of death would read as repeating for
      // the whole transition.
      this.events.jumpStarted = false;
      this.events.landed = false;
      this.events.backflipRequested = false;
      this.deathTime += delta;
      this.applyDeathScale();
      // The LOCAL simulation is frozen, but the server's must not be. It
      // advances only by the inputs it receives, and a FALL is confirmed by
      // the server watching its own player cross the death plane - so going
      // silent here means a fall that is never acknowledged and a barrier that
      // only the failsafe ever lifts. Neutral input: no stick, no jump.
      this.emitIdleInputs(delta);
      this.character.update(delta, this.animationInput);
      return;
    }

    this.accumulator += Math.max(0, delta);

    const flipCountBefore = this.motion.flipCount;
    let steps = 0;
    let jumpStarted = false;
    let landed = false;
    let backflipRequested = false;

    while (this.accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
      this.accumulator -= FIXED_DT;
      steps += 1;

      const movement: MovementInput = {
        moveX: input.moveX,
        moveZ: input.moveZ,
        jump: input.jump,
        sprint: input.sprint,
        cameraYaw,
      };

      const seq = this.nextSeq;
      this.nextSeq += 1;

      // Remember where the step started so the frame can be rendered part-way
      // between two simulation states instead of snapping between them.
      this.previous.x = this.motion.x;
      this.previous.y = this.motion.y;
      this.previous.z = this.motion.z;

      stepPlayer(this.motion, movement, this.params, FIXED_DT, this.collision, this.events);

      // Edges from every substep must survive to the animator, or a jump that
      // happened in an early substep would be silently dropped.
      jumpStarted = jumpStarted || this.events.jumpStarted;
      landed = landed || this.events.landed;
      backflipRequested = backflipRequested || this.events.backflipRequested;

      this.pending.push({ seq, dt: FIXED_DT, input: movement });
      if (this.pending.length > MAX_PENDING_INPUTS) this.pending.shift();

      this.outgoing.push({
        seq,
        dt: FIXED_DT,
        moveX: movement.moveX,
        moveZ: movement.moveZ,
        jump: movement.jump,
        sprint: movement.sprint,
        cameraYaw,
      });
    }

    // A long stall would otherwise leave a huge backlog to chew through.
    if (this.accumulator > FIXED_DT * MAX_STEPS_PER_FRAME) this.accumulator = 0;

    this.flipsStarted = Math.max(0, this.motion.flipCount - flipCountBefore);

    this.events.jumpStarted = jumpStarted;
    this.events.landed = landed;
    this.events.backflipRequested = backflipRequested;

    this.advanceArrival(delta);
    this.decayCorrection(delta);
    this.syncFromMotion();
    this.syncCharacter();
    this.updateAnimation(delta);
    // The trail is emitted from the RENDERED position and reads the same speed
    // the animator does, so a treadmill runner glows without laying a ribbon
    // across the map.
    this.character.updateEffects(
      delta,
      this.motion.x + this.correction.x,
      this.motion.y + this.correction.y,
      this.motion.z + this.correction.z,
      this.motion.treadmillTier > 0 ? 0 : this.horizontalSpeed,
    );
  }

  /**
   * How the player was placed since this was last called, if at all.
   *
   * Reading CLEARS it, so exactly one frame reacts to a given placement.
   */
  consumePlacement(): PlacementKind {
    const kind = this.placement;
    this.placement = 'none';
    return kind;
  }

  /** Copy the predicted motion out, for tests and diagnostics. */
  readMotion(into: PlayerMotion): void {
    copyMotion(this.motion, into);
  }

  /**
   * Squash, then vanish.
   *
   * Written to the character's VISUAL node, never to the physics root, so this
   * is presentation only - the same rule the animator follows. Two beats: a
   * quick squash that reads as an impact, then a shrink out.
   */
  private applyDeathScale(): void {
    const t = Math.min(this.deathTime / DEATH_DURATION, 1);
    if (t < 0.45) {
      const k = t / 0.45;
      this.character.setVisualScale(1 + 0.3 * k, 1 - 0.55 * k, 1 + 0.3 * k);
      return;
    }
    const k = (t - 0.45) / 0.55;
    const shrink = Math.max(0, 1 - k);
    this.character.setVisualScale(1.3 * shrink, 0.45 * shrink, 1.3 * shrink);
  }

  /** Pop back to full size after being placed. Mirrors the death squash. */
  private advanceArrival(delta: number): void {
    if (this.arriveTime < 0) return;
    this.arriveTime += delta;
    const t = Math.min(this.arriveTime / ARRIVE_DURATION, 1);
    if (t >= 1) {
      this.arriveTime = -1;
      this.character.setVisualScale(1, 1, 1);
      return;
    }
    // Ease out with a touch of overshoot, so arriving reads as landing rather
    // than fading in.
    const scale = 0.1 + 0.9 * t * (2 - t) + 0.08 * Math.sin(t * Math.PI);
    this.character.setVisualScale(scale, scale, scale);
  }

  /**
   * Emit input without simulating it.
   *
   * Used only while dead. The sequence keeps advancing and the server keeps
   * stepping, but nothing touches this client's own motion or its pending
   * list - so there is no local state to replay and nothing to reconcile
   * against until the respawn lands.
   */
  private emitIdleInputs(delta: number): void {
    this.accumulator += Math.max(0, delta);
    let steps = 0;
    while (this.accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
      this.accumulator -= FIXED_DT;
      steps += 1;
      this.outgoing.push({
        seq: this.nextSeq,
        dt: FIXED_DT,
        moveX: 0,
        moveZ: 0,
        jump: false,
        sprint: false,
        cameraYaw: this.motion.yaw,
      });
      this.nextSeq += 1;
    }
    if (this.accumulator > FIXED_DT * MAX_STEPS_PER_FRAME) this.accumulator = 0;
  }

  /** Lift the barrier if the server never acknowledged the death. */
  private tickRespawnBarrier(delta: number): void {
    if (!this.awaitingRespawn) return;
    this.respawnWait += delta;
    if (this.respawnWait < RESPAWN_ACK_TIMEOUT) return;
    // No Respawn message came. The most likely reason is a request the server
    // refused, so the prediction was wrong and reconciliation must be allowed
    // to correct it.
    this.awaitingRespawn = false;
    this.respawnWait = 0;
  }

  /** Ease the render-space correction offset back to zero. */
  private decayCorrection(delta: number): void {
    if (this.correction.lengthSq() < 1e-8) {
      this.correction.set(0, 0, 0);
      return;
    }
    this.correction.multiplyScalar(Math.exp(-CORRECTION_RATE * delta));
  }

  /**
   * Resolve the render transform for this frame.
   *
   * `alpha` is how far the leftover accumulator has carried us into the NEXT
   * simulation step, so blending the previous state toward the current one by
   * it produces continuous motion at any refresh rate. The eased
   * reconciliation offset is folded in here too, so exactly one transform
   * exists for the camera, the character and the triggers to agree on.
   */
  private syncFromMotion(): void {
    const alpha = Math.min(Math.max(this.accumulator / FIXED_DT, 0), 1);
    this.position.set(
      lerp(this.previous.x, this.motion.x, alpha) + this.correction.x,
      lerp(this.previous.y, this.motion.y, alpha) + this.correction.y,
      lerp(this.previous.z, this.motion.z, alpha) + this.correction.z,
    );
    this.velocity.set(this.motion.vx, this.motion.vy, this.motion.vz);
  }

  private updateAnimation(delta: number): void {
    this.animationInput.grounded = this.motion.grounded;
    // A player on a treadmill has zero velocity by design, so the animator is
    // handed the speed they are RUNNING at rather than the speed they are
    // travelling at. This is the one place the two differ.
    this.animationInput.horizontalSpeed =
      this.motion.treadmillTier > 0 ? this.maxRunSpeed : this.horizontalSpeed;
    this.animationInput.verticalVelocity = this.motion.vy;
    this.animationInput.jumpStarted = this.events.jumpStarted;
    this.animationInput.landed = this.events.landed;
    this.animationInput.backflipRequested = this.events.backflipRequested;
    this.character.update(delta, this.animationInput);
  }

  private syncCharacter(): void {
    // ONE render transform, already interpolated and already carrying the
    // eased correction. The camera follows the very same vector, so a
    // correction can never slide the character within the frame.
    this.character.setPosition(this.position.x, this.position.y, this.position.z);
    this.character.setYaw(this.motion.yaw);
  }
}
