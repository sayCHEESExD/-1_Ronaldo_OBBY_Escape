import { AURA_TIERS, TRAIL_TIERS, auraMask, trailMask } from '@obby/shared';
import type { CosmeticBinding } from './CosmeticService.js';

/**
 * How the two cosmetic shops attach to a player.
 *
 * Kept apart from `CosmeticService` so the service stays free of any knowledge
 * of what a trail or an aura actually DOES - one multiplies movement speed and
 * the other multiplies trophy rewards, and neither effect is applied here.
 */

export const TRAIL_BINDING: CosmeticBinding = {
  label: 'trail',
  catalogue: TRAIL_TIERS,
  maskOf: trailMask,
  getOwned: (player) => player.ownedTrails,
  setOwned: (player, owned) => {
    player.ownedTrails = owned;
  },
  getEquipped: (player) => player.trailSlot,
  setEquipped: (player, slot) => {
    player.trailSlot = slot;
  },
};

export const AURA_BINDING: CosmeticBinding = {
  label: 'aura',
  catalogue: AURA_TIERS,
  maskOf: auraMask,
  getOwned: (player) => player.ownedAuras,
  setOwned: (player, owned) => {
    player.ownedAuras = owned;
  },
  getEquipped: (player) => player.auraSlot,
  setEquipped: (player, slot) => {
    player.auraSlot = slot;
  },
};
