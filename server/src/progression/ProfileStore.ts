import { STARTER_BOOT_MASK } from '@obby/shared';
import { createPersistence, type PersistenceAdapter, type StoredProfile } from '../persistence/index.js';
import { logger } from '../util/logger.js';
import type { PlayerState } from '../rooms/state/PlayerState.js';

const SCOPE = 'ProfileStore';

/** Wait between attempts to reach storage at boot. */
const OPEN_RETRY_MS = 5_000;

/**
 * How often every profile is re-read for the boards, so they see what other
 * server instances have saved.
 */
const RELOAD_INTERVAL_MS = 60_000;

/**
 * Bux transaction ids remembered on a profile. Only a claim younger than the
 * grant lease is ever checked against the list, so it only needs to hold what
 * one player could plausibly buy in that time.
 */
const BUX_APPLIED_KEPT = 32;

/** The progression worth carrying across a reconnect or a server restart. */
export type Profile = StoredProfile;

/**
 * The key a Bloxity ACCOUNT's profile is stored under.
 *
 * Namespaced so it can never collide with a guest key, and the namespace is
 * RESERVED: `guestKeyFrom` refuses any browser-supplied id that starts with
 * it. Without that, a guest could name their browser id `bloxity:<someone's
 * account id>` and be handed that account's progress with no login at all.
 */
export const ACCOUNT_PREFIX = 'bloxity:';

/** Storage key for an account id THE SERVER VERIFIED with Bloxity. */
export const accountKey = (accountId: string): string => `${ACCOUNT_PREFIX}${accountId}`;

/**
 * The guest key a browser asked for, or '' if it cannot have one: whatever id
 * this browser generated, with the account namespace carved out of it.
 */
export const guestKeyFrom = (raw: unknown): string => {
  if (typeof raw !== 'string') return '';
  const id = raw.slice(0, 64);
  if (!id || id.startsWith(ACCOUNT_PREFIX)) return '';
  return id;
};

/** Which profile a session plays on, and what was stored there. */
export interface Resolution {
  /** The storage key progression is saved under, or '' for "do not save". */
  readonly key: string;
  /** The stored profile, or undefined for a fresh start. */
  readonly profile: Profile | undefined;
  /** True when this call just moved a guest's progress onto the account. */
  readonly migrated: boolean;
}

const emptyProfile = (): Profile => ({
  totalSpeed: 0,
  wins: 0,
  rebirths: 0,
  ownedBoots: STARTER_BOOT_MASK,
  ownedTrails: 0,
  trailSlot: 0,
  ownedAuras: 0,
  auraSlot: 0,
  legionName: '',
  legionPfp: '',
  updatedAt: 0,
});

/** The earned progression of a live player, as a profile. */
const snapshot = (player: PlayerState): Profile => ({
  totalSpeed: player.totalSpeed,
  wins: player.wins,
  rebirths: player.rebirths,
  ownedBoots: player.ownedBoots,
  ownedTrails: player.ownedTrails,
  trailSlot: player.trailSlot,
  ownedAuras: player.ownedAuras,
  auraSlot: player.auraSlot,
  // Carried so the boards can name and picture this player while they are
  // offline. Already cleaned by the room, so stored as-is.
  legionName: player.legionName,
  legionPfp: player.legionPfp,
  updatedAt: Date.now(),
});

/**
 * Whether a profile holds anything worth moving onto an account. An empty
 * browser profile is not migrated: marking it moved would only stop that
 * browser bringing real progress to an account later.
 */
const hasProgress = (profile: Profile): boolean =>
  profile.totalSpeed > 0 ||
  profile.wins > 0 ||
  profile.rebirths > 0 ||
  profile.ownedTrails > 0 ||
  profile.ownedAuras > 0 ||
  (profile.ownedBoots & ~STARTER_BOOT_MASK) !== 0;

/**
 * Earned progression, backed by a durable store.
 *
 * TWO KINDS OF KEY, and the difference is the point:
 *  - a GUEST key is the id this browser generated and keeps in localStorage.
 *    It follows one browser, not a person, and it is what a player who is
 *    not signed in plays on;
 *  - an ACCOUNT key (`bloxity:<id>`) is a Bloxity account id that the SERVER
 *    verified with Bloxity. It is never taken from the client, and it is the
 *    same on every browser and device the account signs in from.
 *
 * READS THAT DECIDE PROGRESS GO TO STORAGE, at the moment a player joins or
 * signs in. The in-memory map is a cache for the boards and nothing else:
 * several pods share one database, and a copy cached at boot is stale the
 * moment the player saves on another pod.
 *
 * Must outlive any single room - Colyseus disposes a room with its last
 * client - hence the process-wide singleton below.
 */
export class ProfileStore {
  private readonly adapter: PersistenceAdapter;
  /** Every live (non-migrated) profile this process knows of, for the boards. */
  private readonly cache = new Map<string, Profile>();
  private opening: Promise<void> | null = null;
  private reloadTimer: NodeJS.Timeout | null = null;

  constructor(adapter: PersistenceAdapter) {
    this.adapter = adapter;
  }

  get storageKind(): string {
    return this.adapter.kind;
  }

  /**
   * Prepare storage (including any legacy import) and fill the boards' cache,
   * retrying in the background until it answers.
   *
   * NEVER FATAL. A database that is down at boot must not stop `/health`
   * answering, or Legion restart-loops the pod. Joins do not wait on this:
   * each reads storage directly and is refused cleanly if it cannot.
   */
  open(): Promise<void> {
    this.opening ??= (async () => {
      for (let attempt = 1; ; attempt += 1) {
        try {
          await this.adapter.prepare?.();
          await this.reload();
          logger.info(SCOPE, `store="${this.adapter.kind}" profiles=${this.cache.size}`);
          break;
        } catch (error: unknown) {
          logger.error(
            SCOPE,
            `store "${this.adapter.kind}" unavailable (attempt ${attempt}) - joins are refused until it answers:`,
            error instanceof Error ? error.message : error,
          );
          await new Promise((resolve) => setTimeout(resolve, OPEN_RETRY_MS));
        }
      }
      this.reloadTimer = setInterval(() => {
        this.reload().catch((error: unknown) => {
          logger.warn(SCOPE, `board refresh failed: ${String(error)}`);
        });
      }, RELOAD_INTERVAL_MS);
      this.reloadTimer.unref?.();
    })();
    return this.opening;
  }

  /**
   * Decide which profile a session plays on, and read it FRESH.
   *
   * THROWS if storage cannot answer. The caller must refuse rather than start
   * the player from nothing, which the next save would write over their
   * progress.
   *
   * @param guestKey  this browser's guest key, from `guestKeyFrom`, or ''.
   * @param accountId a Bloxity account id THE SERVER VERIFIED, or null.
   * @param live      the player's current state when a session already in a
   *                  room signs in - newer than anything saved, so it is what
   *                  a first login moves onto the account.
   */
  async resolve(guestKey: string, accountId: string | null, live?: PlayerState): Promise<Resolution> {
    if (!accountId) {
      if (!guestKey) return { key: '', profile: undefined, migrated: false };
      const stored = await this.adapter.get(guestKey);
      // A guest profile that moved to an account is NOT restored: its progress
      // belongs to the account now, and restoring it as well would let one
      // browser's progress be played - and moved again - twice.
      const profile = stored && !stored.migratedTo ? stored : undefined;
      return { key: guestKey, profile, migrated: false };
    }

    const key = accountKey(accountId);
    const existing = await this.adapter.get(key);
    // THE ACCOUNT WINS. Whatever this browser holds, an account that already
    // has progress is never touched by it.
    if (existing) return { key, profile: existing, migrated: false };

    // The account's first login. Is there browser progress to bring over?
    const source = await this.migrationSource(guestKey, live);
    if (!source) return { key, profile: undefined, migrated: false };

    const now = Date.now();
    const moved: Profile = { ...source, migratedFrom: guestKey, updatedAt: now };
    delete moved.migratedTo;
    // Create-if-absent is the guarantee: if another session or pod created
    // this account's profile a moment ago, this refuses rather than replacing
    // it, and the session plays on the winner.
    if (!(await this.adapter.insertIfAbsent(key, moved))) {
      const winner = await this.adapter.get(key);
      return { key, profile: winner, migrated: false };
    }
    this.cache.set(key, moved);

    // Only AFTER the account's copy exists is the guest copy marked as moved,
    // its data kept as a recovery copy. A crash between the two duplicates the
    // progress; it never loses it.
    const tombstone: Profile = { ...source, migratedTo: key, updatedAt: now };
    delete tombstone.migratedFrom;
    this.adapter.put(guestKey, tombstone);
    this.cache.delete(guestKey);

    logger.info(
      SCOPE,
      `first login: moved guest ${guestKey} -> ${key} ` +
        `(wins=${moved.wins} speed=${Math.floor(moved.totalSpeed)} rebirths=${moved.rebirths})`,
    );
    return { key, profile: moved, migrated: true };
  }

  /**
   * Load a RESOLVED profile onto a player, or seed a new one.
   *
   * `undefined` is a fresh start, written out explicitly - which matters for a
   * session switching profiles, where "whatever the state held" is the other
   * profile's progress. Only the deriving facts: level, movement speed and the
   * equipped boot are recomputed from these by their own services.
   */
  restore(key: string, player: PlayerState, stored: Profile | undefined): Profile {
    const profile = stored ?? emptyProfile();
    player.totalSpeed = profile.totalSpeed;
    player.wins = profile.wins;
    player.rebirths = profile.rebirths;
    player.ownedBoots = profile.ownedBoots;
    player.ownedTrails = profile.ownedTrails;
    player.trailSlot = profile.trailSlot;
    player.ownedAuras = profile.ownedAuras;
    player.auraSlot = profile.auraSlot;

    if (key && stored && !stored.migratedTo) this.cache.set(key, { ...stored });
    logger.info(
      SCOPE,
      `${stored ? 'restored' : 'new profile'} key=${key || '(none)'} ` +
        `speed=${Math.floor(profile.totalSpeed)} wins=${profile.wins} ` +
        `rebirths=${profile.rebirths} boots=${profile.ownedBoots}`,
    );
    return profile;
  }

  /**
   * Capture the player's earned progression under `key`. Safe to call often.
   *
   * @param granted Bux transaction ids whose Wins this save carries for the
   *                first time. Written IN THE SAME SAVE as the Wins, so the
   *                profile can later answer whether a grant reached it.
   */
  save(key: string, player: PlayerState, granted: readonly string[] = []): void {
    if (!key) return;
    const previous = this.cache.get(key);
    const profile = snapshot(player);
    // Where an account's first progress came from stays on it. `migratedTo`
    // is deliberately NOT carried: a guest profile being saved is being
    // PLAYED, which makes it somebody's live profile again.
    if (previous?.migratedFrom) profile.migratedFrom = previous.migratedFrom;
    const buxApplied = [...new Set([...(previous?.buxApplied ?? []), ...granted])].slice(-BUX_APPLIED_KEPT);
    if (buxApplied.length > 0) profile.buxApplied = buxApplied;
    this.cache.set(key, profile);
    this.adapter.put(key, profile);
  }

  /**
   * Whether STORAGE holds the profile under `key` with this grant paid in.
   * Throws if storage cannot answer - "could not ask" is never "no".
   */
  async storedWithGrant(key: string, transactionId: string): Promise<boolean> {
    const stored = await this.adapter.get(key);
    return stored?.buxApplied?.includes(transactionId) ?? false;
  }

  /** Resolves once everything saved under `key` so far has landed. */
  whenWritten(key: string): Promise<void> {
    return this.adapter.whenWritten(key);
  }

  /** Write everything pending to durable storage, or give up after `timeoutMs`. */
  flush(timeoutMs?: number): Promise<void> {
    return this.adapter.flush(timeoutMs);
  }

  /** Synchronous last resort for the process `exit` hook (local file only). */
  flushSync(): void {
    this.adapter.flushSync?.();
  }

  /** Stop refreshing and release the store's connections. Call after `flush`. */
  async close(): Promise<void> {
    if (this.reloadTimer) clearInterval(this.reloadTimer);
    this.reloadTimer = null;
    const left = this.adapter.pendingWrites;
    if (left > 0) logger.error(SCOPE, `${left} profile write(s) could not be made durable`);
    await this.adapter.close?.();
  }

  /**
   * Every LIVE profile, for ranking. Read-only: the leaderboard observes
   * progression, it never writes it. Guest profiles that moved to an account
   * are not in here - that player is on the boards under the account.
   */
  get all(): ReadonlyMap<string, Profile> {
    return this.cache;
  }

  get size(): number {
    return this.cache.size;
  }

  /** The browser progress a first login would move, or null for none. */
  private async migrationSource(guestKey: string, live: PlayerState | undefined): Promise<Profile | null> {
    if (!guestKey) return null;
    const stored = await this.adapter.get(guestKey);
    // Already moved to an account once: never a second time.
    if (stored?.migratedTo) return null;
    // A session signing in holds its progress in memory, newer than the last
    // autosave - that is what moves, over the stored fields so nothing else
    // the profile carried is lost.
    const source: Profile | undefined = live ? { ...(stored ?? {}), ...snapshot(live) } : stored;
    if (source) delete source.buxApplied;
    return source && hasProgress(source) ? source : null;
  }

  /**
   * Re-read every profile for the boards. A stored copy replaces the cached
   * one only when it is at least as new, so a player saving on THIS pod is
   * never shown their own older figure.
   */
  private async reload(): Promise<void> {
    const all = await this.adapter.loadAll();
    for (const [key, profile] of all) {
      if (profile.migratedTo) {
        this.cache.delete(key);
        continue;
      }
      const cached = this.cache.get(key);
      if (!cached || profile.updatedAt >= cached.updatedAt) this.cache.set(key, profile);
    }
  }
}

/**
 * Process-wide store, shared by every room instance. Rooms come and go with
 * their occupants, and progression has to outlive them.
 */
export const profileStore = new ProfileStore(createPersistence());
