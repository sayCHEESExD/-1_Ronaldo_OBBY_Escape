import type { PlayerState } from '../rooms/state/PlayerState.js';

/**
 * The ONE place Wins are spent.
 *
 * Boots, trails and auras are three shops with three catalogues, but they must
 * not become three ways to take payment - a second deduction path is exactly
 * how a wallet ends up disagreeing with an inventory. Every purchase in the
 * game funnels through `spend`, which refuses rather than ever going negative.
 *
 * Wins are only ever ADDED by `TrophyService`, and only ever REMOVED here.
 */

/** True when the player can cover this cost. */
export const canAfford = (player: PlayerState, cost: number): boolean => {
  const price = Number.isFinite(cost) ? Math.max(0, Math.floor(cost)) : 0;
  return player.wins >= price;
};

/**
 * Take payment.
 *
 * @returns the wallet after the deduction, or null when the player cannot
 *          afford it - in which case nothing was taken.
 */
export const spend = (player: PlayerState, cost: number): number | null => {
  const price = Number.isFinite(cost) ? Math.max(0, Math.floor(cost)) : 0;
  if (player.wins < price) return null;
  player.wins -= price;
  return player.wins;
};
