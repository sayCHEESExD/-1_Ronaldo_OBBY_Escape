import { BACKFLIP } from './backflip.js';
import { MOVEMENT } from './movement.js';

/**
 * Rebirth, and the single formula for a player's ACTUAL movement speed.
 *
 * Everything that scales with progression resolves here so there is exactly
 * one speed calculation in the codebase. The server evaluates it and
 * replicates the result; nothing else re-derives its own numbers.
 *
 *   rebirth 0 -> max level 10, x1.0
 *   rebirth 1 -> max level 20, x1.5
 *   rebirth 2 -> max level 30, x2.0
 *   rebirth 3 -> max level 40, x2.5
 *
 * The pattern continues automatically for any higher rebirth.
 */
export const REBIRTH = {
  /** Levels added to the cap per rebirth, and the cap at rebirth 0. */
  levelsPerRebirth: 10,
  /** Multiplier added per rebirth. */
  multiplierPerRebirth: 0.5,
} as const;

/**
 * The largest level and rebirth count that can be replicated.
 *
 * `PlayerState.level`, `maxLevel` and `rebirths` are all `uint32`, so a figure
 * past this WRAPS on the wire - and a wrapped level cap is worse than a cap,
 * because it would silently drop a player's ceiling back to nothing. Clamping
 * saturates instead.
 *
 * There is no design limit anywhere: the rebirth ladder raises the cap by ten
 * levels every time, forever. This is the arithmetic edge of the protocol, and
 * at ten levels per rebirth it sits four hundred million rebirths away.
 */
export const MAX_REPLICATED_LEVEL = 4294967295;

/**
 * Highest level reachable at this rebirth: 10 x (rebirth + 1).
 *
 * Unbounded by design - reaching the cap is never the end of progression, it
 * is the gate to the next rebirth. The clamp is a protocol guard, not a
 * ceiling on play.
 */
export const maxLevelForRebirth = (rebirth: number): number => {
  const count = Number.isFinite(rebirth) ? Math.max(0, Math.floor(rebirth)) : 0;
  const cap = REBIRTH.levelsPerRebirth * (count + 1);
  return Math.min(cap, MAX_REPLICATED_LEVEL);
};

/** Progression multiplier at this rebirth: 1 + rebirth x 0.5. */
export const rebirthMultiplier = (rebirth: number): number => {
  const count = Number.isFinite(rebirth) ? Math.max(0, Math.floor(rebirth)) : 0;
  return 1 + count * REBIRTH.multiplierPerRebirth;
};

/** A player may rebirth once they have reached their current max level. */
export const canRebirth = (level: number, rebirth: number): boolean =>
  level >= maxLevelForRebirth(rebirth);

/**
 * How much faster a player actually moves.
 *
 * Level is the main driver; the rebirth multiplier scales the whole thing, so
 * a rebirth is felt immediately even though it resets the level. Boots and
 * treadmills will multiply into `extraMultiplier` when they land, which is why
 * that parameter exists rather than each system inventing its own maths.
 */
export const MOVEMENT_SCALING = {
  /** Added to the multiplier per level above 1. */
  perLevel: 0.04,
  /**
   * Ceiling on the final multiplier.
   *
   * A safety rail against absurd values (a corrupt level, a future modifier
   * stacking wrongly), NOT a progression limit - it sits far above anything
   * the rebirth ladder produces, so R2 and R3 are no longer clipped by it.
   * The old 3.5 capped R2 at max level and made R3 feel identical to R2.
   */
  maxMultiplier: 50,
} as const;

/** The resolved speeds a player actually moves at. */
export interface MovementProfile {
  /** Final multiplier applied to the base speeds. */
  readonly multiplier: number;
  readonly walkSpeed: number;
  readonly runSpeed: number;
}

/**
 * THE movement speed calculation. Every system reads this one function.
 *
 * @param level           current level, 1-based
 * @param rebirth         rebirth count
 * @param extraMultiplier hook for boots / treadmills / temporary boosts
 */
export const resolveMovementProfile = (
  level: number,
  rebirth: number,
  extraMultiplier = 1,
): MovementProfile => {
  const safeLevel = Number.isFinite(level) ? Math.max(1, Math.floor(level)) : 1;
  const extra = Number.isFinite(extraMultiplier) ? Math.max(0.1, extraMultiplier) : 1;

  const fromLevel = 1 + (safeLevel - 1) * MOVEMENT_SCALING.perLevel;
  const raw = fromLevel * rebirthMultiplier(rebirth) * extra;
  const multiplier = Math.min(raw, MOVEMENT_SCALING.maxMultiplier);

  return {
    multiplier,
    walkSpeed: MOVEMENT.walkSpeed * multiplier,
    runSpeed: MOVEMENT.runSpeed * multiplier,
  };
};

/** Backflips allowed at a given level: one per level, bounded by the ceiling. */
export const backflipCapacityForLevel = (level: number): number => {
  const safeLevel = Number.isFinite(level) ? Math.max(1, Math.floor(level)) : 1;
  return Math.max(
    BACKFLIP.defaultCapacity,
    Math.min(safeLevel, BACKFLIP.maxCapacity),
  );
};
