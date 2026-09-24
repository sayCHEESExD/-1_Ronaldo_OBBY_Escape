import { maxLevelForRebirth, rebirthMultiplier } from '@obby/shared';
import type { PlayerState } from '../rooms/state/PlayerState.js';

/**
 * Server-authoritative progression. The client never computes or claims these
 * values - it only renders what the server replicates.
 *
 * Only initialisation exists at this milestone. Steps, boots, trophies,
 * treadmills and rebirth land in later milestones and all belong here.
 */
export class ProgressionService {
  /** Seed a freshly joined player. */
  initialise(player: PlayerState): void {
    player.level = 1;
    player.progression = 0;
    player.rebirths = 0;
    player.backflips = 0;
    player.wins = 0;
  }

  /** Level cap for a given rebirth count. Rebirth raises the cap. */
  levelCap(rebirths: number): number {
    return maxLevelForRebirth(rebirths);
  }

  /** Progression multiplier for a given rebirth count. */
  multiplier(rebirths: number): number {
    return rebirthMultiplier(rebirths);
  }
}
