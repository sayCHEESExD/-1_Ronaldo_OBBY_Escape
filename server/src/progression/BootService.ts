import {
  BOOT_SHOP,
  SPAWN_PLATFORM,
  STARTER_BOOT,
  STARTER_BOOT_MASK,
  bestOwnedBoot,
  bootBySlot,
  bootMask,
  canAffordBoot,
  isBootOwned,
  type BootTier,
} from '@obby/shared';
import { spend } from './Wallet.js';
import type { PlayerState } from '../rooms/state/PlayerState.js';

/** How far from a pedestal the server still accepts a purchase, in units. */
const PICKUP_TOLERANCE = BOOT_SHOP.pickupRadius + 2.5;

/**
 * Minimum time between two successful purchases by one player.
 *
 * Wins are now SPENT, so a duplicate request is no longer harmless. The
 * already-owned check stops the same boot being bought twice, but this is what
 * stops a burst of requests draining the wallet across several pedestals
 * faster than the player could physically walk between them.
 */
const PURCHASE_COOLDOWN_MS = 750;

/** Outcome of a purchase attempt. */
export type BuyResult =
  | {
      readonly ok: true;
      readonly tier: BootTier;
      /** Wins deducted by this purchase. */
      readonly spent: number;
      /** Wallet after the deduction. */
      readonly winsAfter: number;
    }
  | {
      readonly ok: false;
      readonly reason: 'unknown-slot' | 'already-owned' | 'too-poor' | 'too-far' | 'cooldown';
    };

/**
 * Server authority over boots.
 *
 * Buying is a deliberate act - the player must walk onto a pedestal while
 * holding enough Wins - so this validates what the client cannot be trusted
 * on: the slot exists, the player can afford it, they are actually standing at
 * that pedestal, and they are not spamming requests.
 *
 * A boot COSTS its Wins: the price is deducted here, on the authoritative
 * profile, and the new balance replicates out. This is the only place Wins are
 * ever spent, so there is one transaction path rather than a check in one
 * place and a deduction in another.
 *
 * The equipped boot is always the best one OWNED, so a purchase can never
 * downgrade a player and there is no separate "equip" message to forge.
 */
export class BootService {
  /** Timestamp of each session's last successful purchase. */
  private readonly lastPurchaseAt = new Map<string, number>();

  initialise(player: PlayerState): void {
    player.ownedBoots = STARTER_BOOT_MASK;
    player.bootSlot = STARTER_BOOT.slot;
    this.lastPurchaseAt.delete(player.sessionId);
  }

  forget(sessionId: string): void {
    this.lastPurchaseAt.delete(sessionId);
  }

  /** Validate and, if valid, sell a boot. */
  buy(player: PlayerState, slot: unknown): BuyResult {
    if (typeof slot !== 'number' || !Number.isInteger(slot)) {
      return { ok: false, reason: 'unknown-slot' };
    }

    const tier = bootBySlot(slot);
    if (!tier) return { ok: false, reason: 'unknown-slot' };
    if (isBootOwned(player.ownedBoots, tier.slot)) {
      return { ok: false, reason: 'already-owned' };
    }
    if (!canAffordBoot(tier, player.wins)) return { ok: false, reason: 'too-poor' };
    if (!this.isAtPedestal(player, tier)) return { ok: false, reason: 'too-far' };

    const now = Date.now();
    const previous = this.lastPurchaseAt.get(player.sessionId) ?? 0;
    if (now - previous < PURCHASE_COOLDOWN_MS) return { ok: false, reason: 'cooldown' };

    // The whole transaction, in one place: take the payment, grant the item,
    // re-equip. Nothing between these lines can fail, so the wallet and the
    // inventory cannot disagree.
    // Payment goes through the ONE wallet shared with the trail and aura
    // shops, which refuses rather than overdrawing.
    const winsAfter = spend(player, tier.winsRequired);
    if (winsAfter === null) return { ok: false, reason: 'too-poor' };

    this.lastPurchaseAt.set(player.sessionId, now);
    player.ownedBoots |= bootMask(tier.slot);
    this.equipBest(player);

    return { ok: true, tier, spent: tier.winsRequired, winsAfter };
  }

  /** Re-equip the best owned boot. Idempotent. */
  equipBest(player: PlayerState): BootTier {
    const tier = bestOwnedBoot(player.ownedBoots);
    player.bootSlot = tier.slot;
    return tier;
  }

  /** Speed granted per step by the player's equipped boot. */
  speedPerStep(player: PlayerState): number {
    return bestOwnedBoot(player.ownedBoots).speedPerStep;
  }

  /** Is the player's last reported position at this boot's pedestal? */
  private isAtPedestal(player: PlayerState, tier: BootTier): boolean {
    const pedestalZ = BOOT_SHOP.firstZ + (tier.slot - 1) * BOOT_SHOP.spacingZ;
    const withinX = Math.abs(player.x - BOOT_SHOP.x) <= PICKUP_TOLERANCE;
    const withinZ = Math.abs(player.z - pedestalZ) <= PICKUP_TOLERANCE;
    // The shop sits on the starting platform, so the player must be on it.
    const onPlatform = player.y >= SPAWN_PLATFORM.topY - 2 && player.y <= SPAWN_PLATFORM.topY + 6;
    return withinX && withinZ && onPlatform;
  }
}
