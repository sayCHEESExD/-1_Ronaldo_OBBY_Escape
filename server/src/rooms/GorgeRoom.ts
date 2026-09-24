import { Client, Room, ServerError } from '@colyseus/core';
import type { ArraySchema } from '@colyseus/schema';
import {
  DEATH_PLANE_Y,
  MessageType,
  PlayerAnimationState,
  SPAWN_POSITION,
  SPAWN_ROTATION_Y,
  cleanAvatarLook,
  type ClaimTrophyMessage,
  type BuyAuraMessage,
  type BuyBootMessage,
  type BuyTrailMessage,
  type EquipAuraMessage,
  type EquipTrailMessage,
  type RebirthMessage,
  type HazardHitMessage,
  type AuthenticateMessage,
  type UpdateIdentityMessage,
  type UpdateAvatarMessage,
  type MoveMessage,
  type RespawnMessage,
  type RespawnReason,
} from '@obby/shared';
import { serverConfig } from '../config/serverConfig.js';
import { MovementService } from '../movement/MovementService.js';
import { BootService } from '../progression/BootService.js';
import { CosmeticService } from '../progression/CosmeticService.js';
import { AURA_BINDING, TRAIL_BINDING } from '../progression/cosmeticBindings.js';
import { bloxityAuth } from '../bloxity/BloxityAuth.js';
import { guestKeyFrom, profileStore, type Profile, type Resolution } from '../progression/ProfileStore.js';
import { creditWins } from '@obby/shared';
import { buxGrants } from '../progression/BuxGrants.js';
import { LeaderboardService, type RankedSource } from '../progression/LeaderboardService.js';
import { ProgressionService } from '../progression/ProgressionService.js';
import { RebirthService } from '../progression/RebirthService.js';
import { SpeedService } from '../progression/SpeedService.js';
import { TreadmillService } from '../progression/TreadmillService.js';
import { TrophyService } from '../progression/TrophyService.js';
import { logger } from '../util/logger.js';
import { GorgeState, LeaderboardEntry } from './state/GorgeState.js';
import { PlayerState } from './state/PlayerState.js';

const SCOPE = 'GorgeRoom';

/**
 * Seconds between checks for Bux purchases owed to verified players here.
 * A purchase recorded by THIS process is handed over at once instead
 * (`buxGrants.localVersion`); the poll catches one delivered to another pod.
 */
const GRANT_POLL_SECONDS = 3;

/**
 * When Bloxity could not be ASKED about a login (timeout, 5xx), the player
 * plays on their browser's guest profile meanwhile and the login is checked
 * again after each of these delays - a signed-in player is never demoted for
 * good because the portal hiccuped.
 */
const REVERIFY_DELAYS_MS = [10_000, 30_000, 90_000] as const;

/** What `onAuth` decides about a joining player, handed to `onJoin`. */
interface SessionAuth {
  readonly resolution: Resolution;
  readonly guestKey: string;
  /** The Bloxity account Bloxity itself vouched for, or null. */
  readonly accountId: string | null;
  /** A token Bloxity could not be asked about, to try again after joining. */
  readonly retryToken: string;
}

/**
 * Maximum concurrent players in one gorge instance.
 *
 * Colyseus enforces this itself: the room LOCKS the moment it fills, so the
 * matchmaker stops offering it and `joinOrCreate` gives the next player a new
 * one. There is deliberately nothing here that counts players or picks rooms -
 * a hand-rolled matchmaker would be a second source of truth for something the
 * framework already owns, and the two would eventually disagree.
 */
const MAX_CLIENTS = 15;

/** Longest Bloxity display name drawn on another player's screen. */
const LEGION_NAME_MAX = 32;

/**
 * The shape a Bloxity account id may take.
 *
 * Deliberately permissive rather than pinned to one id format: the platform's
 * user-id format is not documented, and a pattern stricter than the real ids
 * would silently blank every one and hide the friend-request button for
 * everybody. This only stops junk and oversized strings reaching other
 * players' state.
 */
const LEGION_USER_ID = /^[A-Za-z0-9_-]{1,64}$/;

// A display name, never a handle: a leading '@' is dropped so an @username can
// never be replicated or persisted as the name a player is shown by.
const cleanLegionName = (raw: unknown): string =>
  typeof raw === 'string' ? raw.trim().replace(/^@+/, '').slice(0, LEGION_NAME_MAX).trim() : '';

const cleanLegionUserId = (raw: unknown): string =>
  typeof raw === 'string' && LEGION_USER_ID.test(raw) ? raw : '';

/** Hosts a replicated avatar URL may point at: bloxity.io and its subdomains. */
const LEGION_ASSET_HOST = /(^|\.)bloxity\.io$/i;

/**
 * Clean a replicated avatar URL.
 *
 * Stricter than the other two fields because this one is FETCHED rather than
 * drawn: every other client's browser loads it. An arbitrary URL here would
 * let one player point everybody else's browser at anything they liked - a
 * tracking pixel that harvests IP addresses, or an endpoint that counts who
 * is in the room. Only https on Bloxity's own hosts gets through.
 */
const cleanLegionPfp = (raw: unknown): string => {
  // A render key names every equipped part and proportion, so a fully
  // customised avatar's picture URL runs past 300 characters.
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 600) return '';
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return '';
    if (!LEGION_ASSET_HOST.test(url.hostname)) return '';
    return url.toString();
  } catch {
    // Not a URL at all.
    return '';
  }
};

/**
 * Seconds between background saves of every connected player.
 *
 * Progression is written whenever something discrete happens - a level, a
 * trophy, a boot, a rebirth - but Speed accrues continuously between those, so
 * an unclean shutdown would otherwise lose the farming since the last level.
 */
const AUTOSAVE_SECONDS = 15;

/**
 * Seconds between leaderboard rebuilds.
 *
 * Slow on purpose. The boards rank persisted progression, which only moves
 * when a profile is saved - on a level, a trophy, a purchase, a rebirth, or
 * the 15s autosave - so refreshing faster would re-sort the same numbers and
 * push patches nobody can see. Colyseus only sends rows that actually
 * changed, so a quiet server costs nothing at all.
 */
const LEADERBOARD_SECONDS = 5;


const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isAnimationState = (value: unknown): value is PlayerAnimationState =>
  typeof value === 'string' &&
  (Object.values(PlayerAnimationState) as string[]).includes(value);

export class GorgeRoom extends Room<GorgeState> {
  override maxClients = MAX_CLIENTS;

  private readonly progression = new ProgressionService();
  private readonly movement = new MovementService();
  private readonly trophies = new TrophyService();
  private readonly speed = new SpeedService();
  private readonly boots = new BootService();
  private readonly treadmills = new TreadmillService();
  private readonly trails = new CosmeticService(TRAIL_BINDING);
  private readonly auras = new CosmeticService(AURA_BINDING);
  private readonly rebirths = new RebirthService();
  /** Global rankings, read from the process-wide profile store. */
  private readonly leaderboards = new LeaderboardService();
  /** Shared across rooms - a room dies with its last client, profiles must not. */
  private readonly profiles = profileStore;
  /**
   * The storage key each session's progression is saved under: the VERIFIED
   * Bloxity account's key when signed in, the browser's guest key otherwise.
   * Never the Colyseus session id.
   */
  private readonly playerIds = new Map<string, string>();
  /** This browser's guest key per session, kept for sign-in and sign-out. */
  private readonly guestKeys = new Map<string, string>();
  /** The account Bloxity VERIFIED per session. Only ever written from its answer. */
  private readonly accountIds = new Map<string, string>();
  /**
   * Sessions whose profile is being switched right now. Their saves are held
   * off, so an autosave cannot write the old profile back mid-move.
   */
  private readonly switching = new Set<string>();
  /** The newest login a busy session has asked for, applied once it is free. */
  private readonly queuedTokens = new Map<string, string>();
  /** Seconds since the last background save of every connected player. */
  private autosaveTimer = 0;
  /** Seconds since the boards were last rebuilt. */
  private leaderboardTimer = 0;

  /** Seconds since verified players were last checked for owed purchases. */
  private grantPollTimer = 0;
  private grantPolling = false;
  private grantVersionSeen = -1;
  /** Sessions whose grants are being handed over right now. */
  private readonly granting = new Set<string>();

  override onCreate(): void {
    this.state = new GorgeState();
    this.setPatchRate(serverConfig.patchRateMs);

    this.onMessage(MessageType.Move, (client, message: MoveMessage) => {
      this.handleMove(client, message);
    });

    this.onMessage(MessageType.ClaimTrophy, (client, message: ClaimTrophyMessage) => {
      this.handleClaimTrophy(client, message);
    });

    this.onMessage(MessageType.RequestRespawn, (client) => {
      const player = this.state.players.get(client.sessionId);
      if (player) this.respawn(client.sessionId, player, 'manual');
    });

    // Cosmetic identity only - a display name and a Bloxity account id. A guest
    // who logs in after joining would otherwise stay known to everyone else by
    // their guest name, with no account to befriend.
    this.onMessage(MessageType.UpdateIdentity, (client, message: UpdateIdentityMessage) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      player.legionName = cleanLegionName(message?.legionName);
      player.legionUserId = cleanLegionUserId(message?.legionUserId);
      player.legionPfp = cleanLegionPfp(message?.legionPfp);
    });

    // Cosmetic avatar look. Re-encoded through the shared parser, so only
    // known id characters and clamped proportions are ever replicated.
    this.onMessage(MessageType.UpdateAvatar, (client, message: UpdateAvatarMessage) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      player.legionAvatar = cleanAvatarLook(message?.legionAvatar);
    });

    // The player's LOGIN changed. The token is verified with Bloxity; only the
    // account Bloxity names can move this session onto an account profile.
    this.onMessage(MessageType.Authenticate, (client, message: AuthenticateMessage) => {
      const token = typeof message?.token === 'string' ? message.token : '';
      if (this.switching.has(client.sessionId)) {
        this.queuedTokens.set(client.sessionId, token);
        return;
      }
      void this.authenticate(client, token);
    });

    this.onMessage(MessageType.HazardHit, (client, message: HazardHitMessage) => {
      this.handleHazardHit(client, message);
    });

    this.onMessage(MessageType.BuyBoot, (client, message: BuyBootMessage) => {
      this.handleBuyBoot(client, message);
    });

    this.onMessage(MessageType.Rebirth, (client, _message: RebirthMessage) => {
      this.handleRebirth(client);
    });

    this.onMessage(MessageType.BuyTrail, (client, message: BuyTrailMessage) => {
      this.handleBuyCosmetic(client, this.trails, message?.slot);
    });

    this.onMessage(MessageType.EquipTrail, (client, message: EquipTrailMessage) => {
      this.handleEquipCosmetic(client, this.trails, message?.slot);
    });

    this.onMessage(MessageType.BuyAura, (client, message: BuyAuraMessage) => {
      this.handleBuyCosmetic(client, this.auras, message?.slot);
    });

    this.onMessage(MessageType.EquipAura, (client, message: EquipAuraMessage) => {
      this.handleEquipCosmetic(client, this.auras, message?.slot);
    });

    // Populate the boards before the first player can look at them.
    this.refreshLeaderboards();

    this.setSimulationInterval((deltaMs) => this.update(deltaMs), serverConfig.patchRateMs);

    logger.info(SCOPE, `created roomId=${this.roomId} patchRate=${serverConfig.patchRateMs}ms`);
  }

  /**
   * Decide WHO this is, and admit them only once their progress can be read.
   *
   * A Bloxity login token is verified with Bloxity; the account it names is
   * the only account identity this session will have, and its profile is
   * what they play on - the same on every device. No token, or one Bloxity
   * rejects, plays on this browser's guest profile as before.
   *
   * The profile is read FRESH: with several server instances the copy this
   * one cached may be older than another instance's save. If storage is not
   * ready or cannot be read the join is REFUSED with a retryable error,
   * because admitting them on an empty profile would save it over their real
   * progress.
   */
  override async onAuth(
    _client: Client,
    options?: { playerId?: string; bloxityToken?: string },
  ): Promise<SessionAuth> {
    const guestKey = guestKeyFrom(options?.playerId);
    const token = typeof options?.bloxityToken === 'string' ? options.bloxityToken : '';
    const verdict = token ? await bloxityAuth.verify(token) : null;
    const accountId = verdict?.kind === 'verified' ? verdict.accountId : null;

    let resolution: Resolution;
    try {
      resolution = await this.profiles.resolve(guestKey, accountId);
    } catch (error: unknown) {
      logger.error(
        SCOPE,
        `could not read profile guest=${guestKey || '-'} account=${accountId ?? '-'}`,
        error,
      );
      throw new ServerError(503, 'Could not load your saved progress - please try again');
    }
    return {
      resolution,
      guestKey,
      accountId,
      retryToken: verdict?.kind === 'unavailable' ? token : '',
    };
  }

  override onJoin(
    client: Client,
    options?: {
      playerId?: string;
      legionName?: string;
      legionUserId?: string;
      legionPfp?: string;
      legionAvatar?: string;
    },
    auth?: SessionAuth,
  ): void {
    const player = new PlayerState();
    player.sessionId = client.sessionId;
    this.progression.initialise(player);
    this.trophies.initialise(player);
    this.speed.initialise(player);
    this.boots.initialise(player);
    this.treadmills.initialise(player);
    this.trails.initialise(player);
    this.auras.initialise(player);

    // Trimmed, capped and shape-checked: both are drawn or acted on by other
    // players' clients, so an unbounded string would be somebody else's problem
    // to render. `UpdateIdentity` runs the same cleaning for a later login.
    player.legionName = cleanLegionName(options?.legionName);
    player.legionUserId = cleanLegionUserId(options?.legionUserId);
    player.legionPfp = cleanLegionPfp(options?.legionPfp);
    player.legionAvatar = cleanAvatarLook(options?.legionAvatar);

    // Restore earned progression - from the profile `onAuth` resolved - then
    // let the derived fields (cap, backflips, movement speed) follow from it.
    const resolution = auth?.resolution;
    if (auth?.guestKey) this.guestKeys.set(client.sessionId, auth.guestKey);
    if (auth?.accountId) this.accountIds.set(client.sessionId, auth.accountId);
    this.loadProgress(client.sessionId, player, resolution?.key ?? '', resolution?.profile);
    // Movement is initialised last: it seeds the flip allowance from the
    // capacity the progression services just resolved.
    this.movement.initialise(player);

    this.state.players.set(client.sessionId, player);

    logger.info(
      SCOPE,
      `join sessionId=${client.sessionId} players=${this.state.players.size} ` +
        `as ${auth?.accountId ? 'account' : 'guest'} ` +
        `(${resolution?.migrated ? 'migrated' : resolution?.profile ? 'restored' : 'new'}) ` +
        `level=${player.level} rebirths=${player.rebirths} wins=${player.wins}`,
    );

    // Anything bought while they were away, or recorded on another pod.
    if (auth?.accountId) void this.applyGrants(client.sessionId);

    // Bloxity did not answer about this login: play as a guest for now, and
    // ask again shortly rather than leaving a signed-in player a guest.
    if (auth?.retryToken) this.scheduleReverify(client, auth.retryToken, 0);
  }

  /**
   * Put a profile's earned progression onto a player and re-derive everything
   * that follows from it. Shared by a join and a mid-session sign-in, so the
   * two cannot restore differently.
   */
  private loadProgress(
    sessionId: string,
    player: PlayerState,
    key: string,
    profile: Profile | undefined,
  ): void {
    if (key) {
      this.playerIds.set(sessionId, key);
      this.profiles.restore(key, player, profile);
      this.boots.equipBest(player);
      // A restored profile could name an item it does not own if the save were
      // hand-edited; the multipliers already ignore that, this keeps the
      // replicated state honest too.
      this.trails.sanitise(player);
      this.auras.sanitise(player);
    } else {
      this.playerIds.delete(sessionId);
    }
    this.rebirths.sync(player);
    // LAST of the progression services, because it is the one that resolves
    // movement speed - and it can only do that once the restored rebirth
    // count, boots and cosmetics are all in place.
    this.speed.applyRestoredProgress(player);
    this.treadmills.syncGate(player);
  }

  /**
   * Move a live session onto the profile its login entitles it to.
   *
   * Signing IN: verified with Bloxity, then the account's profile is loaded -
   * or, on the account's first login, this session's guest progress becomes
   * the account's. Signing OUT, or a login Bloxity rejects: back to this
   * browser's guest profile. The profile being LEFT is saved first.
   */
  private async authenticate(client: Client, token: string, attempt = 0): Promise<void> {
    const sessionId = client.sessionId;
    const guestKey = this.guestKeys.get(sessionId) ?? '';
    this.switching.add(sessionId);
    try {
      let accountId: string | null = null;
      if (token) {
        const verdict = await bloxityAuth.verify(token);
        if (verdict.kind === 'verified') accountId = verdict.accountId;
        else if (verdict.kind === 'unavailable') {
          // Keep what they have and ask again later. Not a sign-out.
          this.scheduleReverify(client, token, attempt);
          return;
        }
      }

      const player = this.state.players.get(sessionId);
      if (!player) return;
      const currentAccount = this.accountIds.get(sessionId) ?? null;
      if (accountId === currentAccount) return; // nothing changed
      const currentKey = this.playerIds.get(sessionId) ?? '';

      // A guest's live state is the freshest copy of their progress, and it is
      // what a first login moves onto the account.
      const leavingGuest = !currentAccount && currentKey === guestKey;
      const resolution = await this.profiles.resolve(
        guestKey,
        accountId,
        leavingGuest && accountId ? player : undefined,
      );
      if (!this.state.players.has(sessionId)) return;

      // Save the profile being LEFT - unless it was just moved, in which case
      // the store already wrote it and marked it.
      if (currentKey && !resolution.migrated) this.profiles.save(currentKey, player);

      if (accountId) this.accountIds.set(sessionId, accountId);
      else this.accountIds.delete(sessionId);

      // The same order as a join: reset, restore, re-derive - then back to
      // spawn, because the run in progress belonged to the other profile.
      this.progression.initialise(player);
      this.trophies.initialise(player);
      this.speed.initialise(player);
      this.boots.initialise(player);
      this.treadmills.initialise(player);
      this.trails.initialise(player);
      this.auras.initialise(player);
      this.loadProgress(sessionId, player, resolution.key, resolution.profile);
      this.respawn(sessionId, player, 'manual');
      this.switching.delete(sessionId);
      // Written at once, so a crash straight after a sign-in cannot lose it.
      this.persist(sessionId, player);
      // Purchases waiting for the account just signed in to.
      if (accountId) void this.applyGrants(sessionId);
      logger.info(
        SCOPE,
        `${sessionId} is now ${accountId ? 'signed in' : 'a guest'} ` +
          `(${resolution.migrated ? 'migrated' : resolution.profile ? 'restored' : 'new'}) ` +
          `level=${player.level} rebirths=${player.rebirths} wins=${player.wins}`,
      );
    } catch (error: unknown) {
      // Storage failed mid-switch: stay exactly where they were, lose nothing.
      logger.error(SCOPE, `${sessionId}: could not switch profile; staying put`, error);
    } finally {
      this.switching.delete(sessionId);
      const next = this.queuedTokens.get(sessionId);
      if (next !== undefined && this.state.players.has(sessionId)) {
        this.queuedTokens.delete(sessionId);
        void this.authenticate(client, next);
      }
    }
  }

  /** Ask Bloxity about a login again, a little later. */
  private scheduleReverify(client: Client, token: string, attempt: number): void {
    const delay = REVERIFY_DELAYS_MS[attempt];
    if (delay === undefined) {
      logger.warn(SCOPE, `${client.sessionId}: Bloxity never answered; staying a guest`);
      return;
    }
    this.clock.setTimeout(() => {
      if (!this.state.players.has(client.sessionId)) return;
      // A newer login is being applied: that one wins.
      if (this.switching.has(client.sessionId)) return;
      void this.authenticate(client, token, attempt + 1);
    }, delay);
  }

  override onLeave(client: Client, consented: boolean): void {
    const leaving = this.state.players.get(client.sessionId);
    const playerId = this.playerIds.get(client.sessionId);
    if (leaving && playerId) {
      this.profiles.save(playerId, leaving);
    }
    this.playerIds.delete(client.sessionId);
    this.guestKeys.delete(client.sessionId);
    this.accountIds.delete(client.sessionId);
    this.switching.delete(client.sessionId);
    this.queuedTokens.delete(client.sessionId);
    this.granting.delete(client.sessionId);

    this.state.players.delete(client.sessionId);
    this.movement.forget(client.sessionId);
    this.trophies.forget(client.sessionId);
    this.speed.forget(client.sessionId);
    this.treadmills.forget(client.sessionId);
    this.boots.forget(client.sessionId);
    this.trails.forget(client.sessionId);
    this.auras.forget(client.sessionId);
    logger.info(
      SCOPE,
      `leave sessionId=${client.sessionId} consented=${consented} players=${this.state.players.size}`,
    );
  }

  override onDispose(): void {
    logger.info(SCOPE, `disposed roomId=${this.roomId}`);
  }

  /**
   * Hand over every Bux purchase waiting for this session's VERIFIED account.
   *
   * Claimed atomically (no other pod can take the same grant), credited onto
   * the live Wins with the uint32 guard, saved WITH the transaction ids in the
   * same write, and marked applied only once that write lands. Nothing a
   * browser supplied is involved - only the account Bloxity vouched for.
   */
  private async applyGrants(sessionId: string): Promise<void> {
    const accountId = this.accountIds.get(sessionId);
    if (!accountId || this.granting.has(sessionId) || this.switching.has(sessionId)) return;
    this.granting.add(sessionId);
    try {
      let grants: Awaited<ReturnType<typeof buxGrants.claim>>;
      try {
        grants = await buxGrants.claim(accountId);
      } catch (error: unknown) {
        logger.warn(SCOPE, `${sessionId}: could not claim purchases; will retry: ${String(error)}`);
        return;
      }
      if (grants.length === 0) return;

      const player = this.state.players.get(sessionId);
      const key = this.playerIds.get(sessionId);
      // Gone, switched account or mid-switch while claiming: not theirs to pay here.
      if (!player || !key || this.accountIds.get(sessionId) !== accountId || this.switching.has(sessionId)) {
        await buxGrants.release(grants);
        return;
      }

      let total = 0;
      for (const grant of grants) total += grant.wins;
      player.wins = creditWins(player.wins, total);
      this.profiles.save(
        key,
        player,
        grants.map((grant) => grant.transactionId),
      );
      buxGrants.confirm(key, grants);
      logger.info(
        SCOPE,
        `purchases applied sessionId=${sessionId} +${total} wins -> ${player.wins} ` +
          `[${grants.map((grant) => grant.transactionId).join(', ')}]`,
      );
    } finally {
      this.granting.delete(sessionId);
    }
  }

  /** Check every verified player here for purchases owed - one query per room. */
  private async pollGrants(): Promise<void> {
    const bySession = [...this.accountIds.entries()];
    if (bySession.length === 0) return;
    this.grantPolling = true;
    try {
      const owed = await buxGrants.owed(bySession.map(([, accountId]) => accountId));
      for (const [sessionId, accountId] of bySession) {
        if (owed.has(accountId)) void this.applyGrants(sessionId);
      }
    } catch (error: unknown) {
      logger.warn(SCOPE, `purchase poll failed; will retry: ${String(error)}`);
    } finally {
      this.grantPolling = false;
    }
  }

  /**
   * Milestone 1 accepts the client-reported transform and motion state after
   * shape validation. Movement is not yet server-simulated; that lands with
   * the gorge collision pass.
   *
   * The backflip COUNT is validated here rather than trusted, because how many
   * flips a player may perform is gameplay, and gameplay is server-owned.
   */
  /**
   * Consume one client INPUT and advance the authoritative simulation.
   *
   * The message carries no transform, so there is nothing here that lets a
   * client assert where it is. Position, velocity, rotation, grounded and
   * backflip state are all produced by `MovementService` from the shared
   * simulation and then replicated back.
   */
  /**
   * Consume one client INPUT and advance the authoritative simulation.
   *
   * The message carries no transform, so there is nothing here that lets a
   * client assert where it is. Position, velocity, rotation, grounded and
   * backflip state are all produced by `MovementService` from the shared
   * simulation and then replicated back.
   */
  private handleMove(client: Client, message: MoveMessage): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    if (!this.movement.applyInput(client.sessionId, player, message)) {
      const reason = this.movement.rejectReason;
      // Stale sequences are ordinary packet reordering, not abuse.
      if (reason && reason !== 'stale-seq') {
        logger.warn(
          SCOPE,
          `input rejected sessionId=${client.sessionId} reason=${reason}`,
        );
      }
      return;
    }

    player.animation = this.deriveAnimation(player);

    // Which treadmill is in force is decided from the position the server just
    // simulated and the rebirth count the server owns - the client says
    // nothing about either, so there is no treadmill claim to validate.
    const treadmill = this.treadmills.resolve(client.sessionId, player);
    if (treadmill.changed) {
      logger.info(
        SCOPE,
        treadmill.active > 0
          ? `treadmill on sessionId=${client.sessionId} tier=${treadmill.active} ` +
            `x${treadmill.multiplier} rebirths=${player.rebirths}`
          : `treadmill off sessionId=${client.sessionId}`,
      );
    }
    if (treadmill.locked && treadmill.changed) {
      logger.info(
        SCOPE,
        `treadmill locked sessionId=${client.sessionId} tier=${treadmill.standing} ` +
          `needs=${this.treadmills.requiredRebirth(treadmill.standing)} ` +
          `has=${player.rebirths}`,
      );
    }

    // Speed is credited from the movement the SERVER simulated, so a client
    // cannot farm by reporting distance it never travelled.
    const gain = this.speed.credit(client.sessionId, player, this.movement.lastStep);
    if (gain.levelsGained > 0) {
      this.movement.syncCapacity(client.sessionId, player);
      this.persist(client.sessionId, player);
      logger.info(
        SCOPE,
        `level up sessionId=${client.sessionId} level=${player.level} ` +
          `backflips=${gain.capacity} totalSpeed=${Math.floor(player.totalSpeed)}`,
      );
    }
  }

  /** Coarse visual state derived from the authoritative simulation. */
  private deriveAnimation(player: PlayerState): PlayerAnimationState {
    if (!player.grounded) {
      return player.verticalVelocity > 0
        ? PlayerAnimationState.JumpStart
        : PlayerAnimationState.Airborne;
    }
    if (player.speed < 0.35) return PlayerAnimationState.Idle;
    return player.speed >= 9 ? PlayerAnimationState.Run : PlayerAnimationState.Walk;
  }

  /**
   * A trophy claim is a REQUEST. TrophyService checks the platform, the run's
   * claim history and the player's reported position before awarding anything,
   * and the award is scoped to this session alone.
   */
  private handleClaimTrophy(client: Client, message: ClaimTrophyMessage): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const result = this.trophies.claim(client.sessionId, player, message?.platformIndex);

    if (!result.ok) {
      logger.warn(
        SCOPE,
        `claim rejected sessionId=${client.sessionId} index=${String(
          message?.platformIndex,
        )} reason=${result.reason}`,
      );
      return;
    }

    this.persist(client.sessionId, player);
    logger.info(
      SCOPE,
      `trophy awarded sessionId=${client.sessionId} base=+${result.base} ` +
        `paid=+${result.value} aura=${player.auraSlot} wins=${player.wins}`,
    );
    this.respawn(client.sessionId, player, 'trophy');
  }

  /**
   * A boot purchase is a REQUEST. BootService checks the slot, the player's
   * Wins and that they are standing at that pedestal before granting it.
   */
  private handleBuyBoot(client: Client, message: BuyBootMessage): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const result = this.boots.buy(player, message?.slot);
    if (!result.ok) {
      // 'already-owned' is the normal case for walking back over a pedestal.
      if (result.reason !== 'already-owned') {
        logger.warn(
          SCOPE,
          `boot purchase rejected sessionId=${client.sessionId} ` +
            `slot=${String(message?.slot)} reason=${result.reason}`,
        );
      }
      return;
    }

    // A better boot changes Speed per step immediately, not on the next input.
    this.speed.refreshRate(player);
    this.persist(client.sessionId, player);
    logger.info(
      SCOPE,
      `boot bought sessionId=${client.sessionId} slot=${result.tier.slot} ` +
        `"${result.tier.name}" +${result.tier.speedPerStep}/step ` +
        `spent=${result.spent} wins=${result.winsAfter}`,
    );
  }

  /**
   * Rebirth is entirely the server's decision: the client asks, and this
   * checks the level requirement before resetting anything.
   */
  private handleRebirth(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const before = { level: player.level, rebirths: player.rebirths };
    const result = this.rebirths.rebirth(player);

    if (!result.ok) {
      logger.warn(
        SCOPE,
        `rebirth rejected sessionId=${client.sessionId} level=${before.level}/` +
          `${player.maxLevel} reason=${result.reason}`,
      );
      return;
    }

    // The level curve restarted, so the movement baseline must too - and a
    // rebirth is exactly what unlocks the next treadmill.
    this.speed.reset(client.sessionId, player);
    // Re-resolves level, flip allowance, movement speed and the gain rate from
    // the reset curve - including the equipped trail.
    this.speed.applyRestoredProgress(player);
    this.treadmills.syncGate(player);
    this.persist(client.sessionId, player);

    logger.info(
      SCOPE,
      `rebirth sessionId=${client.sessionId} rebirths=${before.rebirths}->` +
        `${result.rebirths} maxLevel=${player.maxLevel} ` +
        `multiplier=x${result.multiplier.toFixed(2)} wins kept=${player.wins}`,
    );
  }

  /**
   * A cosmetic purchase is a REQUEST carrying only a slot number.
   *
   * `CosmeticService` checks the slot, whether it is already owned, the Wins
   * and a cooldown, then takes payment through the one wallet. Nothing in the
   * message names a price or a multiplier, so there is no figure to forge.
   */
  private handleBuyCosmetic(
    client: Client,
    shop: CosmeticService,
    slot: unknown,
  ): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const result = shop.buy(player, slot);
    if (!result.ok) {
      if (result.reason !== 'already-owned') {
        logger.warn(
          SCOPE,
          `${shop.label} purchase rejected sessionId=${client.sessionId} ` +
            `slot=${String(slot)} reason=${result.reason}`,
        );
      }
      return;
    }

    // A trail changes movement speed, so the replicated multiplier has to
    // follow immediately rather than on the next input.
    this.speed.applyRestoredProgress(player);
    this.persist(client.sessionId, player);
    logger.info(
      SCOPE,
      `${shop.label} bought sessionId=${client.sessionId} "${result.tier.name}" ` +
        `x${result.tier.multiplier} spent=${result.spent} wins=${result.winsAfter}`,
    );
  }

  /** Equipping is refused outright for anything the player does not own. */
  private handleEquipCosmetic(
    client: Client,
    shop: CosmeticService,
    slot: unknown,
  ): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const result = shop.equip(player, slot);
    if (!result.ok) {
      logger.warn(
        SCOPE,
        `${shop.label} equip rejected sessionId=${client.sessionId} ` +
          `slot=${String(slot)} reason=${result.reason}`,
      );
      return;
    }

    this.speed.applyRestoredProgress(player);
    this.persist(client.sessionId, player);
    logger.info(
      SCOPE,
      `${shop.label} equipped sessionId=${client.sessionId} ` +
        `slot=${result.slot} "${result.tier?.name ?? 'none'}"`,
    );
  }

  /** Capture earned progression so a reconnect restores it. */
  private persist(sessionId: string, player: PlayerState): void {
    // Mid-switch, the live state is about to belong to another profile.
    if (this.switching.has(sessionId)) return;
    const playerId = this.playerIds.get(sessionId);
    if (playerId) this.profiles.save(playerId, player);
  }

  /** A reported hazard only ever affects the player who reported it. */
  private handleHazardHit(client: Client, message: HazardHitMessage): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    if (message?.kind !== 'redline') return;
    this.respawn(client.sessionId, player, 'redline');
  }

  private update(deltaMs: number): void {
    this.state.elapsed += deltaMs / 1000;

    this.autosaveTimer += deltaMs / 1000;
    if (this.autosaveTimer >= AUTOSAVE_SECONDS) {
      this.autosaveTimer = 0;
      this.state.players.forEach((player, sessionId) => this.persist(sessionId, player));
    }

    this.grantPollTimer += deltaMs / 1000;
    if (
      !this.grantPolling &&
      (this.grantPollTimer >= GRANT_POLL_SECONDS || buxGrants.localVersion !== this.grantVersionSeen)
    ) {
      this.grantPollTimer = 0;
      this.grantVersionSeen = buxGrants.localVersion;
      void this.pollGrants();
    }

    this.leaderboardTimer += deltaMs / 1000;
    if (this.leaderboardTimer >= LEADERBOARD_SECONDS) {
      this.leaderboardTimer = 0;
      this.refreshLeaderboards();
    }

    // The blue gorge floor is a death zone: falling respawns at spawn.
    // The server owns this decision even while movement is client-reported.
    this.state.players.forEach((player, sessionId) => {
      if (player.y > DEATH_PLANE_Y) return;
      this.respawn(sessionId, player, 'fell');
    });
  }

  /**
   * Rebuild the three boards from the global profile store.
   *
   * Rows are only rewritten when they actually differ, so an unchanged board
   * produces no patch at all - which is what keeps a slow-moving scoreboard
   * off the wire entirely.
   */
  private refreshLeaderboards(): void {
    const ranked = this.leaderboards.build(this.profiles.all, this.liveProgression());
    let changed = false;
    changed = this.applyBoard(this.state.topRebirths, ranked.get('rebirths')) || changed;
    changed = this.applyBoard(this.state.topSpeed, ranked.get('totalSpeed')) || changed;
    changed = this.applyBoard(this.state.topWins, ranked.get('wins')) || changed;
    if (changed) this.state.leaderboardVersion += 1;
  }

  /**
   * What the players in this room have earned, right now.
   *
   * The store only holds what was last saved; these are the authoritative
   * figures the server is already maintaining this tick. Read-only - the
   * leaderboard observes progression and never writes it, so this yields the
   * state rather than saving it.
   */
  private *liveProgression(): Iterable<readonly [string, RankedSource]> {
    for (const [sessionId, playerId] of this.playerIds) {
      const player = this.state.players.get(sessionId);
      if (player) yield [playerId, player] as const;
    }
  }

  /** Copy ranked rows into a replicated array. @returns true if anything moved. */
  private applyBoard(
    target: ArraySchema<LeaderboardEntry>,
    rows: readonly { name: string; value: number; pfp: string }[] | undefined,
  ): boolean {
    const next = rows ?? [];
    let changed = target.length !== next.length;

    for (let i = 0; i < next.length; i += 1) {
      const row = next[i] as { name: string; value: number; pfp: string };
      const existing = target[i];
      if (!existing) {
        const entry = new LeaderboardEntry();
        entry.name = row.name;
        entry.value = row.value;
        entry.pfp = row.pfp;
        target.push(entry);
        changed = true;
        continue;
      }
      if (existing.name !== row.name) {
        existing.name = row.name;
        changed = true;
      }
      if (existing.value !== row.value) {
        existing.value = row.value;
        changed = true;
      }
      // Compared like the other two: a player who changes their avatar should
      // move the board's version, and one who does not must not.
      if (existing.pfp !== row.pfp) {
        existing.pfp = row.pfp;
        changed = true;
      }
    }

    while (target.length > next.length) {
      target.pop();
      changed = true;
    }
    return changed;
  }

  private respawn(sessionId: string, player: PlayerState, reason: RespawnReason): void {
    // The simulation owns the transform, so respawning means telling it to
    // move - not writing the replicated fields directly.
    this.movement.teleport(
      sessionId,
      player,
      SPAWN_POSITION.x,
      SPAWN_POSITION.y,
      SPAWN_POSITION.z,
      SPAWN_ROTATION_Y,
    );
    player.speed = 0;
    player.animation = PlayerAnimationState.Idle;
    // A new run: every platform becomes collectable again.
    this.trophies.resetRun(sessionId);
    // Drop the movement baseline so the teleport is not credited as travel,
    // and re-resolve the treadmill: spawn is not a deck.
    this.speed.reset(sessionId, player);
    this.treadmills.resolve(sessionId, player);

    const payload: RespawnMessage = {
      x: SPAWN_POSITION.x,
      y: SPAWN_POSITION.y,
      z: SPAWN_POSITION.z,
      rotationY: SPAWN_ROTATION_Y,
      reason,
    };

    const client = this.clients.find((c) => c.sessionId === sessionId);
    client?.send(MessageType.Respawn, payload);
    logger.info(SCOPE, `respawn sessionId=${sessionId} reason=${reason}`);
  }
}
