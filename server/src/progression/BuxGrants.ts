import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { createGrantStore, type GrantRecord, type GrantStore } from '../persistence/index.js';
import { logger } from '../util/logger.js';
import { accountKey, profileStore } from './ProfileStore.js';

const SCOPE = 'BuxGrants';

/**
 * How long a claim belongs to the process that made it.
 *
 * A claim normally ends within milliseconds: the room credits the Wins, the
 * profile save lands, the grant is marked applied. One still open after this
 * long belongs to a process that died in between, and the sweep settles it.
 * Generous on purpose: a live pod whose write is merely slow must never have
 * its claim taken.
 */
const CLAIM_LEASE_MS = 5 * 60_000;

/** How often every process looks for claims that outlived their owner. */
const SWEEP_MS = 60_000;

/** One purchase, waiting for its player to be somewhere it can be applied. */
export type PendingGrant = GrantRecord;

/** What became of a webhook's purchase. */
export type RecordOutcome = 'recorded' | 'duplicate';

/**
 * Purchases that have been paid for and not yet handed over.
 *
 * A QUEUE rather than a direct write. The webhook arrives at a moment of
 * Bloxity's choosing, while the buyer may be live in a room whose replicated
 * Wins the next autosave writes over the stored profile - so crediting the
 * stored profile directly would be a credit that vanishes. The webhook only
 * RECORDS, keyed by the Bloxity account that paid; a room applies what is
 * waiting when that account is VERIFIED in it - on join, on sign-in, and on a
 * poll for a player who bought something mid-session.
 *
 * THE QUEUE IS IN STORAGE, NOT IN THIS PROCESS. On Legion the game is several
 * pods behind one webhook URL, and the pod Bloxity delivers to is often not
 * the pod the buyer plays on. A grant is recorded durably before the webhook
 * is answered, claimed atomically by whichever pod has its buyer, and kept
 * afterwards as the record that its transaction id has been paid.
 *
 * pending -> claimed -> applied, and "applied" is written only once the
 * profile save carrying its Wins has LANDED. A process that dies with a claim
 * open leaves it to the sweep, which asks the buyer's stored profile whether
 * the Wins arrived (`buxApplied` is written in the same save as the Wins).
 */
class BuxGrants {
  private store: GrantStore | null = null;
  /** This process, as named on the claims it makes. Unique per boot. */
  readonly owner = `${hostname()}/${process.pid}/${randomUUID().slice(0, 8)}`;
  private recordedHere = 0;
  private sweepTimer: NodeJS.Timeout | null = null;
  private sweeping = false;
  private readonly confirming = new Set<Promise<void>>();

  /** Created on first use, so importing this module opens nothing. */
  private grants(): GrantStore {
    this.store ??= createGrantStore();
    return this.store;
  }

  /**
   * Prepare storage and settle claims left by a process that is gone.
   * Never fatal, for the same reason `profileStore.open` is not.
   */
  async open(): Promise<void> {
    try {
      await this.grants().prepare?.();
      logger.info(SCOPE, `grants: ${this.grants().kind} (claims as ${this.owner})`);
      await this.sweep();
    } catch (error: unknown) {
      logger.error(SCOPE, `grant storage (${this.grants().kind}) unavailable at boot; will retry:`, String(error));
    }
    this.sweepTimer = setInterval(() => void this.sweep(), SWEEP_MS);
    this.sweepTimer.unref?.();
  }

  /** Stop sweeping, and give confirmations already under way time to land. */
  async close(timeoutMs = 3000): Promise<void> {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = null;
    if (this.confirming.size === 0) return;
    await Promise.race([Promise.allSettled([...this.confirming]), sleep(timeoutMs)]);
  }

  /**
   * Record a paid purchase DURABLY. Resolves only once the record would
   * survive this process dying, and throws if it could not be made so - the
   * webhook's 2xx is a promise the purchase will be handed over.
   */
  async record(bloxityId: string, transactionId: string, sku: string, wins: number): Promise<RecordOutcome> {
    const recorded = await this.grants().record({
      transactionId,
      userId: bloxityId,
      sku,
      wins,
      receivedAt: Date.now(),
    });
    if (!recorded) {
      logger.info(SCOPE, `duplicate webhook for ${transactionId}, ignored`);
      return 'duplicate';
    }
    this.recordedHere += 1;
    logger.info(SCOPE, `recorded ${sku} (+${wins} wins) for ${bloxityId} [${transactionId}]`);
    return 'recorded';
  }

  /** Bumped by every purchase recorded in THIS process, so a room here polls at once. */
  get localVersion(): number {
    return this.recordedHere;
  }

  /** Of these accounts, the ones with something waiting. One query for a room. */
  owed(bloxityIds: readonly string[]): Promise<Set<string>> {
    return this.grants().owed(bloxityIds);
  }

  /**
   * Take everything waiting for a VERIFIED account. Each grant is handed to
   * exactly one caller in the whole deployment, and stays claimed by this
   * process until `confirm` or `release`.
   */
  claim(bloxityId: string): Promise<PendingGrant[]> {
    if (!bloxityId) return Promise.resolve([]);
    return this.grants().claim(bloxityId, this.owner, Date.now());
  }

  /**
   * The grants' Wins are in the player's state and a save of `profileKey`
   * carrying them is queued: mark them applied once that save LANDS - not
   * before, or a lost save would leave a grant recorded as paid that never was.
   */
  confirm(profileKey: string, grants: readonly PendingGrant[]): void {
    if (grants.length === 0) return;
    const ids = grants.map((grant) => grant.transactionId);
    const done = profileStore
      .whenWritten(profileKey)
      .then(() => this.grants().markApplied(ids, this.owner, Date.now()))
      .catch((error: unknown) => {
        // Left claimed; the sweep finds the Wins in the profile and settles it.
        logger.warn(SCOPE, `could not mark [${ids.join(', ')}] applied: ${String(error)}`);
      })
      .finally(() => {
        this.confirming.delete(done);
      });
    this.confirming.add(done);
  }

  /** Hand claimed grants back, unpaid, for wherever their buyer is next. */
  async release(grants: readonly PendingGrant[]): Promise<void> {
    if (grants.length === 0) return;
    const ids = grants.map((grant) => grant.transactionId);
    try {
      await this.grants().release(ids, this.owner);
    } catch (error: unknown) {
      // Still claimed by us; the sweep returns them to the queue after the lease.
      logger.warn(SCOPE, `could not release [${ids.join(', ')}]: ${String(error)}`);
    }
  }

  /**
   * Settle claims whose process is gone: the buyer's STORED profile decides.
   * The grant's id in `buxApplied` means the save carrying its Wins landed,
   * so it is applied; absent means it never did, so it is owed again. Both
   * writes are conditional on the claim being as it was read, so two pods
   * sweeping at once settle each claim once.
   */
  private async sweep(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      const store = this.grants();
      // With a store only this process uses, any claim not ours is from a
      // process that has already exited.
      const cutoff = store.exclusive ? Date.now() : Date.now() - CLAIM_LEASE_MS;
      for (const grant of await store.staleClaims(cutoff, this.owner)) {
        if (!grant.claimedBy) continue;
        const paid = await profileStore.storedWithGrant(accountKey(grant.userId), grant.transactionId);
        if (paid) await store.markApplied([grant.transactionId], grant.claimedBy, Date.now());
        else await store.release([grant.transactionId], grant.claimedBy);
        logger.warn(
          SCOPE,
          `settled ${grant.transactionId} left claimed by ${grant.claimedBy}: ` +
            (paid ? 'already in the profile, marked applied' : 'never saved, owed again'),
        );
      }
    } catch (error: unknown) {
      logger.warn(SCOPE, `sweep failed; will retry: ${String(error)}`);
    } finally {
      this.sweeping = false;
    }
  }
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms).unref?.();
  });

export const buxGrants = new BuxGrants();
