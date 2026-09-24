import type { PlayerMotionState } from '@obby/shared';
import { Vector3 } from 'three';
import { createAnimationInput, type AnimationInput } from '../animation/AnimationInput.js';
import { PlayerCharacter } from './PlayerCharacter.js';

/** Seconds to converge on a newly received network transform. */
const INTERPOLATION_RATE = 12;

/**
 * Flips that may be waiting to be handed to the animator at once.
 *
 * The queue exists only so a chain that arrives inside ONE 20Hz patch still
 * reads as several rotations instead of one. A chain longer than this cannot
 * be told apart on screen anyway, and an UNBOUNDED queue is what let a joining
 * client replay another player's entire lifetime flip count as one endless
 * spin.
 */
const MAX_QUEUED_FLIPS = 4;

/**
 * Distance that means the server MOVED this player rather than simulated them
 * - a respawn.
 *
 * Interpolating across it would slide the character over the whole map, and
 * carrying flip state across it would keep a rotation alive for a run that no
 * longer exists.
 */
const TELEPORT_DISTANCE = 12;

/**
 * Seconds on the ground after which a still-turning flip is treated as stuck.
 *
 * The animator ABORTS a rotation on the landed edge and eases upright over
 * `BACKFLIP_ANIM.abortDuration` (0.14s), so this has to outlast that. It is a
 * last resort for the case where no landed edge was ever observed - a patch
 * gap that skipped the airborne window, or a client that arrived mid-flip.
 */
const FLIP_WATCHDOG_SECONDS = 0.35;

/**
 * A replicated player owned by the server.
 *
 * Its animation is RECONSTRUCTED locally from the compact motion state
 * (speed, vertical velocity, grounded, flip counter) using the same
 * PlayerAnimator the local player runs. No bone transforms cross the network.
 *
 * Remote players are non-colliding, so they can never block another player's
 * run through the obby. That is the whole meaning of "ghosted" here - they are
 * rendered completely normally: the SAME material and the SAME colours as the
 * local player, with no per-session tint. Every player looks like the model as
 * authored.
 *
 * Flip animation is DERIVED from authoritative state rather than driven by a
 * free-running timer: `flipCount` says a rotation began, and `grounded` says
 * the airborne window - and therefore the whole flip sequence - has ended.
 * Every path that puts the player back on the ground clears the flip, so a
 * rotation can never outlive the state that started it.
 */
export class RemotePlayer {
  /** True on the frame this remote player touched down. */
  landedThisFrame = false;

  readonly sessionId: string;
  readonly character: PlayerCharacter;

  private readonly current = new Vector3();
  private readonly target = new Vector3();
  private currentYaw = 0;
  private targetYaw = 0;
  private hasSnapped = false;

  private readonly animationInput: AnimationInput = createAnimationInput();

  /**
   * Last flip counter seen, and whether one has been seen at all.
   *
   * `flipCount` is a LIFETIME total that never resets, so it is only ever
   * meaningful as a difference against a baseline this client established
   * itself. Without the baseline flag, a player who had already flipped a
   * hundred times before we joined arrived as a hundred queued rotations.
   */
  private flipCountKnown = false;
  private lastFlipCount = 0;
  private queuedFlips = 0;
  private wasGrounded = true;
  /** Seconds continuously grounded, for the stuck-flip watchdog. */
  private groundedTime = 0;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
    this.character = new PlayerCharacter();
  }

  /** Feed the latest authoritative transform. Applied smoothly, not instantly. */
  setNetworkTransform(x: number, y: number, z: number, rotationY: number): void {
    this.target.set(x, y, z);
    this.targetYaw = rotationY;

    if (!this.hasSnapped) {
      this.hasSnapped = true;
      this.snapToTarget();
      return;
    }

    // A respawn is a jump no simulation produced. Snap rather than slide, and
    // drop the flip that belonged to the run which just ended.
    if (this.current.distanceToSquared(this.target) > TELEPORT_DISTANCE ** 2) {
      this.snapToTarget();
      this.queuedFlips = 0;
      this.character.resetAnimation();
    }
  }

  /**
   * Feed the replicated motion signals.
   *
   * A rise in `flipCount` means the remote player started a flip. It is only
   * queued while the authoritative state has them AIRBORNE: a flip that has
   * already ended on the server has no rotation left to play, and starting one
   * anyway is a rotation with nothing to stop it.
   */
  setMotionState(motion: PlayerMotionState): void {
    this.animationInput.horizontalSpeed = motion.speed;
    this.animationInput.verticalVelocity = motion.verticalVelocity;
    this.animationInput.grounded = motion.grounded;
    this.trackFlips(motion.flipCount, motion.grounded);
  }

  update(delta: number): void {
    const alpha = 1 - Math.exp(-INTERPOLATION_RATE * delta);
    this.current.lerp(this.target, alpha);
    this.currentYaw = interpolateAngle(this.currentYaw, this.targetYaw, alpha);
    this.applyToCharacter();

    const grounded = this.animationInput.grounded;
    this.animationInput.jumpStarted = this.wasGrounded && !grounded;
    this.animationInput.landed = !this.wasGrounded && grounded;
    // Reconstructed from replicated `grounded`; nothing extra is sent for it.
    this.landedThisFrame = this.animationInput.landed;
    this.wasGrounded = grounded;

    // Touching down ENDS the sequence, whatever is still queued: the server
    // says the airborne window is over, so anything left over describes
    // rotations that are never going to happen.
    if (this.animationInput.landed) this.queuedFlips = 0;

    // At most one flip per frame, so a chain reads as several rotations rather
    // than one long spin - and never at all while grounded, which is the
    // condition that used to let a queue restart a flip forever.
    this.animationInput.backflipRequested = !grounded && this.queuedFlips > 0;
    if (this.animationInput.backflipRequested) this.queuedFlips -= 1;

    this.character.update(delta, this.animationInput);
    this.clearStuckFlip(delta, grounded);
    this.character.updateEffects(
      delta,
      this.current.x,
      this.current.y,
      this.current.z,
      this.animationInput.horizontalSpeed,
    );
  }

  dispose(): void {
    this.character.dispose();
  }

  /**
   * Turn a rise in the replicated counter into queued rotations.
   *
   * Duplicate and out-of-order patches carry a counter that is equal or lower,
   * so they queue nothing; a counter that went BACKWARDS is a fresh count
   * rather than a negative number of flips, and re-baselines.
   */
  private trackFlips(flipCount: number, grounded: boolean): void {
    if (!this.flipCountKnown) {
      this.flipCountKnown = true;
      this.lastFlipCount = flipCount;
      return;
    }

    if (flipCount <= this.lastFlipCount) {
      this.lastFlipCount = flipCount;
      return;
    }

    const started = flipCount - this.lastFlipCount;
    this.lastFlipCount = flipCount;

    if (grounded) return;

    this.queuedFlips = Math.min(this.queuedFlips + started, MAX_QUEUED_FLIPS);
  }

  /**
   * Last resort: a rotation still turning while the server says the player is
   * standing on something.
   *
   * The animator already aborts on the landed EDGE, so this only fires when
   * that edge was never observed. It resets the animator directly rather than
   * through `resetAnimation`, because a stuck flip is no reason to erase the
   * player's trail.
   */
  private clearStuckFlip(delta: number, grounded: boolean): void {
    if (!grounded) {
      this.groundedTime = 0;
      return;
    }
    this.groundedTime += delta;
    if (this.groundedTime < FLIP_WATCHDOG_SECONDS) return;
    if (!this.character.animator.isFlipping) return;
    this.queuedFlips = 0;
    this.character.animator.reset();
  }

  private snapToTarget(): void {
    this.current.copy(this.target);
    this.currentYaw = this.targetYaw;
    this.applyToCharacter();
  }

  private applyToCharacter(): void {
    this.character.setPosition(this.current.x, this.current.y, this.current.z);
    this.character.setYaw(this.currentYaw);
  }
}

/** Lerp between two angles along the shortest arc. */
const interpolateAngle = (from: number, to: number, alpha: number): number => {
  let diff = to - from;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return from + diff * alpha;
};
