import type { PlayerProgression } from '@obby/shared';
import type { NetPlayerState } from '../net/netTypes.js';

/**
 * Read-only mirror of the local player's SERVER-AUTHORITATIVE progression.
 *
 * The client never computes, increments or claims these values - it only
 * displays whatever the server replicated. Levels, trophies, boots, rebirth
 * and treadmill gains all land in later milestones and all stay server-side.
 */
export class ProgressionStore {
  private snapshot: PlayerProgression = {
    level: 1,
    progression: 0,
    rebirths: 0,
    backflips: 0,
    wins: 0,
    totalSpeed: 0,
    bootSlot: 1,
    ownedBoots: 1,
    moveMultiplier: 1,
    maxLevel: 10,
  };

  private readonly listeners = new Set<(value: PlayerProgression) => void>();

  get value(): Readonly<PlayerProgression> {
    return this.snapshot;
  }

  /** Called with replicated state; ignores everything except progression fields. */
  applyFromNetwork(state: NetPlayerState): void {
    const next: PlayerProgression = {
      level: state.level,
      progression: state.progression,
      rebirths: state.rebirths,
      backflips: state.backflips,
      wins: state.wins,
      totalSpeed: state.totalSpeed,
      bootSlot: state.bootSlot,
      ownedBoots: state.ownedBoots,
      moveMultiplier: state.moveMultiplier,
      maxLevel: state.maxLevel,
    };

    if (
      next.level === this.snapshot.level &&
      next.progression === this.snapshot.progression &&
      next.rebirths === this.snapshot.rebirths &&
      next.backflips === this.snapshot.backflips &&
      next.wins === this.snapshot.wins &&
      next.totalSpeed === this.snapshot.totalSpeed &&
      next.bootSlot === this.snapshot.bootSlot &&
      next.ownedBoots === this.snapshot.ownedBoots &&
      next.moveMultiplier === this.snapshot.moveMultiplier &&
      next.maxLevel === this.snapshot.maxLevel
    ) {
      return;
    }

    this.snapshot = next;
    for (const listener of this.listeners) listener(next);
  }

  subscribe(listener: (value: PlayerProgression) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }
}
