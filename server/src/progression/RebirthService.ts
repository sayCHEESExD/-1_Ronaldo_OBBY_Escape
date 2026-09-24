import {
  backflipCapacityForLevel,
  canRebirth,
  maxLevelForRebirth,
  rebirthMultiplier,
} from '@obby/shared';
import type { PlayerState } from '../rooms/state/PlayerState.js';

/** Outcome of a rebirth attempt. */
export type RebirthResult =
  | { readonly ok: true; readonly rebirths: number; readonly multiplier: number }
  | { readonly ok: false; readonly reason: 'not-eligible' };

/**
 * Server authority over rebirth.
 *
 * Rebirth trades the current level for a permanently higher ceiling and a
 * bigger multiplier. What it must NOT touch is anything the player earned
 * outside the level curve: Wins and boots are permanent unlocks and survive
 * untouched.
 */
export class RebirthService {
  /**
   * Refresh the cap and the flip allowance that follow from level and rebirth.
   *
   * Deliberately does NOT write `moveMultiplier`. Movement speed has exactly
   * one evaluator - `SpeedService.movementProfile` - because it is the only
   * place that knows about every modifier feeding the shared formula. This
   * class computing its own would silently drop the equipped trail, which is
   * exactly what it used to do. Callers follow this with
   * `SpeedService.applyRestoredProgress`.
   */
  sync(player: PlayerState): void {
    player.maxLevel = maxLevelForRebirth(player.rebirths);
    player.backflipCapacity = backflipCapacityForLevel(player.level);
  }

  /** True once the player has reached their current max level. */
  isEligible(player: PlayerState): boolean {
    return canRebirth(player.level, player.rebirths);
  }

  /**
   * Perform a rebirth.
   *
   * Resets the level curve and everything derived from it, raises the cap and
   * the multiplier, and deliberately leaves Wins, boots and any other
   * permanent unlock alone.
   */
  rebirth(player: PlayerState): RebirthResult {
    if (!this.isEligible(player)) return { ok: false, reason: 'not-eligible' };

    player.rebirths += 1;
    // Reset the level curve: level follows from totalSpeed, so clearing the
    // Speed total is what actually returns the player to level 1.
    player.totalSpeed = 0;
    player.level = 1;

    // Derived state follows: cap, backflip allowance and movement speed.
    this.sync(player);

    return {
      ok: true,
      rebirths: player.rebirths,
      multiplier: rebirthMultiplier(player.rebirths),
    };
  }
}
