import type { PlayerAnimationState, PlayerMotionState } from '@obby/shared';
import type { ArraySchema, MapSchema } from '@colyseus/schema';

/**
 * Client-side TYPE mirror of the server's Colyseus schema.
 *
 * These are types only - colyseus.js builds the concrete schema instances at
 * runtime from the handshake reflection, so there is no duplicated schema
 * class to keep in sync, only this shape.
 */
export interface NetPlayerState extends PlayerMotionState {
  sessionId: string;
  /** Bloxity display name, for friend-join toasts. Cosmetic only. */
  legionName: string;
  /** Bloxity account id, for friend requests. Empty for a guest. Cosmetic only. */
  legionUserId: string;
  /** Bloxity avatar URL, shown beside the name. Empty when none. Cosmetic only. */
  legionPfp: string;
  /** Encoded Bloxity avatar look (`encodeAvatarLook`). Empty = Bloxity default. */
  legionAvatar?: string;
  x: number;
  y: number;
  z: number;
  rotationY: number;
  animation: PlayerAnimationState;
  /** Server-authoritative flips allowed per airborne window. */
  backflipCapacity: number;
  level: number;
  progression: number;
  rebirths: number;
  backflips: number;
  wins: number;
  totalSpeed: number;
  /** Equipped boot slot, chosen by the server from wins. */
  bootSlot: number;
  /** Bitmask of boots bought. */
  ownedBoots: number;
  /** Authoritative movement multiplier from the server. */
  moveMultiplier: number;
  /** Highest level reachable at the current rebirth. */
  maxLevel: number;
  /** Treadmill deck the server sees the player standing on, or 0. */
  treadmillStanding: number;
  /** Treadmill the server has the player running on - 0 when not on one. */
  treadmillTier: number;
  /** Highest tier the player's rebirth count allows. */
  maxTreadmillTier: number;
  /** Multiplier that treadmill grants. */
  treadmillMultiplier: number;
  /** Final Speed per step, after boots, rebirth and treadmill. */
  speedPerStep: number;
  /** Cosmetics, all server-owned. Trails multiply speed, auras multiply Wins. */
  ownedTrails: number;
  trailSlot: number;
  ownedAuras: number;
  auraSlot: number;
  /** Authoritative velocity, used to reconcile client prediction. */
  velocityX: number;
  velocityY: number;
  velocityZ: number;
  /** Highest input sequence the server has simulated. */
  lastInputSeq: number;
  /** Flips left in the current airborne window, owned by the server. */
  flipsRemaining: number;
  /** Latched jump edge, so replay resumes from the server's own edge state. */
  jumpLatched: boolean;
  /** Flips already taken this airtime, so a replayed flip lifts identically. */
  flipsThisAirtime: number;
  ready: boolean;
}

/** One replicated leaderboard row. Server-written; never sent by a client. */
export interface NetLeaderboardEntry {
  name: string;
  value: number;
  /** Bloxity avatar URL, or empty. */
  pfp: string;
}

export interface NetGorgeState {
  players: MapSchema<NetPlayerState>;
  elapsed: number;
  /** Global rankings, at most nine rows each. */
  topRebirths: ArraySchema<NetLeaderboardEntry>;
  topSpeed: ArraySchema<NetLeaderboardEntry>;
  topWins: ArraySchema<NetLeaderboardEntry>;
  /** Bumped by the server whenever a board actually changes. */
  leaderboardVersion: number;
}

/** Connection lifecycle, surfaced to the UI. */
export type ConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'error';
