import { treadmillByTier } from '@obby/shared';

/** What the server says about the player's treadmill this frame. */
export interface TreadmillStatus {
  /** Tier physically stood on, or 0. */
  readonly standing: number;
  /** Tier actually being RUN ON - 0 when not pinned to a machine. */
  readonly active: number;
  /** Highest tier the player's rebirth count allows. */
  readonly maxTier: number;
  /** Multiplier granted; 1 when no treadmill is in force. */
  readonly multiplier: number;
  /** Final Speed per step after every modifier. */
  readonly speedPerStep: number;
  readonly rebirths: number;
}

/**
 * Minimum functional readout for the treadmills: which one is in use, what it
 * multiplies by, and why a locked one is refused.
 *
 * Deliberately plain - this is testing feedback, not the finished UI. Every
 * value shown is replicated from the server; nothing is computed here.
 */
export class TreadmillHud {
  private readonly root: HTMLDivElement;
  private readonly title: HTMLDivElement;
  private readonly detail: HTMLDivElement;

  private lastKey = '';

  constructor(container: HTMLElement) {
    injectStyles();

    this.root = document.createElement('div');
    this.root.className = 'obby-tread';

    this.title = document.createElement('div');
    this.title.className = 'obby-tread__title';

    this.detail = document.createElement('div');
    this.detail.className = 'obby-tread__detail';

    this.root.append(this.title, this.detail);
    container.append(this.root);
    this.root.style.display = 'none';
  }

  update(status: TreadmillStatus): void {
    // Cheap change gate: the HUD is touched on every replicated patch.
    const key = `${status.standing}|${status.active}|${status.maxTier}|${
      status.multiplier
    }|${Math.round(status.speedPerStep * 100)}|${status.rebirths}`;
    if (key === this.lastKey) return;
    this.lastKey = key;

    const shown = status.active || status.standing;
    if (shown === 0) {
      this.root.style.display = 'none';
      return;
    }

    const tier = treadmillByTier(shown);
    this.root.style.display = 'block';
    this.title.textContent = `Treadmill ${shown}${tier ? ` - ${tier.name}` : ''}`;

    if (status.active > 0) {
      this.root.classList.remove('obby-tread--locked');
      this.detail.textContent =
        `RUNNING  |  x${status.multiplier} steps  |  ${round(status.speedPerStep)} Speed / step`;
      return;
    }

    if (shown <= status.maxTier) {
      // Unlocked, but the player is still steering. Entry is automatic the
      // moment they stop, so say so rather than showing nothing.
      this.root.classList.remove('obby-tread--locked');
      this.detail.textContent =
        `x${tier?.multiplier ?? 1} steps  |  stop moving to start running`;
      return;
    }

    this.root.classList.add('obby-tread--locked');
    const needed = tier?.requiredRebirth ?? 0;
    this.detail.textContent = `LOCKED - needs ${needed} rebirths (you have ${status.rebirths})`;
  }

  dispose(): void {
    this.root.remove();
  }
}

const round = (value: number): string =>
  Number.isFinite(value) ? (Math.round(value * 10) / 10).toString() : '0';

let stylesInjected = false;

const injectStyles = (): void => {
  if (stylesInjected) return;
  stylesInjected = true;

  const style = document.createElement('style');
  style.textContent = `
.obby-tread {
  position: fixed;
  left: 50%;
  /* Stacked just above the progress HUD, on the same anchor, at any size. */
  bottom: calc(
    var(--obby-hud-bottom, calc(var(--obby-safe-b, 0px) + 18px * var(--obby-ui-scale, 1)))
      + 91px * var(--obby-ui-scale, 1)
  );
  transform: translateX(-50%);
  max-width: calc(100vw - 24px);
  padding: calc(5px * var(--obby-ui-scale, 1)) calc(11px * var(--obby-ui-scale, 1));
  border-radius: calc(6px * var(--obby-ui-scale, 1));
  background: rgba(14, 22, 34, 0.72);
  border: 2px solid #16202e;
  text-align: center;
  pointer-events: none;
  user-select: none;
  font-family: system-ui, "Segoe UI", Roboto, sans-serif;
  z-index: 20;
}
.obby-tread__title {
  font-size: clamp(11px, calc(13px * var(--obby-ui-scale, 1)), 21px);
  font-weight: 800;
  color: #7ef0c0;
  letter-spacing: 0.02em;
}
.obby-tread__detail {
  font-size: clamp(10px, calc(11px * var(--obby-ui-scale, 1)), 17px);
  font-weight: 700;
  color: #ffffff;
  opacity: 0.9;
}
.obby-tread--locked .obby-tread__title { color: #ff8080; }
`;
  document.head.append(style);
};
