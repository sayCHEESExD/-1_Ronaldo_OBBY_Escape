/**
 * The persistence boundary.
 *
 * Everything above this interface deals in whole profiles and never knows how
 * or where they are stored. Two adapters exist: Bloxity's managed MongoDB in
 * production (`MONGODB_URI`), and a JSON file for local development.
 * `createPersistence` is the ONLY place that names a concrete one.
 *
 * The container's own disk is NOT durable on Bloxity Hosting - a deploy
 * replaces the container and an idle game scales to zero - which is why a
 * JSON file there lost every player's progress on each update.
 */

/** The earned progression that outlives a session. */
export interface StoredProfile {
  totalSpeed: number;
  wins: number;
  rebirths: number;
  ownedBoots: number;
  /** Cosmetics. Added after v1 shipped, so they default when absent. */
  ownedTrails: number;
  trailSlot: number;
  ownedAuras: number;
  auraSlot: number;
  /**
   * The player's Bloxity display name and avatar.
   *
   * Stored, not just replicated, because the global leaderboards rank every
   * profile - including players who are OFFLINE and have no live state to
   * read a name from. Cosmetic: nothing is keyed on either.
   */
  legionName: string;
  legionPfp: string;
  /**
   * On a GUEST profile: the account key this browser's progress was moved to
   * at that account's first verified login. The data is KEPT as a recovery
   * copy, but it is nobody's live profile any more: a guest joining under
   * this id starts fresh, it is never migrated a second time (which would let
   * one browser seed progress into many accounts), and it is off the boards.
   */
  migratedTo?: string;
  /** On an ACCOUNT profile: the guest key its first progress came from. */
  migratedFrom?: string;
  /**
   * The most recent Bux transaction ids whose Wins are IN this profile.
   *
   * Written in the same save as the Wins, so the two are durable together or
   * not at all. It is what lets a process decide, after another one died
   * holding a claimed grant, whether that grant reached the player.
   */
  buxApplied?: string[];
  /** Wall clock of the last save. Newer wins when the boards' cache refreshes. */
  updatedAt: number;
}

/**
 * Where profiles live.
 *
 * PER KEY, one document per player. Several pods can run this game against
 * one database, so nothing may write back a whole-map snapshot: a pod doing
 * that would roll back every player another pod had saved since.
 *
 * ERRORS ARE NOT "NOT FOUND". `get` resolves `undefined` only when storage
 * answered and has no such profile; if storage could not answer it THROWS. A
 * caller that treated a failed read as a new player would start them from
 * nothing and then save nothing over everything they had.
 */
export interface PersistenceAdapter {
  /** Identifies the backing store in logs. */
  readonly kind: string;
  /**
   * Connect and do any one-off preparation, such as importing an older store.
   * Called at boot, and again until it succeeds. Throws if unreachable.
   */
  prepare?(): Promise<void>;
  /** Every profile, for the boards. Throws if storage cannot be read. */
  loadAll(): Promise<Map<string, StoredProfile>>;
  /** One profile, `undefined` if there is none. Throws if storage cannot be read. */
  get(key: string): Promise<StoredProfile | undefined>;
  /**
   * Durably write one profile. Queued and retried until it lands: a write that
   * fails is kept and tried again, never dropped. Fields this build does not
   * know about are PRESERVED.
   */
  put(key: string, profile: StoredProfile): void;
  /**
   * Create a profile only if none exists under `key`. Resolves `true` if it was
   * created, `false` if one was already there - the guarantee the first-login
   * migration rests on. Throws if storage cannot answer.
   */
  insertIfAbsent(key: string, profile: StoredProfile): Promise<boolean>;
  /**
   * Resolves once every write queued for `key` SO FAR has landed. A write that
   * is failing keeps it waiting - it never resolves on a write that was lost.
   */
  whenWritten(key: string): Promise<void>;
  /** Make every queued write durable, or give up after `timeoutMs`. */
  flush(timeoutMs?: number): Promise<void>;
  /** Best-effort synchronous flush for the process `exit` hook (file only). */
  flushSync?(): void;
  /** Writes still waiting to land, for shutdown logging. */
  readonly pendingWrites: number;
  /** Release connections. Called last on shutdown. */
  close?(): Promise<void>;
}
