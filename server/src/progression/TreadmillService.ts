import {
  NO_TREADMILL,
  maxUsableTreadmill,
  treadmillByTier,
  treadmillMultiplier,
  treadmillTierAt,
} from '@obby/shared';
import type { PlayerState } from '../rooms/state/PlayerState.js';

/** What changed about a player's treadmill this step. */
export interface TreadmillChange {
  /** Tier the player is physically standing on, or 0. */
  readonly standing: number;
  /** Tier actually being RUN ON - 0 when not pinned to a machine. */
  readonly active: number;
  /** Multiplier granted; 1 whenever `active` is 0. */
  readonly multiplier: number;
  /** True when `active` differs from the previous step, for logging. */
  readonly changed: boolean;
  /** True when standing on a deck the rebirth gate refuses. */
  readonly locked: boolean;
}

/**
 * Server authority over treadmill use.
 *
 * The SIMULATION decides whether a player is running on a machine, because
 * that is a movement state: entering pins the player and leaving restores
 * normal movement, and both have to happen inside the same step the input is
 * simulated in. `MovementService` publishes the result onto `treadmillTier`.
 *
 * This service owns everything around that decision: it resolves the rebirth
 * gate the simulation is given, works out which deck the player is merely
 * STANDING on (so the HUD can say "locked" rather than nothing), and turns the
 * active tier into the multiplier the gain formula reads.
 *
 * Nothing here comes from the client. There is no treadmill message at all, so
 * a player cannot claim a machine they are not on, cannot claim a tier they
 * have not unlocked, and cannot keep the multiplier after stepping off - the
 * tier is re-derived from the server's own simulation every single input.
 */
export class TreadmillService {
  /** Last active tier per session, so entering and leaving can be logged. */
  private readonly active = new Map<string, number>();

  initialise(player: PlayerState): void {
    this.active.set(player.sessionId, NO_TREADMILL);
    player.treadmillStanding = NO_TREADMILL;
    player.treadmillTier = NO_TREADMILL;
    player.treadmillMultiplier = 1;
    this.syncGate(player);
  }

  forget(sessionId: string): void {
    this.active.delete(sessionId);
  }

  /**
   * Refresh the replicated gate from the player's rebirth count.
   *
   * Called on join and after a rebirth, so the tier the simulation is allowed
   * to enter always matches the progression the server has recorded.
   */
  syncGate(player: PlayerState): void {
    player.maxTreadmillTier = maxUsableTreadmill(player.rebirths);
  }

  /**
   * Re-evaluate from the authoritative simulation.
   *
   * Call AFTER movement has been simulated and BEFORE Speed is credited, so a
   * step is paid at the rate of the machine the player is on at the end of it.
   * Leaving sets the tier to 0 on the very same step the exit input is
   * simulated, which is what stops the multiplier immediately.
   */
  resolve(sessionId: string, player: PlayerState): TreadmillChange {
    // Set by MovementService from the simulation - never from a message.
    const active = player.treadmillTier;
    const standing = treadmillTierAt(player.x, player.y, player.z);
    const multiplier = treadmillMultiplier(active, player.rebirths);

    const previous = this.active.get(sessionId) ?? NO_TREADMILL;
    this.active.set(sessionId, active);

    player.treadmillStanding = standing;
    player.treadmillMultiplier = multiplier;

    return {
      standing,
      active,
      multiplier,
      changed: active !== previous,
      locked:
        standing !== NO_TREADMILL &&
        active === NO_TREADMILL &&
        standing > player.maxTreadmillTier,
    };
  }

  /** Rebirths needed for a tier, for logging a refusal. */
  requiredRebirth(tier: number): number {
    return treadmillByTier(tier)?.requiredRebirth ?? 0;
  }
}
