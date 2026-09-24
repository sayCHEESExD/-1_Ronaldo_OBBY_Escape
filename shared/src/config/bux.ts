/**
 * What a Bux purchase buys in this game.
 *
 * Shared because both ends need the same table for different halves of the
 * transaction: the client renders the shop from it, and the server's
 * fulfilment webhook decides what to credit from it. A catalog that lived on
 * one side would be a shop whose buttons and whose payouts could disagree.
 *
 * THERE ARE NO PRICES HERE, deliberately. A Bux price lives in the Bloxity
 * catalog keyed by game slug and is charged by the portal; the client only
 * ever names a SKU. That is the same rule the rest of this game runs on -
 * the client asks, an authority decides - and it is what stops a tampered
 * client from inventing a cheaper price.
 */

import { MAX_WINS } from './progression.js';

/** One purchasable pack. */
export interface BuxProduct {
  /** The SKU passed to `Legion.SDK.bux.requestPurchase`. */
  readonly sku: string;
  /** Shop label. */
  readonly name: string;
  /** Wins credited by the server when the webhook confirms the sale. */
  readonly wins: number;
  /** One-line description under the label. */
  readonly blurb: string;
}

/**
 * The packs, cheapest first.
 *
 * Sized against the real curve: the mid boots run to a few million Wins and
 * the endgame islands pay tens of millions, so a pack has to be worth
 * something at the point a player would consider buying one, without
 * flattening the route it took to get there.
 */
export const BUX_PRODUCTS: readonly BuxProduct[] = [
  {
    sku: 'wins_pouch',
    name: 'Pouch of Wins',
    wins: 2_500,
    blurb: 'A leg-up through the early boots.',
  },
  {
    sku: 'wins_sack',
    name: 'Sack of Wins',
    wins: 25_000,
    blurb: 'Enough for a mid-tier trail.',
  },
  {
    sku: 'wins_chest',
    name: 'Chest of Wins',
    wins: 250_000,
    blurb: 'Opens up the high boots.',
  },
  {
    sku: 'wins_vault',
    name: 'Vault of Wins',
    wins: 2_500_000,
    blurb: 'Endgame cosmetics in reach.',
  },
];

/** Look up a pack by SKU. Unknown SKUs are rejected, never guessed. */
export const buxProductForSku = (sku: string): BuxProduct | undefined =>
  BUX_PRODUCTS.find((product) => product.sku === sku);

/**
 * Add purchased Wins to a balance without wrapping.
 *
 * The wallet is a `uint32` on the wire, so a credit that pushed past
 * `MAX_WINS` would not merely be lost - it would wrap to nearly nothing and
 * take the player's existing balance with it.
 */
export const creditWins = (current: number, amount: number): number =>
  Math.min(Math.max(current, 0) + Math.max(amount, 0), MAX_WINS);
