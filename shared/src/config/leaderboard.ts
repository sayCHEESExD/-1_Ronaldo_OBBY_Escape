/**
 * The three spawn leaderboards: what they rank, and where they hang.
 *
 * Pure data, like the rest of the world layout. The server reads the METRIC to
 * decide an order and the client reads the placement and colours to draw the
 * board, so neither can drift from the other about which board is which.
 *
 * Rankings are server-authoritative and global - see `LeaderboardService`. A
 * client never submits a score; it only renders what it is told.
 */

/** Rows on every board. The reference shows exactly nine. */
export const LEADERBOARD_SIZE = 9;

/** Which stored figure a board ranks by. */
export type LeaderboardMetric = 'rebirths' | 'totalSpeed' | 'wins';

export interface LeaderboardBoard {
  readonly metric: LeaderboardMetric;
  /** Heading across the top of the board. */
  readonly title: string;
  /** Word after each value, as in "140 Rebirths". */
  readonly unit: string;
  /** Frame and title colour. */
  readonly accent: number;
  /** Panel behind the rows. */
  readonly panel: number;
  /** Pill behind each value. */
  readonly pill: number;
  /** Z of the board's centre along the left wall. */
  readonly centerZ: number;
}

/**
 * Board size in world units.
 *
 * Bounded by the spawn wall: it stands 8 high from the platform top, so a
 * board any taller would poke over the coping.
 */
export const LEADERBOARD_PANEL = {
  width: 7,
  height: 7.2,
  /** Centre height above the platform. */
  centerY: 4.3,
  /** Gap between neighbouring boards. */
  gapZ: 1.5,
  /**
   * How far the board stands off the wall's inner face.
   *
   * Enough to clear the coping that oversails the wall, and to read as mounted
   * ON it rather than embedded in it.
   */
  standoff: 0.3,
} as const;

/**
 * The three boards, ordered along the wall.
 *
 * Placed on the LEFT wall (+X) between the treadmill bay behind them and the
 * gorge mouth in front, so they obstruct neither. Colours follow the reference:
 * magenta for rebirths, blue for speed, orange for wins.
 */
export const LEADERBOARD_BOARDS: readonly LeaderboardBoard[] = [
  {
    metric: 'rebirths',
    title: 'Most Rebirth',
    unit: 'Rebirths',
    accent: 0xd94ee0,
    panel: 0x8e2ea0,
    pill: 0xb43ec4,
    centerZ: -6.5,
  },
  {
    metric: 'totalSpeed',
    title: 'Most Speed',
    unit: 'Speed',
    accent: 0x2f8fe8,
    panel: 0x1d5fa8,
    pill: 0x2775c8,
    centerZ: 2,
  },
  {
    metric: 'wins',
    title: 'Most Wins',
    unit: 'Wins',
    accent: 0xf59220,
    panel: 0xb85f10,
    pill: 0xd97a16,
    centerZ: 10.5,
  },
];

/*
 * There is deliberately NO name-from-id helper here any more.
 *
 * This file used to export `leaderboardName`, which derived a label from the
 * internal browser id - "p_l4kqvrex..." became "Lbnewcome". That put an
 * internal identifier on a public scoreboard, so it is gone rather than left
 * available: players are named by their Bloxity display name, which every
 * player has, because the portal names guests too. See `LeaderboardService`.
 */
