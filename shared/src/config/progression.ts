/**
 * Progression tuning. Progression, rewards and level are SERVER-AUTHORITATIVE;
 * the client may predict for UI feel but never decides these values.
 *
 * Only the shape and baseline numbers exist at this milestone - the systems
 * that consume them (boots, rebirth, treadmills, trophies) are not built yet.
 */
export interface ProgressionConfig {
  /** Progression points granted per step taken, before multipliers. */
  readonly baseProgressionPerStep: number;
  /** Level cap at rebirth 0. */
  readonly baseLevelCap: number;
  /** Extra level cap granted per rebirth. */
  readonly levelCapPerRebirth: number;
  /** Progression multiplier added per rebirth (1.0 = +100%). */
  readonly progressionMultiplierPerRebirth: number;
  /** Backflips granted each time the player levels up. */
  readonly backflipsPerLevel: number;
  /** Progression points per second while parked on a treadmill (AFK gain). */
  readonly treadmillProgressionPerSecond: number;
}

/**
 * The largest Wins total that can be replicated.
 *
 * `PlayerState.wins` is a `uint32`, so anything past this WRAPS - a player
 * would bank a huge reward and find their wallet had reset. Every path that
 * adds Wins clamps to it instead, which saturates rather than corrupts.
 *
 * It is also the real ceiling on what any shop item may cost: a price above it
 * could never be afforded, because the wallet cannot hold that much.
 */
export const MAX_WINS = 4294967295;

export const PROGRESSION: ProgressionConfig = {
  baseProgressionPerStep: 1,
  baseLevelCap: 25,
  levelCapPerRebirth: 25,
  progressionMultiplierPerRebirth: 1,
  backflipsPerLevel: 1,
  treadmillProgressionPerSecond: 0.5,
};

// Boots live in `config/boots.ts` - they set Speed per step outright rather
// than multiplying a separate progression stat.
