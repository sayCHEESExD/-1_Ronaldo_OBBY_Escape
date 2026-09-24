/**
 * Network-level constants. Must stay identical on client and server.
 */

/** Colyseus room registered by the server and joined by the client. */
export const ROOM_NAME = 'gorge';

/** Default server port. Override with the PORT env var on the server. */
export const DEFAULT_SERVER_PORT = 2567;

/** Server simulation / state broadcast rate, in Hz. */
export const SERVER_TICK_RATE = 20;

/** Milliseconds between server ticks. */
export const SERVER_TICK_MS = 1000 / SERVER_TICK_RATE;

/** How often the client pushes its input/transform to the server, in Hz. */
export const CLIENT_SEND_RATE = 20;

/** Milliseconds between client transform sends. */
export const CLIENT_SEND_MS = 1000 / CLIENT_SEND_RATE;

/**
 * Client->server and server->client message identifiers.
 * Kept as a const object (not an enum) so it survives `verbatimModuleSyntax`
 * and erases cleanly in both build pipelines.
 */
export const MessageType = {
  /** Client -> server: local player transform update. */
  Move: 'move',
  /** Server -> client: authoritative respawn instruction. */
  Respawn: 'respawn',
  /** Client -> server: request to collect a trophy platform's reward. */
  ClaimTrophy: 'claimTrophy',
  /** Client -> server: report touching a hazard. */
  HazardHit: 'hazardHit',
  /**
   * Client -> server: "put me back at spawn".
   *
   * A REQUEST with no payload, like every other client message here. The
   * server decides where a respawn lands and replies with the authoritative
   * `Respawn`, so this can no more move a player than a trophy claim can pay
   * one. It exists because the portal's pause menu offers a respawn button,
   * and reusing `HazardHit` for it would mean reporting a hazard that was
   * never touched.
   */
  RequestRespawn: 'requestRespawn',
  /**
   * Client -> server: "this is who I am now" - Bloxity display name and
   * account id.
   *
   * COSMETIC ONLY, exactly like the same two fields sent with the join. It
   * exists because a guest who logs in after joining would otherwise stay
   * known to everyone else by their guest name, with no account to befriend.
   * Nothing gameplay reads either field.
   */
  UpdateIdentity: 'updateIdentity',
  /**
   * Client -> server: the player's Bloxity avatar look changed. Cosmetic, like
   * the identity - see `shared/config/avatarLook.ts`.
   */
  UpdateAvatar: 'updateAvatar',
  /**
   * Client -> server: the player's Bloxity LOGIN changed - signed in, signed
   * out or a different account. Carries the portal's login token, never an
   * account id; the server verifies it with Bloxity and moves the session
   * onto the profile that account owns.
   */
  Authenticate: 'authenticate',
  /** Client -> server: request to buy the boot the player is standing on. */
  BuyBoot: 'buyBoot',
  /** Client -> server: request a rebirth. */
  Rebirth: 'rebirth',
  /** Client -> server: buy / equip a trail. */
  BuyTrail: 'buyTrail',
  EquipTrail: 'equipTrail',
  /** Client -> server: buy / equip an aura. */
  BuyAura: 'buyAura',
  EquipAura: 'equipAura',
} as const;

export type MessageType = (typeof MessageType)[keyof typeof MessageType];
