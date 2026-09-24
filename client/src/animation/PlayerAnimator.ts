import { PlayerAnimationState } from '@obby/shared';
import { Group, Quaternion, Vector3 } from 'three';
import {
  AIRBORNE,
  BACKFLIP_ANIM,
  FLIP_PIVOT_HEIGHT,
  IDLE,
  JUMP_START,
  LANDING,
  LOCOMOTION,
  TRANSITIONS,
} from '../config/animationConfig.js';
import type { AnimationInput } from './AnimationInput.js';
import { BackflipAnimator } from './BackflipAnimator.js';
import { LocomotionCycle } from './LocomotionCycle.js';
import { PoseBuffer } from './PoseBuffer.js';
import type { PlayerRig } from './rig/PlayerRig.js';

/**
 * Backflip axis: the character's local right axis. A NEGATIVE rotation about
 * it takes the head backward and the feet forward - a backflip, not a front
 * flip. Applied to the flip pivot only.
 */
const FLIP_AXIS = new Vector3(1, 0, 0);

const clamp = (value: number, min: number, max: number): number =>
  value < min ? min : value > max ? max : value;

/** Smoothstep easing for state cross-fades. */
const ease = (t: number): number => t * t * (3 - 2 * t);

/**
 * The player animation controller: a small state machine that turns gameplay
 * signals into a skeleton pose.
 *
 * Responsibilities and boundaries:
 *   - It owns visual state ONLY. It never mutates the player's position,
 *     velocity or progression, and the server stays authoritative for gameplay.
 *   - It writes to bones (via PlayerRig), to a flip pivot node, and to a
 *     visual bob node. It never touches the character's physics root.
 *
 * Blending: every state writes a full pose into a buffer, and transitions are
 * a plain lerp from a snapshot of whatever was on screen into the new state's
 * pose. That gives smooth interpolation between any two states without an
 * authored transition matrix.
 */
export class PlayerAnimator {
  private readonly rig: PlayerRig;
  private readonly flipPivot: Group;
  private readonly visual: Group;

  private readonly locomotion = new LocomotionCycle();
  private readonly backflip = new BackflipAnimator();

  /** Pose the active state wants this frame. */
  private readonly targetPose = new PoseBuffer();
  /** Snapshot of what was on screen when the current transition began. */
  private readonly fromPose = new PoseBuffer();
  /** What is actually applied this frame. */
  private readonly outputPose = new PoseBuffer();

  private readonly pivotRotation = new Quaternion();

  private state: PlayerAnimationState = PlayerAnimationState.Idle;
  private stateTime = 0;
  private blendTime = 0;
  private blendDuration = 0;

  private idleTime = 0;
  private wasGrounded = true;

  constructor(rig: PlayerRig, flipPivot: Group, visual: Group) {
    this.rig = rig;
    this.flipPivot = flipPivot;
    this.visual = visual;

    this.flipPivot.position.y = FLIP_PIVOT_HEIGHT;
    this.visual.position.y = -FLIP_PIVOT_HEIGHT;
  }

  /** The visual state currently being played. Replicated for remote players. */
  get currentState(): PlayerAnimationState {
    return this.state;
  }

  /** True while a flip rotation is in flight. */
  get isFlipping(): boolean {
    return this.backflip.isFlipping;
  }

  /** Flips started in the current airborne window. */
  get flipIndex(): number {
    return this.backflip.flipIndex;
  }

  /** Clear all animation state, e.g. after a server respawn. */
  reset(): void {
    this.backflip.reset();
    this.setState(PlayerAnimationState.Idle, 0);
    this.targetPose.reset();
    this.fromPose.reset();
    this.outputPose.reset();
    this.rig.resetToBindPose();
    this.flipPivot.quaternion.identity();
    this.visual.position.y = -FLIP_PIVOT_HEIGHT;
  }

  /** Advance one frame and write the result to the skeleton. */
  update(delta: number, input: AnimationInput): void {
    this.stateTime += delta;

    const flipFinished = this.backflip.update(delta);
    this.resolveState(delta, input, flipFinished);
    this.writeStatePose(delta, input);
    this.blendAndApply(delta);
  }

  // ---------------------------------------------------------------- state

  private resolveState(
    delta: number,
    input: AnimationInput,
    flipFinished: boolean,
  ): void {
    // Landing cancels any rotation still in flight, easing to upright rather
    // than snapping - the character must never be left tilted on the ground.
    if (input.landed || (input.grounded && !this.wasGrounded)) {
      if (this.backflip.isFlipping) this.backflip.abort();
      this.setState(PlayerAnimationState.Landing, TRANSITIONS.toLanding);
      this.wasGrounded = true;
      return;
    }
    this.wasGrounded = input.grounded;

    if (input.backflipRequested) {
      this.backflip.request();
      this.setState(this.backflipState(), TRANSITIONS.toBackflip);
      return;
    }

    if (input.jumpStarted) {
      this.setState(PlayerAnimationState.JumpStart, TRANSITIONS.toJumpStart);
      return;
    }

    if (this.backflip.isFlipping) {
      // Stay in the flip state, but keep the chained/single distinction fresh.
      const expected = this.backflipState();
      if (this.state !== expected) this.setState(expected, TRANSITIONS.toBackflip);
      return;
    }

    if (flipFinished && !input.grounded) {
      this.setState(PlayerAnimationState.Airborne, TRANSITIONS.toAirborne);
      return;
    }

    if (!input.grounded) {
      // A short jump-start pose plays before handing over to the airborne pose.
      if (
        this.state === PlayerAnimationState.JumpStart &&
        this.stateTime < JUMP_START.duration
      ) {
        return;
      }
      this.setState(PlayerAnimationState.Airborne, TRANSITIONS.toAirborne);
      return;
    }

    // Grounded: hold the landing pose briefly, then recover into locomotion.
    if (
      this.state === PlayerAnimationState.Landing &&
      this.stateTime < LANDING.duration
    ) {
      return;
    }

    this.setState(this.locomotionState(input.horizontalSpeed), TRANSITIONS.toLocomotion);
    void delta;
  }

  private locomotionState(speed: number): PlayerAnimationState {
    if (speed < LOCOMOTION.idleSpeed) return PlayerAnimationState.Idle;
    return speed >= LOCOMOTION.walkSpeed
      ? PlayerAnimationState.Run
      : PlayerAnimationState.Walk;
  }

  private backflipState(): PlayerAnimationState {
    return this.backflip.flipIndex > 1
      ? PlayerAnimationState.ChainedBackflip
      : PlayerAnimationState.Backflip;
  }

  private setState(next: PlayerAnimationState, duration: number): void {
    if (next === this.state) return;

    // Blend out of exactly what is on screen right now, so a transition
    // interrupted mid-blend still starts from a continuous pose.
    this.fromPose.copyFrom(this.outputPose);
    this.state = next;
    this.stateTime = 0;
    this.blendTime = 0;
    this.blendDuration = duration;
  }

  // ----------------------------------------------------------------- pose

  private writeStatePose(delta: number, input: AnimationInput): void {
    switch (this.state) {
      case PlayerAnimationState.Idle:
        this.locomotion.settleTowardNeutral(delta);
        this.writeIdlePose(delta);
        break;

      case PlayerAnimationState.Walk:
      case PlayerAnimationState.Run:
        this.locomotion.advance(delta, input.horizontalSpeed);
        this.locomotion.writePose(this.targetPose, input.horizontalSpeed);
        break;

      case PlayerAnimationState.JumpStart:
        this.targetPose.applyDefinition(JUMP_START.pose);
        this.targetPose.bobY = JUMP_START.bobY;
        break;

      case PlayerAnimationState.Airborne:
        this.writeAirbornePose(input.verticalVelocity);
        break;

      case PlayerAnimationState.Landing:
        this.writeLandingPose();
        break;

      case PlayerAnimationState.Backflip:
      case PlayerAnimationState.ChainedBackflip:
        this.writeBackflipPose(input.verticalVelocity);
        break;
    }
  }

  private writeIdlePose(delta: number): void {
    this.idleTime += delta;
    const breath = Math.sin(this.idleTime * IDLE.breathFrequency * Math.PI * 2);

    this.targetPose.applyDefinition(IDLE.basePose);
    this.targetPose.add('Spine1', breath * IDLE.breathAmount);
    this.targetPose.add('Spine2', breath * IDLE.breathAmount * 0.5);
    this.targetPose.add('Neck1', -breath * IDLE.breathAmount * 0.6);
    this.targetPose.add('ArmL1', 0, 0, -breath * IDLE.breathAmount * 0.4);
    this.targetPose.add('ArmR1', 0, 0, breath * IDLE.breathAmount * 0.4);
    this.targetPose.bobY = breath * IDLE.breathBob;
  }

  private writeAirbornePose(verticalVelocity: number): void {
    // -1 fully falling .. +1 fully rising.
    const t = clamp(verticalVelocity / AIRBORNE.velocityReference, -1, 1);
    const riseWeight = (t + 1) * 0.5;

    this.targetPose.applyDefinition(AIRBORNE.fall, 1 - riseWeight);
    this.targetPose.blendInDefinition(AIRBORNE.rise, riseWeight);
    this.targetPose.bobY = 0;
  }

  private writeLandingPose(): void {
    // Deepest at touchdown, recovering over the landing window.
    const t = clamp(this.stateTime / LANDING.duration, 0, 1);
    const depth = 1 - ease(t);
    this.targetPose.applyDefinition(LANDING.pose, depth);
    this.targetPose.bobY = LANDING.bobY * depth;
  }

  private writeBackflipPose(verticalVelocity: number): void {
    const tuck = this.backflip.tuckAmount;

    // Underneath the tuck is the airborne pose, so a flip that finishes early
    // or is cut short reads as a continuation of the jump rather than a cut.
    this.writeAirbornePose(verticalVelocity);
    this.targetPose.blendInDefinition(BACKFLIP_ANIM.tuckPose, tuck);

    // A touch of asymmetry keeps the tuck from looking mechanical.
    const asymmetry = BACKFLIP_ANIM.tuckAsymmetry * tuck;
    this.targetPose.add('LegL1', asymmetry);
    this.targetPose.add('LegR1', -asymmetry);
    this.targetPose.add('ArmL2', asymmetry);
    this.targetPose.add('ArmR2', -asymmetry);
    this.targetPose.bobY = 0;
  }

  // ---------------------------------------------------------------- apply

  private blendAndApply(delta: number): void {
    if (this.blendDuration > 0) {
      this.blendTime += delta;
      const t = clamp(this.blendTime / this.blendDuration, 0, 1);
      this.outputPose.lerpBetween(this.fromPose, this.targetPose, ease(t));
      if (t >= 1) this.blendDuration = 0;
    } else {
      this.outputPose.copyFrom(this.targetPose);
    }

    this.rig.applyPose(this.outputPose);

    // Rebuilt from a scalar every frame - see BackflipAnimator on drift.
    this.flipPivot.quaternion.setFromAxisAngle(FLIP_AXIS, -this.backflip.rotationAngle);

    // Bob is purely visual: it moves the model inside the pivot, never the
    // character root that carries the physics position.
    this.visual.position.y = -FLIP_PIVOT_HEIGHT + this.outputPose.bobY;
  }
}
