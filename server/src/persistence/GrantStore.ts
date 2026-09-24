/**
 * Where a grant is in its life.
 *
 *  - `pending`: paid for and recorded, waiting for its buyer to be in a room.
 *  - `claimed`: taken by ONE process to credit a player who is in a room there.
 *    `claimedBy` names the process and `claimedAt` starts its lease.
 *  - `applied`: the Wins are in the buyer's profile and that profile write has
 *    landed. Terminal, and kept for good: it IS the record that this
 *    transaction id has been paid out, which is what makes a retried webhook a
 *    no-op however long afterwards it arrives.
 */
export type GrantState = 'pending' | 'claimed' | 'applied';

/** One Bux purchase, as stored. `transactionId` is its identity. */
export interface GrantRecord {
  readonly transactionId: string;
  /** The Bloxity account that paid. */
  readonly userId: string;
  readonly sku: string;
  /** Wins it grants, fixed at the moment it was recorded. */
  readonly wins: number;
  readonly state: GrantState;
  readonly receivedAt: number;
  readonly claimedAt?: number;
  readonly claimedBy?: string;
  readonly appliedAt?: number;
}

/** What the webhook hands over to be recorded. */
export type NewGrant = Pick<GrantRecord, 'transactionId' | 'userId' | 'sku' | 'wins' | 'receivedAt'>;

/**
 * The durable record of every Bux purchase, shared by every process running
 * the game.
 *
 * The queue used to be a Map in one process, and on Legion that is several
 * processes - up to five pods, replaced on every deploy and scaled to zero
 * when idle. A purchase recorded on one pod was invisible to the pod its
 * buyer was playing on, and gone if its own pod went away first; and the
 * transaction-id dedupe was in the same Map, so a webhook retried after a
 * restart paid twice.
 *
 * THE TRANSACTION ID IS THE KEY, so recording one twice is impossible rather
 * than merely checked for. Every state change is a CONDITIONAL write - "move
 * this from pending to claimed", "move this from claimed-by-me to applied" -
 * so two processes racing for one grant cannot both win.
 */
export interface GrantStore {
  /** For logs. */
  readonly kind: string;
  /**
   * True when exactly one process ever uses this store, so any claim not made
   * by the running process belongs to a process that no longer exists.
   */
  readonly exclusive: boolean;
  /** Connect and prepare indexes. Throws if storage is unreachable. */
  prepare?(): Promise<void>;
  /**
   * Durably record a purchase.
   *
   * Resolves `true` once it is recorded - DURABLY, which is what the webhook's
   * 2xx promises - and `false` if that transaction id was already recorded,
   * whatever state it has reached since. Throws if it could not be made
   * durable, and then it has NOT been recorded.
   */
  record(grant: NewGrant): Promise<boolean>;
  /** Of `userIds`, the ones with at least one pending grant. */
  owed(userIds: readonly string[]): Promise<Set<string>>;
  /**
   * Atomically move every pending grant for `userId` to claimed-by-`owner`,
   * and return them. A grant another process claimed first is not returned
   * here - each one is handed to exactly one caller.
   */
  claim(userId: string, owner: string, now: number): Promise<GrantRecord[]>;
  /** claimed-by-`owner` to applied. Anything no longer claimed by `owner` is left alone. */
  markApplied(transactionIds: readonly string[], owner: string, now: number): Promise<void>;
  /** claimed-by-`owner` back to pending, for somebody else to claim. */
  release(transactionIds: readonly string[], owner: string): Promise<void>;
  /** Claims made before `cutoff` by any process other than `except`. */
  staleClaims(cutoff: number, except: string): Promise<GrantRecord[]>;
}
