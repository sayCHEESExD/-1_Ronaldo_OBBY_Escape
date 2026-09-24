import { buxProductForSku } from '@obby/shared';
import { logger } from '../util/logger.js';
import { buxGrants } from './BuxGrants.js';

const SCOPE = 'BuxFulfilment';

/** The fields of a Bloxity purchase webhook this game actually uses. */
export interface BuxWebhookPayload {
  transactionId?: unknown;
  userId?: unknown;
  username?: unknown;
  gameSlug?: unknown;
  sku?: unknown;
  productName?: unknown;
  productPrice?: unknown;
  metadata?: unknown;
  timestamp?: unknown;
}

export type FulfilmentOutcome =
  | { status: 'granted'; userId: string; wins: number }
  | { status: 'duplicate'; userId: string }
  | { status: 'rejected'; reason: string };

/** The shape of a Bloxity account id - the same rule login verification uses. */
const ACCOUNT_ID = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * The ONE place a Bux purchase turns into game currency.
 *
 * A purchase is a second source of Wins alongside `TrophyService`, and it is a
 * whole service rather than a few lines in the HTTP handler for the same
 * reason `Wallet.spend` is the only place Wins leave: the catalog lookup, the
 * duplicate check and the durable record all happen here and only here.
 *
 * Driven by Bloxity's server-to-server webhook, never by a player, and the
 * grant is addressed to the Bloxity ACCOUNT that paid (`userId`, from that
 * authenticated call) - never to anything the browser supplied in the
 * purchase metadata. It is RECORDED durably and handed over by a room once
 * that account is verified there (`BuxGrants`); the overflow guard is applied
 * at that moment, on the live figure.
 */
export class BuxFulfilmentService {
  private readonly gameSlug: string;

  constructor(gameSlug: string) {
    this.gameSlug = gameSlug;
  }

  /**
   * Record a confirmed purchase.
   *
   * Returns a rejection rather than throwing for a sale that cannot be
   * honoured (a non-2xx refunds the player). THROWS when storage could not
   * record it, which the webhook turns into a 5xx so Bloxity retries. A
   * duplicate is a SUCCESS - the first delivery was already recorded.
   */
  async fulfil(payload: BuxWebhookPayload): Promise<FulfilmentOutcome> {
    const sku = asString(payload.sku);
    const transactionId = asString(payload.transactionId);
    const slug = asString(payload.gameSlug);
    const userId = asString(payload.userId);

    if (!transactionId) return { status: 'rejected', reason: 'missing transactionId' };
    if (slug && slug !== this.gameSlug) {
      return { status: 'rejected', reason: `wrong gameSlug "${slug}"` };
    }
    if (!ACCOUNT_ID.test(userId)) return { status: 'rejected', reason: 'missing or invalid userId' };

    const product = buxProductForSku(sku);
    if (!product) return { status: 'rejected', reason: `unknown sku "${sku}"` };

    const outcome = await buxGrants.record(userId, transactionId, product.sku, product.wins);
    if (outcome === 'duplicate') return { status: 'duplicate', userId };
    logger.info(SCOPE, `recorded sku=${product.sku} wins=${product.wins} userId=${userId} tx=${transactionId}`);
    return { status: 'granted', userId, wins: product.wins };
  }
}

const asString = (value: unknown): string => (typeof value === 'string' ? value : '');
