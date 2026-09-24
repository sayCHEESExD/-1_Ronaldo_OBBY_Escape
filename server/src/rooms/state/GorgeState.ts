import { ArraySchema, MapSchema, Schema, type } from '@colyseus/schema';
import { PlayerState } from './PlayerState.js';

/**
 * One leaderboard row.
 *
 * Written ONLY by the server, from the same figures it grants progression
 * with. There is no message a client can send that reaches this.
 */
export class LeaderboardEntry extends Schema {
  /** The player's Bloxity display name - never an internal id. */
  @type('string') name = '';
  @type('float64') value = 0;
  /** Bloxity avatar URL, or empty when that player has none. */
  @type('string') pfp = '';
}

/** Root replicated state for a single gorge instance. */
export class GorgeState extends Schema {
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();

  /** Server uptime in seconds, useful for client-side clock sanity checks. */
  @type('float32') elapsed = 0;

  /**
   * Global rankings, at most nine rows each. Shorter when fewer players have
   * scored - the client pads the board out rather than the server sending
   * empty rows.
   */
  @type([LeaderboardEntry]) topRebirths = new ArraySchema<LeaderboardEntry>();
  @type([LeaderboardEntry]) topSpeed = new ArraySchema<LeaderboardEntry>();
  @type([LeaderboardEntry]) topWins = new ArraySchema<LeaderboardEntry>();

  /**
   * Bumped whenever the boards are rebuilt.
   *
   * The client redraws three canvases on a change, which is far too expensive
   * to do per patch. One integer compare tells it whether anything actually
   * moved.
   */
  @type('uint32') leaderboardVersion = 0;
}
