import { SIUUU_ANIM } from '../config/animationConfig.js';

const TAU = Math.PI * 2;

const clamp01 = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value);

/** Smoothstep. */
const ease = (t: number): number => {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
};

/** Ease-in-out used when a celebration is cut short by an early landing. */
const easeInOut = (t: number): number =>
  t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;

/**
 * Drives the Siuuu celebration that plays for every backflip, including
 * chained ones.
 *
 * This owns ONLY the visual spin and the weights of its two poses. Whether a
 * player is allowed to flip, how many flips they have, and what a flip does to
 * their arc are gameplay state that lives elsewhere and is server-
 * authoritative - a flip is exactly the flip it always was, it just looks like
 * Ronaldo celebrating.
 *
 * Timing is the backflip's: one flip is one full turn of `rotationDuration`,
 * and chaining ADDS a turn to the target rather than restarting. Within each
 * turn the character spins for the first `spinPortion` and then holds the
 * stance, so a chain reads spin-SIU-spin-SIU.
 *
 * Drift safety, unchanged from the flip: progress is a single scalar angle,
 * advanced by addition and rebuilt into an axis-angle rotation every frame;
 * quaternions are never multiplied across frames. Every target is an exact
 * multiple of a full turn, so a completed celebration faces exactly forward.
 */
export class SiuuuAnimator {
  /** Linear progress through the whole sequence, in radians (TAU per flip). */
  private angle = 0;
  private targetAngle = 0;
  private flipsStarted = 0;
  private active = false;

  private aborting = false;
  private abortTimer = 0;
  private abortFrom = 0;
  private abortTo = 0;

  /** True while a celebration is in progress (including the abort ease-out). */
  get isFlipping(): boolean {
    return this.active;
  }

  /** Celebrations started since the last reset. 2+ means they are chained. */
  get flipIndex(): number {
    return this.flipsStarted;
  }

  /** Full turns still owed, including the one in flight. */
  get rotationsRemaining(): number {
    return Math.max(0, (this.targetAngle - this.angle) / TAU);
  }

  /** How far through the current turn the sequence is, 0..1. */
  private get turnProgress(): number {
    const turns = this.angle / TAU;
    const within = turns - Math.floor(turns);
    // Exactly on a boundary mid-chain means the previous turn just finished.
    return within === 0 && this.angle > 0 ? 1 : within;
  }

  /**
   * Yaw to apply to the pivot, normalised to [0, TAU).
   *
   * The spin is eased inside each turn - fast out of the jump, settling as the
   * stance lands - and complete by `spinPortion`, so the stance is always
   * struck facing forward.
   */
  get rotationAngle(): number {
    if (!this.active) return 0;
    if (this.aborting) {
      const wrapped = this.angle % TAU;
      return wrapped < 0 ? wrapped + TAU : wrapped;
    }
    const spun = ease(this.turnProgress / SIUUU_ANIM.spinPortion);
    return (spun * TAU) % TAU;
  }

  /** Weight of the arms-wide spinning pose, 0..1: peaks mid-spin. */
  get spinAmount(): number {
    if (!this.active || this.aborting) return 0;
    const t = this.turnProgress / SIUUU_ANIM.spinPortion;
    return t >= 1 ? 0 : Math.sin(t * Math.PI);
  }

  /**
   * Weight of the SIU stance, 0..1: struck as the spin settles and held to
   * the end of the turn. In a chain it carries into the start of the next
   * turn and fades as that spin opens up, so the pose never jumps.
   */
  get stanceAmount(): number {
    if (!this.active) return 0;
    if (this.aborting) return 1 - clamp01(this.abortTimer / SIUUU_ANIM.abortDuration);
    const t = this.turnProgress;
    const striking = ease((t - SIUUU_ANIM.spinPortion * 0.7) / (SIUUU_ANIM.spinPortion * 0.4));
    if (this.angle < TAU) return striking;
    const carried = 1 - ease(t / 0.2);
    return Math.max(striking, carried);
  }

  /**
   * Begin a celebration, or queue another turn after the current one.
   *
   * Chaining deliberately ADDS to the target instead of restarting, exactly as
   * a chained flip did: the progress keeps climbing through one continuous
   * sequence, so the character never snaps between celebrations.
   */
  request(): void {
    if (this.aborting) {
      // A new request rescues an aborting celebration - continue from here.
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
   * Advance the sequence.
   * @returns true on the frame a sequence finishes cleanly.
   */
  update(delta: number): boolean {
    if (!this.active) return false;

    if (this.aborting) {
      this.abortTimer += delta;
      const t = clamp01(this.abortTimer / SIUUU_ANIM.abortDuration);
      this.angle = this.abortFrom + (this.abortTo - this.abortFrom) * easeInOut(t);
      if (t >= 1) {
        this.reset();
        return true;
      }
      return false;
    }

    const speed = TAU / SIUUU_ANIM.rotationDuration;
    this.angle = Math.min(this.angle + speed * delta, this.targetAngle);

    if (this.angle >= this.targetAngle) {
      // targetAngle is an exact multiple of TAU, so this faces exactly forward.
      this.reset();
      return true;
    }
    return false;
  }

  /**
   * Cut a celebration short - the player landed mid-spin. Eases the yaw that
   * is actually on screen to the nearest forward-facing turn rather than
   * snapping, and never moves the character.
   */
  abort(): void {
    if (!this.active || this.aborting) return;
    const shown = this.rotationAngle;
    this.aborting = true;
    this.abortTimer = 0;
    this.abortFrom = shown;
    this.abortTo = Math.round(shown / TAU) * TAU;
    this.angle = shown;
  }

  /** Clear all state. Called on landing and respawn. */
  reset(): void {
    this.angle = 0;
    this.targetAngle = 0;
    this.flipsStarted = 0;
    this.active = false;
    this.aborting = false;
    this.abortTimer = 0;
  }
}
