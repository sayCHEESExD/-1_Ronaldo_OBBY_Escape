import { formatSpeed } from '@obby/shared';
import { iconElement } from '../config/uiIcons.js';

/** How long one popup lives - the CSS animation's length. */
const LIFETIME_MS = 1600;

/**
 * "You got it" feedback for a collected trophy: `assets/ui/trophy.png` pops
 * in, bounces, floats up with the Wins it paid, and fades.
 *
 * LOCAL ONLY and purely visual. It is shown for the amount the server's
 * replicated Wins actually rose by - it never decides or predicts a reward -
 * and remote players' collections never reach it. One lightweight DOM
 * element per collection, removed when its animation ends.
 */
export class TrophyPopup {
  private readonly layer: HTMLDivElement;

  constructor(parent: HTMLElement) {
    injectStyles();
    this.layer = document.createElement('div');
    this.layer.className = 'obby-trophy-pop-layer';
    parent.appendChild(this.layer);
  }

  /** Celebrate a collection that paid `amount` Wins. */
  show(amount: number): void {
    const pop = document.createElement('div');
    pop.className = 'obby-trophy-pop';
    const icon = iconElement('trophy');
    icon.classList.add('obby-trophy-pop__icon');
    const label = document.createElement('div');
    label.className = 'obby-trophy-pop__label';
    label.textContent = `+${formatSpeed(amount)} Wins`;
    pop.append(icon, label);
    this.layer.appendChild(pop);
    window.setTimeout(() => pop.remove(), LIFETIME_MS);
  }

  dispose(): void {
    this.layer.remove();
  }
}

let stylesInjected = false;

const injectStyles = (): void => {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
.obby-trophy-pop-layer {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 16;
}
/* Sized on the HUD's one responsive scale, like everything else on screen. */
.obby-trophy-pop {
  position: absolute;
  left: 50%;
  top: 42%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: calc(4px * var(--obby-ui-scale, 1));
  transform: translate(-50%, -50%);
  animation: obby-trophy-pop 1.6s ease-out forwards;
}
.obby-trophy-pop__icon.obby-icon {
  width: clamp(56px, calc(72px * var(--obby-ui-scale, 1)), 120px);
  height: clamp(56px, calc(72px * var(--obby-ui-scale, 1)), 120px);
  filter: drop-shadow(0 4px 6px rgba(0, 0, 0, 0.45));
}
.obby-trophy-pop__label {
  font: 900 clamp(16px, calc(22px * var(--obby-ui-scale, 1)), 34px)/1 system-ui, "Segoe UI", Roboto, sans-serif;
  color: #ffd75e;
  white-space: nowrap;
  text-shadow: 0 3px 0 #16202e, 0 -2px 0 #16202e, 2px 0 0 #16202e, -2px 0 0 #16202e;
}
@keyframes obby-trophy-pop {
  0% { opacity: 0; transform: translate(-50%, -50%) scale(0.3); }
  16% { opacity: 1; transform: translate(-50%, -50%) scale(1.18); }
  28% { transform: translate(-50%, -50%) scale(0.94); }
  40% { transform: translate(-50%, -50%) scale(1.04); }
  52% { opacity: 1; transform: translate(-50%, -55%) scale(1); }
  100% { opacity: 0; transform: translate(-50%, -130%) scale(0.96); }
}
@media (prefers-reduced-motion: reduce) {
  .obby-trophy-pop { animation: obby-trophy-fade 1.6s linear forwards; }
  @keyframes obby-trophy-fade { 0%, 60% { opacity: 1; } 100% { opacity: 0; } }
}
`;
  document.head.appendChild(style);
};
