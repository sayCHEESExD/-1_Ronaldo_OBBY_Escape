import { canAffordBoot, bootBySlot, isBootOwned } from '@obby/shared';
import type { LocalPlayer } from '../player/LocalPlayer.js';
import { logger } from '../util/logger.js';
import type { GorgeCollision } from '../world/GorgeCollision.js';

const SCOPE = 'ShopController';

/** Seconds before the same pedestal will send another request. */
const REQUEST_COOLDOWN = 1.2;

/** What the controller needs from the network layer. */
export interface ShopNetwork {
  buyBoot(slot: number): void;
}

/**
 * Turns standing on a boot pedestal into a purchase request.
 *
 * Buying is deliberate by design: reaching the Wins total does nothing on its
 * own, and the player must walk onto the stand. This only ASKS - the server
 * checks the Wins, the slot and the player's position before granting
 * anything, and the result comes back as replicated state.
 */
export class ShopController {
  private readonly collision: GorgeCollision;
  private readonly network: ShopNetwork;

  /** Slot the player is currently standing on, so a request fires once. */
  private standingOn: number | null = null;
  private cooldown = 0;

  private wins = 0;
  private ownedMask = 1;

  constructor(collision: GorgeCollision, network: ShopNetwork) {
    this.collision = collision;
    this.network = network;
  }

  /** Mirror the replicated wallet and inventory. */
  setState(wins: number, ownedMask: number): void {
    this.wins = wins;
    this.ownedMask = ownedMask;
  }

  update(delta: number, player: LocalPlayer): void {
    if (this.cooldown > 0) this.cooldown -= delta;

    const slot = this.collision.bootPedestalAt(
      player.position.x,
      player.position.y,
      player.position.z,
    );

    // Stepping off a pedestal re-arms it.
    if (slot === null) {
      this.standingOn = null;
      return;
    }
    if (slot === this.standingOn) return;
    this.standingOn = slot;

    if (isBootOwned(this.ownedMask, slot)) return;

    const tier = bootBySlot(slot);
    if (!tier || !canAffordBoot(tier, this.wins)) return;
    if (this.cooldown > 0) return;

    this.cooldown = REQUEST_COOLDOWN;
    this.network.buyBoot(slot);
    logger.info(SCOPE, `requesting boot slot ${slot} ("${tier.name}")`);
  }
}
