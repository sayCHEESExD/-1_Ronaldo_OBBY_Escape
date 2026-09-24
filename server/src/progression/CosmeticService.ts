import { spend } from './Wallet.js';
import type { PlayerState } from '../rooms/state/PlayerState.js';

/**
 * Minimum time between two successful purchases from one shop by one player.
 *
 * The same guard boots use: the already-owned check stops one item being paid
 * for twice, and this stops a burst of requests draining the wallet across
 * several items faster than a person could click.
 */
const PURCHASE_COOLDOWN_MS = 600;

/** One buyable cosmetic, as far as this service is concerned. */
export interface CosmeticTier {
  readonly slot: number;
  readonly name: string;
  readonly cost: number;
  readonly multiplier: number;
}

export type BuyCosmeticResult =
  | {
      readonly ok: true;
      readonly tier: CosmeticTier;
      readonly spent: number;
      readonly winsAfter: number;
    }
  | {
      readonly ok: false;
      readonly reason: 'unknown-slot' | 'already-owned' | 'too-poor' | 'cooldown';
    };

export type EquipCosmeticResult =
  | { readonly ok: true; readonly slot: number; readonly tier: CosmeticTier | null }
  | { readonly ok: false; readonly reason: 'unknown-slot' | 'not-owned' };

/** How this service reads and writes one cosmetic axis on a player. */
export interface CosmeticBinding {
  /** Shop name, for logs. */
  readonly label: string;
  readonly catalogue: readonly CosmeticTier[];
  readonly maskOf: (slot: number) => number;
  readonly getOwned: (player: PlayerState) => number;
  readonly setOwned: (player: PlayerState, owned: number) => void;
  readonly getEquipped: (player: PlayerState) => number;
  readonly setEquipped: (player: PlayerState, slot: number) => void;
}

/**
 * Server authority over a buy-and-equip cosmetic shop.
 *
 * Trails and auras are the same transaction with different catalogues and
 * different gameplay effects, so they share this one implementation rather
 * than two near-identical services that could drift apart. What each one
 * MULTIPLIES is decided elsewhere - the shared config - and never here; this
 * only decides what is owned and what is worn.
 *
 * Everything a client might want to assert is checked against server state:
 * the slot must exist, it must not already be owned, the Wins must be there,
 * and equipping is refused outright for anything the player does not own. The
 * client sends a slot number and nothing else - never a cost, never a
 * multiplier - so there is no figure in the message to forge.
 */
export class CosmeticService {
  private readonly binding: CosmeticBinding;
  private readonly lastPurchaseAt = new Map<string, number>();

  constructor(binding: CosmeticBinding) {
    this.binding = binding;
  }

  get label(): string {
    return this.binding.label;
  }

  initialise(player: PlayerState): void {
    this.binding.setOwned(player, 0);
    this.binding.setEquipped(player, 0);
    this.lastPurchaseAt.delete(player.sessionId);
  }

  forget(sessionId: string): void {
    this.lastPurchaseAt.delete(sessionId);
  }

  /** Validate and, if valid, sell an item. */
  buy(player: PlayerState, slot: unknown): BuyCosmeticResult {
    const tier = this.tierOf(slot);
    if (!tier) return { ok: false, reason: 'unknown-slot' };

    const owned = this.binding.getOwned(player);
    if ((owned & this.binding.maskOf(tier.slot)) !== 0) {
      return { ok: false, reason: 'already-owned' };
    }

    const now = Date.now();
    const previous = this.lastPurchaseAt.get(player.sessionId) ?? 0;
    if (now - previous < PURCHASE_COOLDOWN_MS) return { ok: false, reason: 'cooldown' };

    // Payment goes through the one wallet, which refuses rather than
    // overdrawing - so the grant below can never happen unpaid.
    const winsAfter = spend(player, tier.cost);
    if (winsAfter === null) return { ok: false, reason: 'too-poor' };

    this.lastPurchaseAt.set(player.sessionId, now);
    this.binding.setOwned(player, owned | this.binding.maskOf(tier.slot));
    // A fresh purchase equips itself: the player asked for it, and it saves a
    // second round trip for the common case.
    this.binding.setEquipped(player, tier.slot);

    return { ok: true, tier, spent: tier.cost, winsAfter };
  }

  /** Equip an owned item, or slot 0 to take everything off. */
  equip(player: PlayerState, slot: unknown): EquipCosmeticResult {
    if (typeof slot !== 'number' || !Number.isInteger(slot)) {
      return { ok: false, reason: 'unknown-slot' };
    }
    if (slot === 0) {
      this.binding.setEquipped(player, 0);
      return { ok: true, slot: 0, tier: null };
    }

    const tier = this.tierOf(slot);
    if (!tier) return { ok: false, reason: 'unknown-slot' };
    if ((this.binding.getOwned(player) & this.binding.maskOf(tier.slot)) === 0) {
      return { ok: false, reason: 'not-owned' };
    }

    this.binding.setEquipped(player, tier.slot);
    return { ok: true, slot: tier.slot, tier };
  }

  /**
   * Drop an equipped item the player turns out not to own.
   *
   * Belt and braces for a restored profile: the multiplier helpers already
   * return 1 for an unowned slot, so this only keeps the replicated state
   * tidy rather than guarding a payout.
   */
  sanitise(player: PlayerState): void {
    const equipped = this.binding.getEquipped(player);
    if (equipped === 0) return;
    if ((this.binding.getOwned(player) & this.binding.maskOf(equipped)) === 0) {
      this.binding.setEquipped(player, 0);
    }
  }

  private tierOf(slot: unknown): CosmeticTier | undefined {
    if (typeof slot !== 'number' || !Number.isInteger(slot)) return undefined;
    return this.binding.catalogue.find((tier) => tier.slot === slot);
  }
}
