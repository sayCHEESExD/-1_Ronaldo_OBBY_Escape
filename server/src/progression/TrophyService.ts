import {
  COLLECTION_ZONE,
  MAX_WINS,
  collectionZoneX,
  collectionZoneZ,
  PLATFORM,
  platformByIndex,
  resolveTrophyReward,
} from '@obby/shared';
import type { PlayerState } from '../rooms/state/PlayerState.js';

/** Generous tolerance on the zone check - the client reports at 20Hz. */
const POSITION_TOLERANCE = 3;

/**
 * Minimum time between two successful claims from one player.
 *
 * A successful claim ends the run and respawns the player, which clears the
 * claim history so the next run can collect again. Without a cooldown, two
 * claim messages arriving back to back would both be honoured - the first
 * awards and resets, the second sees a clean history. This is the guard that
 * makes one physical collection award exactly once.
 */
const CLAIM_COOLDOWN_MS = 750;

/** Outcome of a claim attempt. */
export type ClaimResult =
  | { readonly ok: true; readonly value: number; readonly base: number }
  | {
      readonly ok: false;
      readonly reason: 'unknown-platform' | 'already-claimed' | 'too-far' | 'cooldown';
    };

/**
 * Server authority over trophy rewards.
 *
 * The client detects that it walked into a collection zone and asks; this
 * decides. A claim is only honoured when the platform exists, has not already
 * been collected in the current run, and the player's last reported position
 * actually falls inside that platform's zone.
 *
 * Claims are tracked per session, so one player's collection can never affect
 * another's.
 */
export class TrophyService {
  /** Platform indices already collected in the current run, per session. */
  private readonly claimed = new Map<string, Set<number>>();
  /** Timestamp of each session's last successful claim. */
  private readonly lastClaimAt = new Map<string, number>();

  initialise(player: PlayerState): void {
    player.wins = 0;
    this.claimed.set(player.sessionId, new Set());
    this.lastClaimAt.delete(player.sessionId);
  }

  forget(sessionId: string): void {
    this.claimed.delete(sessionId);
    this.lastClaimAt.delete(sessionId);
  }

  /** Clear the run's claim history. Called on every respawn. */
  resetRun(sessionId: string): void {
    this.claimed.get(sessionId)?.clear();
  }

  /**
   * Validate and, if valid, award a claim.
   *
   * Mutates `player.wins` only on success - this is the single place trophy
   * rewards are granted anywhere in the codebase.
   */
  claim(sessionId: string, player: PlayerState, platformIndex: unknown): ClaimResult {
    if (typeof platformIndex !== 'number' || !Number.isInteger(platformIndex)) {
      return { ok: false, reason: 'unknown-platform' };
    }

    const platform = platformByIndex(platformIndex);
    if (!platform) return { ok: false, reason: 'unknown-platform' };

    const now = Date.now();
    const previous = this.lastClaimAt.get(sessionId);
    if (previous !== undefined && now - previous < CLAIM_COOLDOWN_MS) {
      return { ok: false, reason: 'cooldown' };
    }

    let claimedByPlayer = this.claimed.get(sessionId);
    if (!claimedByPlayer) {
      claimedByPlayer = new Set();
      this.claimed.set(sessionId, claimedByPlayer);
    }
    if (claimedByPlayer.has(platformIndex)) {
      return { ok: false, reason: 'already-claimed' };
    }

    if (!this.isInsideZone(player, platform.centerZ)) {
      return { ok: false, reason: 'too-far' };
    }

    claimedByPlayer.add(platformIndex);
    this.lastClaimAt.set(sessionId, now);

    // The aura multiplies the payout - and only here, AFTER every check above
    // has passed. `resolveTrophyReward` returns the base value for an aura the
    // player does not own, so a forged slot pays exactly nothing extra.
    const reward = resolveTrophyReward(platform.value, player.auraSlot, player.ownedAuras);
    // Saturate at the wallet's ceiling. `wins` is replicated as a uint32, and
    // the far islands pay enough that a full wallet plus one more collection
    // would WRAP - which the player would read as their Wins being wiped. The
    // value reported back is what was actually credited, so the HUD popup and
    // the wallet can never disagree.
    const before = player.wins;
    player.wins = Math.min(before + reward, MAX_WINS);
    const value = player.wins - before;
    return { ok: true, value, base: platform.value };
  }

  /** Does the player's last reported transform sit in this platform's zone? */
  private isInsideZone(player: PlayerState, centerZ: number): boolean {
    const withinX =
      Math.abs(player.x - collectionZoneX()) <=
      COLLECTION_ZONE.width / 2 + POSITION_TOLERANCE;
    const withinZ =
      Math.abs(player.z - collectionZoneZ(centerZ)) <=
      COLLECTION_ZONE.depth / 2 + POSITION_TOLERANCE;
    const withinY =
      player.y >= PLATFORM.topY - POSITION_TOLERANCE &&
      player.y <= PLATFORM.topY + COLLECTION_ZONE.height + POSITION_TOLERANCE;
    return withinX && withinZ && withinY;
  }
}
