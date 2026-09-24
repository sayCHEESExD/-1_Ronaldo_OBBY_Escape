import { BACKFLIP_ANIM } from '../config/animationConfig.js';

const TAU = Math.PI * 2;

const clamp01 = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value);

/** Ease-in-out used when a flip is cut short by an early landing. */
const easeInOut = (t: number): number =>
  t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;

/**
 * Drives the rotation of a backflip, including chained flips.
 *
 * This owns ONLY the visual rotation. Whether a player is allowed to flip, and
 * how many flips they have available, is gameplay state that lives elsewhere
 * and is server-authoritative.
 *
 * Drift safety: the rotation is a single scalar angle. It is advanced by
 * addition, reduced modulo TAU only at read time, and the quaternion is rebuilt
 * from an axis-angle every frame - quaternions are never multiplied together
 * across frames, so chaining any number of flips cannot accumulate error. Each
 * flip's target is an exact multiple of TAU, so a completed flip lands on a
 * rotation that is exactly upright.
 */
export class BackflipAnimator {
  private angle = 0;
  private targetAngle = 0;
  private flipsStarted = 0;
  private active = false;

  private aborting = false;
  private abortTimer = 0;
  private abortFrom = 0;
  private abortTo = 0;

  /** True while a rotation is in progress (including the abort ease-out). */
  get isFlipping(): boolean {
    return this.active;
  }

  /** Flips started since the last reset. 2+ means the flip is chained. */
  get flipIndex(): number {
    return this.flipsStarted;
  }

  /** Full rotations still owed, including the one in flight. */
  get rotationsRemaining(): number {
    return Math.max(0, (this.targetAngle - this.angle) / TAU);
  }

  /** Rotation to apply to the flip pivot, normalised to [0, TAU). */
  get rotationAngle(): number {
    if (!this.active) return 0;
    const wrapped = this.angle % TAU;
    return wrapped < 0 ? wrapped + TAU : wrapped;
  }

  /**
   * How tucked the body should be, 0..1. Peaks in the middle of each single
   * rotation, so a chain of flips pulses once per rotation instead of holding
   * one long tuck.
   */
  get tuckAmount(): number {
    if (!this.active) return 0;
    if (this.aborting) {
      return Math.sin(clamp01(1 - this.abortTimer / BACKFLIP_ANIM.abortDuration) * Math.PI);
    }
    const progress = this.rotationAngle / TAU;
    return Math.sin(progress * Math.PI);
  }

  /**
   * Begin a flip, or extend the current one by another full rotation.
   *
   * Chaining deliberately ADDS to the target instead of restarting: the angle
   * keeps climbing through the same continuous rotation, so the character
   * never snaps back to upright between flips.
   */
  request(): void {
    if (this.aborting) {
      // A new request rescues an aborting flip - continue from where it is.
      this.aborting = false;
      this.targetAngle = Math.ceil(this.angle / TAU) * TAU;
    }

    if (!this.active) {
      this.active = true;
      this.angle = 0;
      this.targetAngle = TAU;
      this.flipsStarted = 1;
      return;
    }

    this.targetAngle += TAU;
    this.flipsStarted += 1;
  }

  /**
   * Advance the rotation.
   * @returns true on the frame a flip sequence finishes cleanly.
   */
  update(delta: number): boolean {
    if (!this.active) return false;

    if (this.aborting) {
      this.abortTimer += delta;
      const t = clamp01(this.abortTimer / BACKFLIP_ANIM.abortDuration);
      this.angle = this.abortFrom + (this.abortTo - this.abortFrom) * easeInOut(t);
      if (t >= 1) {
        this.reset();
        return true;
      }
      return false;
    }

    const speed = TAU / BACKFLIP_ANIM.rotationDuration;
    this.angle = Math.min(this.angle + speed * delta, this.targetAngle);

    if (this.angle >= this.targetAngle) {
      // targetAngle is an exact multiple of TAU, so this is exactly upright.
      this.reset();
      return true;
    }
    return false;
  }

  /**
   * Cut a flip short - the player landed mid-rotation. Eases to the nearest
   * upright orientation rather than snapping, and never moves the character.
   */
  abort(): void {
    if (!this.active || this.aborting) return;
    this.aborting = true;
    this.abortTimer = 0;
    this.abortFrom = this.angle;
    this.abortTo = Math.round(this.angle / TAU) * TAU;
  }

  /** Clear all rotation state. Called on landing and respawn. */
  reset(): void {
    this.angle = 0;
    this.targetAngle = 0;
    this.flipsStarted = 0;
    this.active = false;
    this.aborting = false;
    this.abortTimer = 0;
  }
}
