import type { RespawnReason } from '@obby/shared';
import type { LocalPlayer } from '../player/LocalPlayer.js';
import { logger } from '../util/logger.js';
import type { GorgeCollision } from '../world/GorgeCollision.js';

const SCOPE = 'RunController';

/**
 * Seconds after a respawn during which triggers are ignored.
 *
 * Without this, a single event fires on several consecutive frames (the player
 * stays inside the zone, or stays below the death plane, until the teleport
 * settles) and would respawn or claim repeatedly.
 */
const RESPAWN_GRACE = 0.4;

/** What the controller needs from the network layer. */
export interface RunNetwork {
  claimTrophy(platformIndex: number): void;
  reportHazard(): void;
}

/**
 * Drives one run: watches the world triggers under the local player and turns
 * them into server requests plus an immediate local respawn.
 *
 * Authority split: the client detects and PREDICTS the death so it feels
 * instant, but never awards anything. Wins come back from the server, which
 * validates the claim and issues its own authoritative respawn.
 *
 * Detecting a death and PLACING the player are deliberately separate. This
 * only starts the transition; `Game` performs the placement once it ends,
 * preferring the server's transform if it has arrived by then. Splitting them
 * is what leaves a window in which no stale state can be applied.
 */
export class RunController {
  private readonly collision: GorgeCollision;
  private readonly network: RunNetwork;

  /** Platforms already claimed this run - prevents re-sending on later frames. */
  private readonly claimed = new Set<number>();

  private graceTimer = 0;

  /**
   * How the most recent death began, set on the ONE call that starts it.
   * Read by `Game` for its once-per-death feedback.
   */
  private deathReason: RespawnReason | null = null;

  constructor(collision: GorgeCollision, network: RunNetwork) {
    this.collision = collision;
    this.network = network;
  }

  /**
   * The reason a death STARTED during the last `update`, or null.
   *
   * An edge: set only by the call that actually began the death (a player
   * already dying is ignored), and cleared at the start of every update - so
   * it is true for exactly one frame per death, whatever the server later
   * sends about the respawn.
   */
  get deathStartedThisFrame(): RespawnReason | null {
    return this.deathReason;
  }

  /** Evaluate triggers for this frame. Call after the player has moved. */
  update(delta: number, player: LocalPlayer): void {
    this.deathReason = null;
    if (this.graceTimer > 0) {
      this.graceTimer -= delta;
      return;
    }

    const triggers = this.collision.sampleTriggers(
      player.position.x,
      player.position.y,
      player.position.z,
    );

    // Order matters: a hazard or a fall ends the run before any reward.
    if (triggers.fell) {
      this.die(player, 'fell');
      return;
    }

    if (triggers.redline) {
      this.network.reportHazard();
      this.die(player, 'redline');
      return;
    }

    if (triggers.trophyIndex !== null && !this.claimed.has(triggers.trophyIndex)) {
      // Claim once per run; the server decides whether it is actually awarded.
      this.claimed.add(triggers.trophyIndex);
      this.network.claimTrophy(triggers.trophyIndex);
      this.die(player, 'trophy');
    }
  }

  /**
   * Begin a death. ONE path for all three endings.
   *
   * Banking a trophy is logically a reward rather than a death, but visually
   * it is the same beat - the run ends and the player is placed back at spawn
   * - so it reuses the same transition instead of growing a second one.
   *
   * The teleport is deliberately NOT done here. The player enters a local
   * death state immediately, which is what stops the old position being
   * rendered or advanced, and `Game` places them when the transition is done.
   */
  die(player: LocalPlayer, reason: RespawnReason): void {
    if (player.isDying) return;
    player.beginDeath();
    this.deathReason = reason;
    this.claimed.clear();
    this.graceTimer = RESPAWN_GRACE;
    logger.info(SCOPE, `death: ${reason}`);
  }

}
