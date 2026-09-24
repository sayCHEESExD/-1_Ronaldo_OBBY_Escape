import { bestOwnedBoot } from './boots.js';
import { rebirthMultiplier } from './rebirth.js';
import { SPEED } from './speed.js';
import { treadmillMultiplier } from './treadmills.js';

/**
 * THE progression-gain calculation. Every modifier resolves here.
 *
 * Speed per step is the product of three independent systems:
 *
 *   boots     replace the base Speed a step is worth
 *   rebirth   scales the whole thing
 *   treadmill scales it again while the player is standing on one
 *
 * They multiply rather than stack additively, so a new modifier can be added
 * to this one function without any caller changing - which is the point.
 * `SpeedService` is the only thing that calls it, and nothing anywhere else
 * re-derives Speed per step.
 */
export interface GainModifiers {
  /** Bitmask of boots owned; the best one is equipped. */
  readonly ownedBoots: number;
  readonly rebirths: number;
  /** Treadmill tier in use, or 0. Must already be position-validated. */
  readonly treadmillTier: number;
}

/** The resolved rate, broken out so the HUD and logs can show the parts. */
export interface ProgressionRate {
  /** Final Speed granted per step taken. */
  readonly perStep: number;
  /** Speed per step from the equipped boot alone. */
  readonly boot: number;
  readonly rebirth: number;
  readonly treadmill: number;
  /** Final rate as a multiple of the base rate, for display. */
  readonly totalMultiplier: number;
}

/**
 * Resolve how much Speed one step is worth.
 *
 * The treadmill tier passed in is checked against the rebirth count here too,
 * so a tier the player has not unlocked contributes exactly 1 no matter how it
 * reached this function.
 */
export const resolveProgressionRate = (modifiers: GainModifiers): ProgressionRate => {
  const boot = bestOwnedBoot(modifiers.ownedBoots).speedPerStep;
  const rebirth = rebirthMultiplier(modifiers.rebirths);
  const treadmill = treadmillMultiplier(modifiers.treadmillTier, modifiers.rebirths);

  const perStep = boot * rebirth * treadmill;

  return {
    perStep,
    boot,
    rebirth,
    treadmill,
    totalMultiplier: SPEED.perStep > 0 ? perStep / SPEED.perStep : perStep,
  };
};
