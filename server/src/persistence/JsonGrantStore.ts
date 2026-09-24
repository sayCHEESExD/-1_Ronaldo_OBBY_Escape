import { existsSync, readFileSync, renameSync } from 'node:fs';
import { mkdir, open, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { logger } from '../util/logger.js';
import type { GrantRecord, GrantStore, NewGrant } from './GrantStore.js';

const SCOPE = 'persistence/json-grants';

/**
 * Bux grants in one JSON file - the DEVELOPMENT store, selected with the JSON
 * profile file when there is no `MONGODB_URI`.
 *
 * One process owns the file, so atomicity is simply Node's one thread: every
 * operation runs to completion on the in-memory map before the next begins.
 * What this store adds over the Map it replaces is that the map is ON DISK
 * before any answer goes back - a restart between a webhook and its buyer's
 * join no longer loses the purchase, and a retry after a restart is still
 * recognised as one.
 *
 * Every change is written atomically (temp file, fsync, rename) and awaited,
 * and a change that could not be written is UNDONE in memory and reported as
 * a failure. Purchases are rare, so an fsync per change is nothing.
 */
export class JsonGrantStore implements GrantStore {
  readonly kind = 'json-file';
  readonly exclusive = true;

  private readonly path: string;
  private readonly tempPath: string;
  private grants: Map<string, GrantRecord> | null = null;
  /** Writes run one at a time, in order. */
  private chain: Promise<void> = Promise.resolve();

  constructor(private readonly directory: string) {
    this.path = join(directory, 'bux-grants.json');
    this.tempPath = join(directory, 'bux-grants.json.tmp');
  }

  async prepare(): Promise<void> {
    this.map();
  }

  async record(grant: NewGrant): Promise<boolean> {
    const grants = this.map();
    if (grants.has(grant.transactionId)) return false;
    grants.set(grant.transactionId, { ...grant, state: 'pending' });
    try {
      await this.write();
    } catch (error) {
      grants.delete(grant.transactionId);
      throw error;
    }
    return true;
  }

  async owed(userIds: readonly string[]): Promise<Set<string>> {
    const wanted = new Set(userIds);
    const owed = new Set<string>();
    for (const grant of this.map().values()) {
      if (grant.state === 'pending' && wanted.has(grant.userId)) owed.add(grant.userId);
    }
    return owed;
  }

  async claim(userId: string, owner: string, now: number): Promise<GrantRecord[]> {
    const grants = this.map();
    const claimed: GrantRecord[] = [];
    for (const grant of grants.values()) {
      if (grant.userId !== userId || grant.state !== 'pending') continue;
      const next: GrantRecord = { ...grant, state: 'claimed', claimedAt: now, claimedBy: owner };
      grants.set(grant.transactionId, next);
      claimed.push(next);
    }
    if (claimed.length === 0) return claimed;
    try {
      await this.write();
    } catch (error) {
      // Not durably claimed, so not claimed: a restart would see them pending.
      for (const grant of claimed) {
        grants.set(grant.transactionId, withoutClaim(grant));
      }
      throw error;
    }
    return claimed;
  }

  async markApplied(transactionIds: readonly string[], owner: string, now: number): Promise<void> {
    this.update(transactionIds, owner, (grant) => ({ ...grant, state: 'applied', appliedAt: now }));
    await this.write();
  }

  async release(transactionIds: readonly string[], owner: string): Promise<void> {
    this.update(transactionIds, owner, withoutClaim);
    await this.write();
  }

  async staleClaims(cutoff: number, except: string): Promise<GrantRecord[]> {
    return [...this.map().values()].filter(
      (grant) => grant.state === 'claimed' && grant.claimedBy !== except && (grant.claimedAt ?? 0) < cutoff,
    );
  }

  private update(
    transactionIds: readonly string[],
    owner: string,
    change: (grant: GrantRecord) => GrantRecord,
  ): void {
    const grants = this.map();
    for (const id of transactionIds) {
      const grant = grants.get(id);
      if (grant?.state === 'claimed' && grant.claimedBy === owner) grants.set(id, change(grant));
    }
  }

  /**
   * The map, read from disk the first time. An unreadable file is moved aside
   * and never written over - it is the only record of purchases that may not
   * have been handed over yet.
   */
  private map(): Map<string, GrantRecord> {
    if (this.grants) return this.grants;
    const grants = new Map<string, GrantRecord>();
    const source = existsSync(this.path) ? this.path : existsSync(this.tempPath) ? this.tempPath : null;
    if (source) {
      try {
        const raw = JSON.parse(readFileSync(source, 'utf8')) as Record<string, GrantRecord>;
        for (const [id, grant] of Object.entries(raw)) {
          if (grant && typeof grant === 'object') grants.set(id, { ...grant, transactionId: id });
        }
      } catch (error) {
        const aside = `${source}.corrupt-${Date.now()}`;
        logger.error(SCOPE, `could not parse ${source}; moving it to ${aside}:`, error);
        renameSync(source, aside);
      }
      logger.info(SCOPE, `loaded ${grants.size} grant record(s) from ${source}`);
    }
    this.grants = grants;
    return grants;
  }

  /** Write the whole map, after every write already queued. */
  private write(): Promise<void> {
    const run = this.chain.then(async () => {
      const payload = JSON.stringify(Object.fromEntries(this.map()));
      await mkdir(this.directory, { recursive: true });
      const handle = await open(this.tempPath, 'w');
      try {
        await handle.writeFile(payload);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(this.tempPath, this.path);
    });
    // A failed write must not poison every write after it.
    this.chain = run.catch(() => {});
    return run;
  }
}

const withoutClaim = (grant: GrantRecord): GrantRecord => {
  const { claimedAt: _at, claimedBy: _by, ...rest } = grant;
  return { ...rest, state: 'pending' };
};
