import { MongoServerError, type Collection } from 'mongodb';
import { logger } from '../util/logger.js';
import type { GrantRecord, GrantStore, NewGrant } from './GrantStore.js';
import type { MongoConnection } from './mongoConnection.js';

const SCOPE = 'persistence/mongo-grants';

/** One document per purchase, `_id` = the transaction id. */
const COLLECTION = 'bux_grants';
/** Mongo's duplicate-key error: the document an insert wanted already exists. */
const DUPLICATE_KEY = 11000;
/** Most grants handed over in one claim. The rest wait for the next one. */
const CLAIM_BATCH = 100;

interface GrantDocument extends Omit<GrantRecord, 'transactionId'> {
  _id: string;
}

const toRecord = ({ _id, ...rest }: GrantDocument): GrantRecord => ({ ...rest, transactionId: _id });

/**
 * Bux grants in the managed MongoDB, beside the profiles.
 *
 * `_id` IS the transaction id, so the database itself refuses a second record
 * of one purchase - across every pod and every restart, with no read-then-
 * write window for two deliveries of one webhook to slip through together.
 *
 * Claiming is one `findOneAndUpdate` per grant from `pending` to `claimed`:
 * atomic on the document, so when two pods reach for the same grant exactly
 * one of them gets it back. No multi-document transaction is needed, which
 * matters because nothing promises the managed database is a replica set.
 */
export class MongoGrantStore implements GrantStore {
  readonly kind = 'mongodb';
  readonly exclusive = false;

  private collection: Collection<GrantDocument> | null = null;

  constructor(private readonly connection: MongoConnection) {}

  async prepare(): Promise<void> {
    await this.grants();
  }

  async record(grant: NewGrant): Promise<boolean> {
    const grants = await this.grants();
    const { transactionId, ...rest } = grant;
    try {
      await grants.insertOne({ _id: transactionId, ...rest, state: 'pending' });
      return true;
    } catch (error) {
      if (error instanceof MongoServerError && error.code === DUPLICATE_KEY) return false;
      // The write may have landed and only its acknowledgement been lost. If
      // it is there it is durable, and answering a failure would have
      // Bloxity refund a purchase the player is going to receive.
      const landed = await grants.findOne({ _id: transactionId }).catch(() => null);
      if (landed) return false;
      throw error;
    }
  }

  async owed(userIds: readonly string[]): Promise<Set<string>> {
    if (userIds.length === 0) return new Set();
    const grants = await this.grants();
    const owed = await grants.distinct('userId', { state: 'pending', userId: { $in: [...userIds] } });
    return new Set(owed.filter((id): id is string => typeof id === 'string'));
  }

  async claim(userId: string, owner: string, now: number): Promise<GrantRecord[]> {
    const grants = await this.grants();
    const claimed: GrantRecord[] = [];
    while (claimed.length < CLAIM_BATCH) {
      const document = await grants.findOneAndUpdate(
        { userId, state: 'pending' },
        { $set: { state: 'claimed', claimedAt: now, claimedBy: owner } },
        { sort: { receivedAt: 1 }, returnDocument: 'after' },
      );
      if (!document) break;
      claimed.push(toRecord(document));
    }
    return claimed;
  }

  async markApplied(transactionIds: readonly string[], owner: string, now: number): Promise<void> {
    if (transactionIds.length === 0) return;
    const grants = await this.grants();
    await grants.updateMany(
      { _id: { $in: [...transactionIds] }, state: 'claimed', claimedBy: owner },
      { $set: { state: 'applied', appliedAt: now } },
    );
  }

  async release(transactionIds: readonly string[], owner: string): Promise<void> {
    if (transactionIds.length === 0) return;
    const grants = await this.grants();
    await grants.updateMany(
      { _id: { $in: [...transactionIds] }, state: 'claimed', claimedBy: owner },
      { $set: { state: 'pending' }, $unset: { claimedAt: '', claimedBy: '' } },
    );
  }

  async staleClaims(cutoff: number, except: string): Promise<GrantRecord[]> {
    const grants = await this.grants();
    const documents = await grants
      .find({ state: 'claimed', claimedAt: { $lt: cutoff }, claimedBy: { $ne: except } })
      .limit(CLAIM_BATCH)
      .toArray();
    return documents.map(toRecord);
  }

  /**
   * The collection, with its indexes. A failed attempt is not cached, so a pod
   * that booted with the database down gets its indexes once it comes back.
   */
  private async grants(): Promise<Collection<GrantDocument>> {
    if (this.collection) return this.collection;
    const database = await this.connection.db();
    const collection = database.collection<GrantDocument>(COLLECTION);
    await collection.createIndexes([
      // "What does this player have waiting", asked by every room every few seconds.
      { key: { userId: 1, state: 1 }, name: 'user_state' },
      // "Which claims outlived their pod", asked by the sweep.
      { key: { state: 1, claimedAt: 1 }, name: 'state_claimedAt' },
    ]);
    logger.info(SCOPE, `using collection "${COLLECTION}"`);
    this.collection = collection;
    return collection;
  }
}
