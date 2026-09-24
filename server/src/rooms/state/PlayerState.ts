import { Schema, type } from '@colyseus/schema';
import {
  BACKFLIP,
  PlayerAnimationState,
  SPAWN_POSITION,
  SPAWN_ROTATION_Y,
  type PlayerAnimationState as AnimationState,
} from '@obby/shared';

/**
 * Replicated per-player state.
 *
 * Transform and motion fields are client-reported for now (see GorgeRoom).
 * Progression and the backflip allowance are written ONLY by the server and
 * are never accepted from a client.
 *
 * Note what is NOT here: bone rotations, pose data, animation timers. Clients
 * reconstruct the full animation from the compact motion fields below.
 */
export class PlayerState extends Schema {
  @type('string') sessionId = '';

  /**
   * The player's Bloxity display name, for friend-join toasts.
   *
   * Client-supplied and PURELY COSMETIC - it names a player on another
   * player's screen and nothing else. Progression, rewards and position stay
   * exactly as server-owned as they were; nothing reads this to decide
   * anything.
   */
  @type('string') legionName = '';

  /**
   * The player's Bloxity account id, so another player can send them a friend
   * request. Empty for a guest, who has no account to befriend.
   *
   * Client-supplied and cosmetic for the same reason as `legionName`: it
   * identifies who to befriend and nothing else. A forged id could at worst
   * aim a friend request at the wrong account, which that account's owner can
   * simply decline - it grants nothing in this game.
   */
  @type('string') legionUserId = '';

  /**
   * The player's Bloxity avatar URL, drawn beside their name on the boards.
   *
   * Client-supplied and cosmetic like the other two, but with a sharper edge:
   * every OTHER player's browser fetches this URL, so the room only accepts
   * one on Bloxity's own hosts - see `cleanLegionPfp`.
   */
  @type('string') legionPfp = '';

  /**
   * The player's Bloxity avatar look - skin, hat, back and proportions - as
   * one encoded string (`shared/config/avatarLook.ts`).
   *
   * Client-supplied and COSMETIC: it dresses this character on everyone
   * else's screen and nothing more. The room only re-encodes it through the
   * shared parser, which drops unknown ids and clamps every proportion.
   * Empty means Bloxity's default avatar.
   */
  @type('string') legionAvatar = '';

  @type('float32') x: number = SPAWN_POSITION.x;
  @type('float32') y: number = SPAWN_POSITION.y;
  @type('float32') z: number = SPAWN_POSITION.z;
  @type('float32') rotationY: number = SPAWN_ROTATION_Y;

  /** Horizontal speed, drives remote walk/run blending. */
  @type('float32') speed = 0;
  /** Vertical velocity, distinguishes the rising and falling poses. */
  @type('float32') verticalVelocity = 0;
  @type('boolean') grounded = true;

  /** Authoritative velocity, needed by the client to reconcile prediction. */
  @type('float32') velocityX = 0;
  @type('float32') velocityY = 0;
  @type('float32') velocityZ = 0;
  /** Highest input sequence the server has simulated for this player. */
  @type('uint32') lastInputSeq = 0;
  /** Flips left in the current airborne window, owned by the simulation. */
  @type('uint8') flipsRemaining = 1;

  /**
   * LATCHED simulation state, replicated so client reconciliation can restore
   * the FULL authoritative motion before it replays unacknowledged input.
   *
   * Neither is a transform and neither is ever read back from a client. They
   * are here because replay is only correct when it resumes from exactly the
   * state the server was in: `jumpLatched` decides whether the next input
   * counts as a fresh press, and `flipsThisAirtime` sets how hard the next
   * flip lifts. Restoring position and velocity but not these made replay
   * re-derive different jump and flip EDGES than the server took, which is
   * what made the allowance flicker and the arc jump under latency.
   */
  @type('boolean') jumpLatched = false;
  @type('uint8') flipsThisAirtime = 0;

  /**
   * Monotonic count of flips this player has STARTED. Remote clients replay a
   * flip whenever it increases - one integer instead of a rotation stream.
   */
  @type('uint32') flipCount = 0;

  /** Server-authoritative: flips allowed per airborne window. */
  @type('uint16') backflipCapacity: number = BACKFLIP.defaultCapacity;

  @type('string') animation: AnimationState = PlayerAnimationState.Idle;

  /** Server-authoritative progression. Not driven by gameplay yet. */
  @type('uint32') level = 1;
  @type('float32') progression = 0;
  /**
   * Rebirths performed. `uint32`, not `uint16`.
   *
   * The ladder has no end - each rebirth raises the level cap by ten - so the
   * only thing that could ever stop it is the field it travels in. At
   * `uint16` that was a real wall: rebirth 65536 wrapped to zero and took the
   * player's cap back to ten with it.
   */
  @type('uint32') rebirths = 0;
  @type('uint32') backflips = 0;
  /** Trophy wins. Awarded by TrophyService only - never read from a client. */
  @type('uint32') wins = 0;
  /** Lifetime farmed Speed. Awarded by SpeedService only. Drives level. */
  @type('float64') totalSpeed = 0;
  /** Equipped boot slot - the best one owned. Never client-set. */
  @type('uint8') bootSlot = 1;
  /** Bitmask of boots bought. Written by BootService only. */
  @type('uint16') ownedBoots = 1;
  /**
   * Authoritative movement multiplier, resolved from level + rebirth by the
   * one shared formula. The client moves at exactly this - it never derives
   * its own speed.
   */
  @type('float32') moveMultiplier = 1;
  /** Highest level reachable at the current rebirth. */
  /**
   * Level cap for the current rebirth. `uint32`, for the same reason as
   * `rebirths`: at `uint16` the cap wrapped at rebirth 6553 and collapsed.
   */
  @type('uint32') maxLevel = 10;

  /**
   * Treadmill the player is physically standing on, or 0.
   *
   * Derived by the server from the position it simulated - never reported by
   * the client. Replicated separately from `treadmillTier` so the HUD can tell
   * "standing on a locked deck" apart from "not on a deck".
   */
  @type('uint8') treadmillStanding = 0;
  /** Treadmill actually in use: 0 unless RUNNING on an unlocked deck. */
  @type('uint8') treadmillTier = 0;
  /**
   * Highest tier this player may use, from their rebirth count.
   *
   * Replicated so client prediction gates entry exactly as the server does.
   * The server never trusts it back - it resolves it from its own rebirths.
   */
  @type('uint8') maxTreadmillTier = 1;
  /** Multiplier that tier grants. 1 whenever no treadmill is in use. */
  @type('float32') treadmillMultiplier = 1;
  /** Final Speed granted per step, from the one shared gain formula. */
  @type('float32') speedPerStep = 1;

  /**
   * Cosmetics. Written ONLY by CosmeticService; a client sends a slot number
   * to buy or equip and never a cost or a multiplier, so there is no figure in
   * a message to forge.
   *
   * Trails multiply actual MOVEMENT SPEED; auras multiply TROPHY REWARDS. The
   * two never cross - see the shared configs for where each is applied.
   */
  @type('uint16') ownedTrails = 0;
  @type('uint8') trailSlot = 0;
  @type('uint16') ownedAuras = 0;
  @type('uint8') auraSlot = 0;

  /** True once the client has reported at least one transform. */
  @type('boolean') ready = false;
}
