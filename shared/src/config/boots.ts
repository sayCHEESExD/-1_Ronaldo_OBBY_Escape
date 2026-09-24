/**
 * Boots: the Speed-per-step upgrade ladder, bought with trophy Wins.
 *
 * A boot REPLACES the base Speed granted per step, so equipping a better boot
 * multiplies how fast a player farms. Tier 1 is the starter boot and matches
 * `SPEED.perStep`, so an unequipped player and a tier-1 player farm alike.
 *
 * Buying is a DELIBERATE ACT: a boot is only acquired when the player walks
 * onto its pedestal in the Win Shop while holding enough Wins. Reaching the
 * Wins total alone does nothing - the player chooses when to collect.
 *
 * Wins ARE deducted: `winsRequired` is the price, taken by `BootService`
 * through the one wallet when the player steps onto the pedestal holding
 * enough. Walking over a pedestal already owned is still always safe - the
 * service refuses a second purchase rather than charging twice.
 *
 * The server owns all of this: `BootService` records what has been bought and
 * equips the best of it. The client only renders the result.
 */
export interface BootTier {
  /** 1-based slot, matching the shop pedestals left to right. */
  readonly slot: number;
  readonly name: string;
  /** Speed granted per step while this boot is equipped. */
  readonly speedPerStep: number;
  /** Trophy Wins needed to unlock. Tier 1 is free. */
  readonly winsRequired: number;
  /** Display colour for the shop model and the boots on the player's feet. */
  readonly color: number;
}

/**
 * Seven tiers. The +8 and +15 costs are fixed by design; the rest ramp roughly
 * geometrically up to them so each boot arrives a run or two after the last.
 */
export const BOOT_TIERS: readonly BootTier[] = [
  { slot: 1, name: 'Starter Boots', speedPerStep: 1, winsRequired: 0, color: 0xf5c542 },
  { slot: 2, name: 'Runner Boots', speedPerStep: 2, winsRequired: 10, color: 0x4f7ad6 },
  { slot: 3, name: 'Bubble Boots', speedPerStep: 3, winsRequired: 35, color: 0xff6fb5 },
  { slot: 4, name: 'Frost Boots', speedPerStep: 4, winsRequired: 100, color: 0x38bdf8 },
  { slot: 5, name: 'Magma Boots', speedPerStep: 6, winsRequired: 250, color: 0xe23b3b },
  { slot: 6, name: 'Storm Boots', speedPerStep: 8, winsRequired: 500, color: 0x3ecf6a },
  { slot: 7, name: 'Mythic Boots', speedPerStep: 15, winsRequired: 1500, color: 0xa855f7 },
  // --- Late game. Boots multiply progression PER STEP, which is the axis a
  // --- deep player actually wants, so these are the most useful sink of the
  // --- three. Only two are added: every tier is a physical pedestal along the
  // --- Win Shop wall, and at the existing spacing a ninth already sits at
  // --- z +22 against the platform's +28 front edge. More would need the shop
  // --- re-laid out, which is a world change rather than an economy one.
  { slot: 8, name: 'Celestial Boots', speedPerStep: 26, winsRequired: 250000, color: 0x5ce1ff },
  { slot: 9, name: 'Ascendant Boots', speedPerStep: 45, winsRequired: 4000000, color: 0xfff0b8 },
];

/**
 * Slots must fit `PlayerState.ownedBoots`, a uint16 bitmask - so sixteen, and
 * no more. The physical shop runs out of wall long before that.
 */
export const MAX_BOOT_SLOTS = 16;

/** The starter boot, always owned. */
export const STARTER_BOOT: BootTier = BOOT_TIERS[0] as BootTier;

/** Look up a tier by its slot number. */
export const bootBySlot = (slot: number): BootTier | undefined =>
  BOOT_TIERS.find((tier) => tier.slot === slot);

/**
 * Owned boots are a bitmask, one bit per slot, so the whole inventory is a
 * single small replicated integer.
 */
export const bootMask = (slot: number): number => 1 << (slot - 1);

/** Mask a brand new player starts with: the starter boot only. */
export const STARTER_BOOT_MASK = bootMask(STARTER_BOOT.slot);

/** True when the player has bought this tier. */
export const isBootOwned = (owned: number, slot: number): boolean =>
  (owned & bootMask(slot)) !== 0;

/** True when the player has enough Wins to buy this tier. */
export const canAffordBoot = (tier: BootTier, wins: number): boolean =>
  (Number.isFinite(wins) ? wins : 0) >= tier.winsRequired;

/** Best boot in an owned mask. Falls back to the starter boot. */
export const bestOwnedBoot = (owned: number): BootTier => {
  let best = STARTER_BOOT;
  for (const tier of BOOT_TIERS) {
    if (isBootOwned(owned, tier.slot)) best = tier;
  }
  return best;
};
