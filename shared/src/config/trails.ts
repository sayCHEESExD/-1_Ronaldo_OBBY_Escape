/**
 * Trails: the MOVEMENT SPEED cosmetic ladder, bought with trophy Wins.
 *
 * A trail multiplies how fast the player actually moves. It feeds the ONE
 * movement formula (`resolveMovementProfile`) through its `extraMultiplier`
 * parameter - never a second calculation of its own.
 *
 * Deliberately NOT a progression-per-step modifier: boots and treadmills own
 * that axis, and auras own trophy rewards. Keeping the three separate is what
 * stops a cosmetic quietly multiplying the wrong system.
 *
 * Ownership and the equipped slot are server state. The client asks to buy and
 * to equip, and renders whatever comes back.
 */

/** How the client draws a trail. Presentation only; never gameplay. */
export type TrailStyle = 'solid' | 'rainbow' | 'void' | 'lunar' | 'cosmic';

export interface TrailTier {
  /** 1-based slot, matching the shop rows top to bottom. */
  readonly slot: number;
  readonly name: string;
  /** Trophy Wins deducted on purchase. */
  readonly cost: number;
  /** Multiplier applied to actual movement speed while equipped. */
  readonly multiplier: number;
  /** Base colour, as a hex integer. */
  readonly color: number;
  readonly style: TrailStyle;
}

export const TRAIL_TIERS: readonly TrailTier[] = [
  { slot: 1, name: 'Orange Trail', cost: 150, multiplier: 1.5, color: 0xff8a1f, style: 'solid' },
  { slot: 2, name: 'Blue Trail', cost: 250, multiplier: 1.75, color: 0x3aa8ff, style: 'solid' },
  { slot: 3, name: 'Green Trail', cost: 350, multiplier: 2, color: 0x3ce06a, style: 'solid' },
  { slot: 4, name: 'Purple Trail', cost: 850, multiplier: 3, color: 0xa855f7, style: 'solid' },
  { slot: 5, name: 'Rainbow Trail', cost: 3500, multiplier: 4, color: 0xff3b6b, style: 'rainbow' },
  { slot: 6, name: 'White Trail', cost: 10000, multiplier: 5, color: 0xffffff, style: 'solid' },
  { slot: 7, name: 'Black Trail', cost: 25000, multiplier: 6, color: 0x14161c, style: 'void' },
  { slot: 8, name: 'Moon Trail', cost: 75000, multiplier: 7, color: 0xc9d8ff, style: 'lunar' },
  { slot: 9, name: 'Nova Trail', cost: 150000, multiplier: 8, color: 0x7b5bff, style: 'cosmic' },
  { slot: 10, name: 'Golden Trail', cost: 300000, multiplier: 10, color: 0xffc733, style: 'solid' },
  // --- Late game. The multiplier is deliberately gentle compared with the
  // --- price: a trail scales ACTUAL movement speed, which is already
  // --- multiplied by level and rebirth, and a large step here would push a
  // --- deep-rebirth player far enough per simulation step to clip the route.
  // --- The prices are what absorb the Wins; the speed is a modest reward.
  { slot: 11, name: 'Prism Trail', cost: 1500000, multiplier: 12, color: 0x5ce1ff, style: 'rainbow' },
  { slot: 12, name: 'Aurora Trail', cost: 8000000, multiplier: 13, color: 0x62ffb8, style: 'cosmic' },
  { slot: 13, name: 'Quantum Trail', cost: 45000000, multiplier: 14, color: 0xb26bff, style: 'cosmic' },
  { slot: 14, name: 'Singularity Trail', cost: 250000000, multiplier: 15, color: 0x0a0a12, style: 'void' },
  { slot: 15, name: 'Celestial Trail', cost: 900000000, multiplier: 16, color: 0xfff0b8, style: 'lunar' },
  { slot: 16, name: 'Eternal Trail', cost: 2500000000, multiplier: 18, color: 0xffd23d, style: 'solid' },
];

/**
 * Slots must fit `PlayerState.ownedTrails`, a uint16 bitmask - so sixteen, and
 * no more. See MAX_AURA_SLOTS.
 */
export const MAX_TRAIL_SLOTS = 16;

/** Nothing equipped. */
export const NO_TRAIL = 0;

/** Look up a tier by its slot. */
export const trailBySlot = (slot: number): TrailTier | undefined =>
  TRAIL_TIERS.find((tier) => tier.slot === slot);

/** One bit per slot, so the whole inventory is a single replicated integer. */
export const trailMask = (slot: number): number => 1 << (slot - 1);

/** True when the player has bought this tier. */
export const isTrailOwned = (owned: number, slot: number): boolean =>
  (owned & trailMask(slot)) !== 0;

/**
 * Movement multiplier from the equipped trail.
 *
 * Returns 1 for "none equipped" and for any slot that is not owned, so an
 * unowned or forged slot can only ever mean "no bonus" - never a bonus.
 */
export const trailMultiplier = (slot: number, owned: number): number => {
  const tier = trailBySlot(slot);
  if (!tier) return 1;
  return isTrailOwned(owned, tier.slot) ? tier.multiplier : 1;
};
