import { formatSpeed } from '@obby/shared';
import { iconMarkup } from '../config/uiIcons.js';

/** Smallest accumulated gain worth showing. */
const MIN_POPUP = 1;

/** Shortest time between two popups, in seconds. */
const MIN_INTERVAL = 0.22;

/** Seconds a popup stays on screen. */
const LIFETIME = 1.05;

/** Hard cap on concurrent popups, so a long sprint cannot flood the DOM. */
const MAX_ALIVE = 14;

/**
 * Floating "+N" Speed gains scattered across the screen.
 *
 * Purely feedback for progress the SERVER already granted: gains are
 * accumulated from the replicated total and drip out as popups. Nothing here
 * decides how much Speed was earned.
 */
export class SpeedPopups {
  private readonly layer: HTMLDivElement;
  private readonly alive = new Set<HTMLDivElement>();

  private pending = 0;
  private cooldown = 0;
  private seed = 0x9e3779b9;

  constructor(parent: HTMLElement) {
    injectStyles();
    this.layer = document.createElement('div');
    this.layer.className = 'obby-pop-layer';
    parent.appendChild(this.layer);
  }

  /** Queue a Speed gain observed from the server. */
  add(amount: number): void {
    if (!Number.isFinite(amount) || amount <= 0) return;
    this.pending += amount;
  }

  /** Drip queued gains out over time so popups stay readable. */
  update(delta: number): void {
    this.cooldown -= delta;
    if (this.cooldown > 0) return;
    if (this.pending < MIN_POPUP) return;
    if (this.alive.size >= MAX_ALIVE) {
      this.cooldown = MIN_INTERVAL;
      return;
    }

    this.spawn(this.pending);
    this.pending = 0;
    this.cooldown = MIN_INTERVAL;
  }

  dispose(): void {
    this.alive.clear();
    this.layer.remove();
  }

  private spawn(amount: number): void {
    const node = document.createElement('div');
    node.className = 'obby-pop';
    // innerHTML because the icon is an <img>. The content is our own config
    // plus a formatted number - nothing here comes from a player or a server.
    // `.obby-icon` is sized in `em`, so it tracks the popup's own responsive
    // font-size on desktop and mobile without a second rule.
    node.innerHTML = `${iconMarkup('run')}+${formatSpeed(amount)}`;

    // Scattered across the middle band, avoiding the HUD and the wins counter.
    node.style.left = `${18 + this.random() * 64}%`;
    node.style.top = `${26 + this.random() * 40}%`;
    node.style.setProperty('--drift', `${(this.random() - 0.5) * 60}px`);

    this.layer.appendChild(node);
    this.alive.add(node);

    window.setTimeout(() => {
      node.remove();
      this.alive.delete(node);
    }, LIFETIME * 1000);
  }

  /** Deterministic-ish scatter; avoids Math.random for reproducible layouts. */
  private random(): number {
    this.seed = (this.seed + 0x6d2b79f5) >>> 0;
    let t = this.seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}

let stylesInjected = false;

const injectStyles = (): void => {
  if (stylesInjected) return;
  stylesInjected = true;

  const style = document.createElement('style');
  style.textContent = `
.obby-pop-layer {
  position: fixed;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
  z-index: 15;
}
.obby-pop {
  position: absolute;
  transform: translate(-50%, -50%);
  font-family: system-ui, "Segoe UI", Roboto, sans-serif;
  font-size: clamp(15px, calc(26px * var(--obby-ui-scale, 1)), 42px);
  font-weight: 800;
  color: #ffffff;
  white-space: nowrap;
  text-shadow: 0 3px 0 #16202e, 0 -2px 0 #16202e, 2px 0 0 #16202e,
    -2px 0 0 #16202e, 0 4px 8px rgba(0, 0, 0, 0.45);
  animation: obby-pop-rise 1.05s ease-out forwards;
}
/*
 * The run icon is 1.5x the text, not 1x like the rail icons - a popup is
 * glanced at, not read, so the glyph carries it. Still expressed in em units, so
 * it tracks the popup's own responsive font-size on desktop and mobile.
 * The vertical-align offset grows with it, keeping the icon centred on the
 * number rather than riding up as it gets taller.
 */
.obby-pop .obby-icon {
  width: 1.5em;
  height: 1.5em;
  margin-right: 0.14em;
  vertical-align: -0.37em;
}
@keyframes obby-pop-rise {
  0% { opacity: 0; transform: translate(-50%, -50%) scale(0.7); }
  18% { opacity: 1; transform: translate(-50%, -50%) scale(1.08); }
  30% { transform: translate(-50%, -50%) scale(1); }
  100% {
    opacity: 0;
    transform: translate(calc(-50% + var(--drift, 0px)), calc(-50% - 90px)) scale(1);
  }
}
@media (prefers-reduced-motion: reduce) {
  .obby-pop { animation: obby-pop-fade 1.05s linear forwards; }
  @keyframes obby-pop-fade { 0% { opacity: 1; } 100% { opacity: 0; } }
}
`;
  document.head.appendChild(style);
};
