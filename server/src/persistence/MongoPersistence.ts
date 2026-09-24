import { existsSync, readFileSync } from 'node:fs';
import { MongoServerError, type AnyBulkWriteOperation, type Collection } from 'mongodb';
import { logger } from '../util/logger.js';
import type { MongoConnection } from './mongoConnection.js';
import type { PersistenceAdapter, StoredProfile } from './PersistenceAdapter.js';
import { decodeProfile } from './profileCodec.js';
import { profileUpdate, writeProfileFields } from './profileFields.js';

const SCOPE = 'persistence/mongo';

/** The collection every profile lives in, one document per key. */
const COLLECTION = 'profiles';
/** Retry spacing for writes that did not land, doubling up to the cap. */
const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 30_000;
/** MongoDB's duplicate-key error: the document an insert wanted already exists. */
const DUPLICATE_KEY = 11000;

interface ProfileDocument extends Partial<StoredProfile> {
  _id: string;
  [field: string]: unknown;
}

/**
 * Profiles in the managed MongoDB that Bloxity Legion provides.
 *
 * From hosting.bloxity.io/docs: Legion injects `MONGODB_URI`, "an ISOLATED
 * managed Mongo db scoped to THIS game+channel". There is no Bloxity database
 * API - the contract is "read MONGODB_URI and connect" - so this is the
 * official driver and the database named in the URI.
 *
 * ONE DOCUMENT PER PLAYER, and every write touches only its own document.
 *
 * WRITES ARE NEVER DROPPED. `put` queues the latest snapshot per key and a
 * drain loop writes the queue with idempotent upserts; a write that fails is
 * put back and retried with backoff for as long as the process lives.
 */
export class MongoPersistence implements PersistenceAdapter {
  readonly kind = 'mongodb';

  private collection: Collection<ProfileDocument> | null = null;
  /** Latest unwritten snapshot per key. A newer save replaces an older one. */
  private readonly queue = new Map<string, StoredProfile>();
  /** Writes on the wire right now - still the newest truth for reads. */
  private readonly inFlight = new Map<string, StoredProfile>();
  private readonly waiters = new Map<string, Array<() => void>>();
  private draining: Promise<void> | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private retryDelay = RETRY_MIN_MS;
  private imported = false;

  constructor(
    private readonly connection: MongoConnection,
    /** A `profiles.json` from before this adapter, imported insert-only. */
    private readonly legacyFile: string | null,
  ) {}

  get pendingWrites(): number {
    return this.queue.size + this.inFlight.size;
  }

  /**
   * Connect, and bring across any profiles from the old JSON file.
   *
   * The import only ever INSERTS: `$setOnInsert` under an upsert writes a
   * document that does not exist and leaves one that does exactly as it is.
   * Safe on every boot; the database always wins over the file.
   */
  async prepare(): Promise<void> {
    const collection = await this.connect();
    if (this.imported || !this.legacyFile || !existsSync(this.legacyFile)) return;

    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(this.legacyFile, 'utf8'));
    } catch (error) {
      logger.error(SCOPE, `legacy ${this.legacyFile} is unreadable; not importing it:`, error);
      this.imported = true;
      return;
    }
    const operations: AnyBulkWriteOperation<ProfileDocument>[] = [];
    for (const [key, value] of Object.entries(legacyProfiles(raw))) {
      const profile = decodeProfile(value);
      if (!key || !profile) continue;
      operations.push({
        updateOne: { filter: { _id: key }, update: { $setOnInsert: { ...profile } }, upsert: true },
      });
    }
    if (operations.length > 0) {
      const result = await collection.bulkWrite(operations, { ordered: false });
      logger.info(
        SCOPE,
        `legacy import from ${this.legacyFile}: ${result.upsertedCount} new, ` +
          `${operations.length - result.upsertedCount} already present (left untouched)`,
      );
    }
    this.imported = true;
  }

  async loadAll(): Promise<Map<string, StoredProfile>> {
    const collection = await this.connect();
    const profiles = new Map<string, StoredProfile>();
    for (const document of await collection.find({}).toArray()) {
      const profile = decodeProfile(document);
      if (profile) profiles.set(document._id, profile);
    }
    // Writes still pending in THIS process are newer than the database.
    for (const [key, profile] of [...this.inFlight, ...this.queue]) {
      profiles.set(key, writeProfileFields(profiles.get(key), profile));
    }
    return profiles;
  }

  async get(key: string): Promise<StoredProfile | undefined> {
    const collection = await this.connect();
    const document = await collection.findOne({ _id: key });
    let profile = document ? (decodeProfile(document) ?? undefined) : undefined;
    // Read-your-own-writes: a save still pending here is the newest truth.
    const inFlight = this.inFlight.get(key);
    if (inFlight) profile = writeProfileFields(profile, inFlight);
    const queued = this.queue.get(key);
    if (queued) profile = writeProfileFields(profile, queued);
    return profile;
  }

  put(key: string, profile: StoredProfile): void {
    if (!key) return;
    this.queue.set(key, { ...profile });
    this.kick();
  }

  async insertIfAbsent(key: string, profile: StoredProfile): Promise<boolean> {
    // A profile pending in this process but not yet written still EXISTS.
    if (!key || this.queue.has(key) || this.inFlight.has(key)) return false;
    const collection = await this.connect();
    try {
      await collection.insertOne({ ...profile, _id: key });
      return true;
    } catch (error: unknown) {
      if (error instanceof MongoServerError && error.code === DUPLICATE_KEY) return false;
      throw error;
    }
  }

  whenWritten(key: string): Promise<void> {
    if (!this.queue.has(key) && !this.inFlight.has(key)) return Promise.resolve();
    return new Promise((resolve) => {
      const list = this.waiters.get(key) ?? [];
      list.push(resolve);
      this.waiters.set(key, list);
    });
  }

  async flush(timeoutMs = 8000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (this.pendingWrites > 0 && Date.now() < deadline) {
      if (this.retryTimer) {
        clearTimeout(this.retryTimer);
        this.retryTimer = null;
      }
      this.kick();
      if (this.draining) await this.draining;
      if (this.pendingWrites > 0) await sleep(Math.min(250, Math.max(0, deadline - Date.now())));
    }
    if (this.pendingWrites > 0) {
      logger.error(SCOPE, `flush gave up with ${this.pendingWrites} profile write(s) unwritten`);
    }
  }

  async close(): Promise<void> {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    await this.connection.close();
  }

  private async connect(): Promise<Collection<ProfileDocument>> {
    if (this.collection) return this.collection;
    const database = await this.connection.db();
    this.collection = database.collection<ProfileDocument>(COLLECTION);
    return this.collection;
  }

  /** Release everyone waiting on a key that has nothing left to write. */
  private settle(key: string): void {
    if (this.queue.has(key) || this.inFlight.has(key)) return;
    const list = this.waiters.get(key);
    if (!list) return;
    this.waiters.delete(key);
    for (const resolve of list) resolve();
  }

  private kick(): void {
    if (this.draining || this.retryTimer) return;
    this.draining = this.drain().finally(() => {
      this.draining = null;
    });
  }

  private async drain(): Promise<void> {
    while (this.queue.size > 0) {
      const batch = [...this.queue.entries()];
      for (const [key, profile] of batch) {
        this.queue.delete(key);
        this.inFlight.set(key, profile);
      }
      try {
        const collection = await this.connect();
        await collection.bulkWrite(
          batch.map(([key, profile]) => ({
            updateOne: { filter: { _id: key }, update: profileUpdate(profile), upsert: true },
          })),
          { ordered: false },
        );
        this.retryDelay = RETRY_MIN_MS;
        for (const [key] of batch) {
          this.inFlight.delete(key);
          this.settle(key);
        }
      } catch (error: unknown) {
        // Put back everything a newer save has not already replaced, and try
        // again later. Idempotent upserts make a repeat harmless.
        for (const [key, profile] of batch) {
          this.inFlight.delete(key);
          if (!this.queue.has(key)) this.queue.set(key, profile);
        }
        logger.error(
          SCOPE,
          `write of ${batch.length} profile(s) failed; retrying in ${this.retryDelay} ms:`,
          error instanceof Error ? error.message : error,
        );
        const delay = this.retryDelay;
        this.retryDelay = Math.min(this.retryDelay * 2, RETRY_MAX_MS);
        this.retryTimer = setTimeout(() => {
          this.retryTimer = null;
          this.kick();
        }, delay);
        this.retryTimer.unref?.();
        return;
      }
    }
  }
}

/**
 * The profiles in a legacy JSON file: this game's `{ version, profiles }`
 * shape, or a plain `{ key: profile }` map.
 */
const legacyProfiles = (raw: unknown): Record<string, unknown> => {
  if (!raw || typeof raw !== 'object') return {};
  const wrapped = (raw as { profiles?: unknown }).profiles;
  if (wrapped && typeof wrapped === 'object') return wrapped as Record<string, unknown>;
  return raw as Record<string, unknown>;
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
