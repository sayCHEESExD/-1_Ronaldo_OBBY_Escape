/**
 * Speed farming and the level curve.
 *
 * "Speed" is the game's progression currency. Players farm it by moving -
 * every step taken and every jump adds to a lifetime total, and crossing each
 * level threshold grants one more backflip. Since flips are what let a player
 * cross the widening gaps, levelling is what physically opens up the route.
 *
 * Speed is granted by the SERVER from the movement it observes. The client
 * only ever displays the replicated total; it never awards its own progress.
 */
export interface SpeedConfig {
  /** Speed granted per step taken. */
  readonly perStep: number;
  /** World units of travel that count as one step. */
  readonly strideDistance: number;
  /** Flat speed granted each time the player leaves the ground. */
  readonly jumpBonus: number;
  /**
   * Largest distance the server will credit from a single movement report.
   *
   * Reports arrive about 20 times a second and sprinting covers ~0.75 units in
   * that time, so this is generous headroom for jitter while still refusing to
   * pay out for a teleport.
   */
  readonly maxCreditedStep: number;
  /** Speed needed to go from level 1 to level 2. */
  readonly baseRequirement: number;
  /** Each level costs this much more than the one before. */
  readonly growth: number;
}

export const SPEED: SpeedConfig = {
  perStep: 1,
  strideDistance: 2,
  jumpBonus: 3,
  maxCreditedStep: 3,
  baseRequirement: 10,
  growth: 1.5,
};

/** Speed needed to advance FROM `level` to the next one. */
export const speedForNextLevel = (level: number): number => {
  const step = Math.max(1, Math.floor(level));
  return Math.round(SPEED.baseRequirement * SPEED.growth ** (step - 1));
};

/** Cumulative speed needed to have REACHED `level`. Level 1 costs nothing. */
export const totalSpeedToReach = (level: number): number => {
  let total = 0;
  for (let i = 1; i < level; i += 1) total += speedForNextLevel(i);
  return total;
};

/** Where a lifetime speed total sits on the level curve. */
export interface LevelProgress {
  /** Current level. Everyone starts at 1. */
  readonly level: number;
  /** Speed earned toward the next level. */
  readonly into: number;
  /** Speed needed for the next level. */
  readonly required: number;
  /** 0..1 fill for the level bar. */
  readonly fraction: number;
  /** True when the level cap has been reached and the bar is full. */
  readonly capped: boolean;
}

/**
 * Resolve a lifetime speed total into a level and bar position.
 *
 * @param totalSpeed lifetime speed farmed
 * @param levelCap   highest reachable level; rebirth raises this later
 */
export const resolveLevel = (totalSpeed: number, levelCap: number): LevelProgress => {
  const cap = Math.max(1, Math.floor(levelCap));
  const total = Number.isFinite(totalSpeed) ? Math.max(0, totalSpeed) : 0;

  let level = 1;
  let consumed = 0;

  while (level < cap) {
    const next = speedForNextLevel(level);
    if (total - consumed < next) break;
    consumed += next;
    level += 1;
  }

  if (level >= cap) {
    const required = speedForNextLevel(cap);
    return { level: cap, into: required, required, fraction: 1, capped: true };
  }

  const required = speedForNextLevel(level);
  const into = total - consumed;
  return {
    level,
    into,
    required,
    fraction: required > 0 ? Math.min(into / required, 1) : 0,
    capped: false,
  };
};

/**
 * Compact display form used by the HUD: 940, 12.4k, 3.1M.
 * Lives in shared so the server can log the same values the player sees.
 */
export const formatSpeed = (value: number): string => {
  const amount = Number.isFinite(value) ? Math.max(0, value) : 0;
  if (amount >= 1_000_000_000) return `${(amount / 1_000_000_000).toFixed(1)}B`;
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(1)}k`;
  return Math.floor(amount).toString();
};
