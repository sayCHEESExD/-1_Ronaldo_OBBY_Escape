import {
  BACKFLIP,
  MAX_SIM_DELTA,
  SPEED,
  backflipCapacityForLevel,
  maxLevelForRebirth,
  resolveLevel,
  resolveProgressionRate,
  resolveMovementProfile,
  speedForNextLevel,
  trailMultiplier,
  type MovementProfile,
} from '@obby/shared';
import type { PlayerState } from '../rooms/state/PlayerState.js';

/** What the server remembers between two movement reports from one player. */
interface Tracker {
  x: number;
  z: number;
  grounded: boolean;
  /** True until the first report arrives, so spawning credits nothing. */
  fresh: boolean;
}

/** Outcome of crediting one movement report. */
export interface SpeedGain {
  /** Speed added by this report. */
  readonly gained: number;
  /** Levels crossed, if any. */
  readonly levelsGained: number;
  /** Backflips the player may now perform per airborne window. */
  readonly capacity: number;
}

/**
 * Server authority over Speed farming and levelling.
 *
 * Speed is derived from movement the server actually OBSERVES: the distance
 * between consecutive reported positions, plus a bonus each time the player
 * leaves the ground. A client cannot ask for Speed, and a single report is
 * capped at a plausible step, so teleporting pays nothing.
 *
 * Level then drives backflip capacity one-for-one: level 15 means fifteen
 * flips before touching down. That is the whole progression loop - farm Speed
 * by moving, gain levels, gain air, reach islands that were out of range.
 */
export class SpeedService {
  private readonly trackers = new Map<string, Tracker>();

  initialise(player: PlayerState): void {
    player.level = 1;
    player.backflipCapacity = BACKFLIP.defaultCapacity;
    player.maxLevel = this.levelCap(player);
    player.moveMultiplier = this.movementProfile(player).multiplier;
    this.syncRate(player);
    this.reset(player.sessionId, player);
  }

  forget(sessionId: string): void {
    this.trackers.delete(sessionId);
  }

  /**
   * Drop the movement baseline.
   *
   * Called on every respawn: the teleport back to spawn is a huge position
   * delta that must never be credited as distance travelled.
   */
  reset(sessionId: string, player: PlayerState): void {
    this.trackers.set(sessionId, {
      x: player.x,
      z: player.z,
      grounded: true,
      fresh: true,
    });
  }

  /**
   * Credit one movement report and apply any level-ups.
   *
   * Call AFTER the player's transform has been updated, so the tracker
   * advances to the position just accepted.
   */
  credit(sessionId: string, player: PlayerState, stepSeconds = 0): SpeedGain {
    const tracker = this.trackers.get(sessionId);
    if (!tracker) {
      this.reset(sessionId, player);
      return { gained: 0, levelsGained: 0, capacity: player.backflipCapacity };
    }

    // ONE rate, resolved by the shared formula from every modifier at once:
    // the equipped boot, the rebirth multiplier and the treadmill currently in
    // force. Nothing here recomputes any of them. `treadmillTier` was already
    // validated against the server's own position and rebirth count.
    const rate = resolveProgressionRate({
      ownedBoots: player.ownedBoots,
      rebirths: player.rebirths,
      treadmillTier: player.treadmillTier,
    });
    player.speedPerStep = rate.perStep;

    let gained = 0;

    if (!tracker.fresh) {
      if (player.treadmillTier > 0) {
        // Running on the spot. There is no position delta to measure, so the
        // BELT supplies the distance: the player covers ground at their own
        // authoritative run speed without going anywhere. It then flows
        // through the identical per-step formula, which is why a treadmill
        // needs no progression path of its own.
        //
        // Paid per simulated second of the SERVER's own step, so a client
        // cannot buy progression by claiming a longer frame.
        const step = Number.isFinite(stepSeconds)
          ? Math.max(0, Math.min(stepSeconds, MAX_SIM_DELTA))
          : 0;
        const distance = this.movementProfile(player).runSpeed * step;
        gained += (distance / SPEED.strideDistance) * rate.perStep;
      } else {
        const distance = Math.hypot(player.x - tracker.x, player.z - tracker.z);

        // Validation uses the SAME speed the player actually moves at, so a
        // fast high-level player is not throttled by a cap tuned for a slow
        // one.
        if (distance <= this.maxCreditedStep(player)) {
          gained += (distance / SPEED.strideDistance) * rate.perStep;
        }
        // Leaving the ground pays a flat bonus too, scaled by the same rate so
        // every modifier improves both ways of farming by the same factor.
        if (tracker.grounded && !player.grounded) {
          gained += SPEED.jumpBonus * (rate.perStep / SPEED.perStep);
        }
      }
    }

    tracker.x = player.x;
    tracker.z = player.z;
    tracker.grounded = player.grounded;
    tracker.fresh = false;

    const beforeLevel = player.level;
    if (gained > 0) player.totalSpeed += gained;

    const progress = resolveLevel(player.totalSpeed, this.levelCap(player));
    player.level = progress.level;
    player.backflipCapacity = backflipCapacityForLevel(progress.level);
    // Movement speed follows level and rebirth through the one shared formula.
    player.maxLevel = this.levelCap(player);
    player.moveMultiplier = this.movementProfile(player).multiplier;

    return {
      gained,
      levelsGained: player.level - beforeLevel,
      capacity: player.backflipCapacity,
    };
  }

  /**
   * Re-derive level and everything downstream from a restored Speed total.
   *
   * Used on reconnect: the profile carries only the Speed earned, and level,
   * backflips and movement speed all follow from it through the same formulas
   * a live session uses.
   */
  applyRestoredProgress(player: PlayerState): void {
    const progress = resolveLevel(player.totalSpeed, this.levelCap(player));
    player.level = progress.level;
    player.backflipCapacity = backflipCapacityForLevel(progress.level);
    player.maxLevel = this.levelCap(player);
    player.moveMultiplier = this.movementProfile(player).multiplier;
    this.syncRate(player);
  }

  /**
   * Refresh the replicated Speed-per-step from the shared gain formula.
   *
   * Used wherever a modifier changes outside a movement report - joining,
   * restoring a profile, buying a boot, rebirthing - so the HUD never shows a
   * rate one step out of date.
   */
  refreshRate(player: PlayerState): void {
    this.syncRate(player);
  }

  private syncRate(player: PlayerState): void {
    player.speedPerStep = resolveProgressionRate({
      ownedBoots: player.ownedBoots,
      rebirths: player.rebirths,
      treadmillTier: player.treadmillTier,
    }).perStep;
  }

  /**
   * THE player's movement profile.
   *
   * Level and rebirth drive it; the equipped TRAIL multiplies in through the
   * shared formula's `extraMultiplier` hook, never through a second
   * calculation. Every caller that needs a speed - the replicated multiplier,
   * the anti-teleport step cap, the treadmill's belt distance - goes through
   * here, so what the player moves at and what the server will credit cannot
   * disagree.
   *
   * Trails deliberately do NOT touch Speed per step: that axis belongs to
   * boots and treadmills, and auras own trophy rewards.
   */
  movementProfile(player: PlayerState): MovementProfile {
    return resolveMovementProfile(
      player.level,
      player.rebirths,
      trailMultiplier(player.trailSlot, player.ownedTrails),
    );
  }

  /** Speed still needed for the next level, for logging and diagnostics. */
  speedToNextLevel(player: PlayerState): number {
    return speedForNextLevel(player.level);
  }

  /**
   * Largest movement the server will credit from one report.
   *
   * Derived from the player's OWN authoritative run speed rather than a fixed
   * constant, so movement validation and movement itself can never disagree.
   */
  private maxCreditedStep(player: PlayerState): number {
    return Math.max(SPEED.maxCreditedStep, this.movementProfile(player).runSpeed * 0.3);
  }

  /** The rebirth-aware level ceiling. */
  private levelCap(player: PlayerState): number {
    return maxLevelForRebirth(player.rebirths);
  }
}
