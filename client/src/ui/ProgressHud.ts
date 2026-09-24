import { formatSpeed, resolveLevel, type LevelProgress } from '@obby/shared';

/**
 * The Speed / level HUD, pinned bottom-centre.
 *
 * Purely a display of SERVER-AUTHORITATIVE state: it renders the replicated
 * lifetime Speed total and the level that follows from it. Nothing here awards
 * or predicts progress.
 */
export class ProgressHud {
  private readonly root: HTMLDivElement;
  private readonly jumpLabel: HTMLDivElement;
  private readonly totalLabel: HTMLDivElement;
  private readonly rebirthLabel: HTMLDivElement;
  private readonly fill: HTMLDivElement;
  private readonly levelLabel: HTMLDivElement;
  private readonly amountLabel: HTMLDivElement;

  private lastTotal = -1;
  private lastLevel = -1;
  private lastRebirths = -1;

  constructor(parent: HTMLElement) {
    injectStyles();

    this.root = el('div', 'obby-hud');

    this.jumpLabel = el('div', 'obby-hud__jump');
    this.jumpLabel.hidden = true;

    this.totalLabel = el('div', 'obby-hud__total');
    this.totalLabel.textContent = 'Total Speed: 0';

    this.rebirthLabel = el('div', 'obby-hud__rebirth');
    this.rebirthLabel.textContent = 'Rebirth: +0%';

    const bar = el('div', 'obby-hud__bar');
    this.fill = el('div', 'obby-hud__fill');
    this.levelLabel = el('div', 'obby-hud__level');
    this.amountLabel = el('div', 'obby-hud__amount');

    bar.append(this.fill, this.levelLabel, this.amountLabel);
    this.root.append(this.rebirthLabel, this.jumpLabel, this.totalLabel, bar);
    parent.appendChild(this.root);
  }

  /**
   * @param totalSpeed lifetime Speed farmed, replicated from the server
   * @param levelCap   highest reachable level for this player
   * @param rebirths   replicated rebirth count (always 0 until rebirth ships)
   */
  update(totalSpeed: number, levelCap: number, rebirths: number): void {
    const progress = resolveLevel(totalSpeed, levelCap);

    if (totalSpeed !== this.lastTotal) {
      this.lastTotal = totalSpeed;
      this.totalLabel.textContent = `Total Speed: ${formatSpeed(totalSpeed)}`;
      this.renderBar(progress);
    }

    if (progress.level !== this.lastLevel) {
      this.lastLevel = progress.level;
      this.levelLabel.textContent = `Level ${progress.level}`;
      // A brief flash marks the moment a level (and a backflip) is gained.
      this.root.classList.remove('obby-hud--levelup');
      void this.root.offsetWidth;
      this.root.classList.add('obby-hud--levelup');
    }

    if (rebirths !== this.lastRebirths) {
      this.lastRebirths = rebirths;
      this.rebirthLabel.textContent = `Rebirth: +${rebirths * 50}%`;
    }
  }

  /**
   * Backflips left in the current airborne window.
   *
   * Only shown in midair - on the ground the count is always full and the line
   * would be noise.
   */
  setJumps(airborne: boolean, remaining: number, capacity: number): void {
    if (!airborne) {
      this.jumpLabel.hidden = true;
      return;
    }
    this.jumpLabel.hidden = false;
    this.jumpLabel.textContent = `Jump: ${remaining}/${capacity}`;
  }

  dispose(): void {
    this.root.remove();
  }

  /**
   * Draw the bar, and at the cap say what unblocks it.
   *
   * "MAX" read as an ending, which is the opposite of what the level cap
   * means here: it is the gate to a rebirth, which raises the cap and the
   * multiplier and is the only way the curve continues. So the label is the
   * instruction rather than the state, and it is styled as a call to action
   * instead of another figure.
   */
  private renderBar(progress: LevelProgress): void {
    this.fill.style.width = `${(progress.fraction * 100).toFixed(2)}%`;
    this.amountLabel.textContent = progress.capped
      ? 'Rebirth To Level Up!'
      : `${formatSpeed(progress.into)}/${formatSpeed(progress.required)}`;
    this.amountLabel.classList.toggle('obby-hud__amount--rebirth', progress.capped);
  }
}

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  node.className = className;
  return node;
};

let stylesInjected = false;

/** One stylesheet for the HUD, injected on first construction. */
const injectStyles = (): void => {
  if (stylesInjected) return;
  stylesInjected = true;

  const style = document.createElement('style');
  style.textContent = `
/*
 * Anchored BOTTOM-CENTRE at every size. Everything below is a design pixel
 * times --obby-ui-scale (ui/uiScale.ts), clamped so text stays readable on a
 * phone and does not balloon on a big monitor. The width follows the screen
 * but never runs edge to edge: at most 62% of it, at most the scaled design
 * width. \`--obby-hud-bottom\` is the one knob the touch layout moves, and the
 * treadmill panel stacks on the same variable.
 */
.obby-hud {
  --obby-hud-bar-h: clamp(20px, calc(26px * var(--obby-ui-scale, 1)), 42px);
  position: fixed;
  left: 50%;
  bottom: var(--obby-hud-bottom, calc(var(--obby-safe-b, 0px) + 18px * var(--obby-ui-scale, 1)));
  transform: translateX(-50%);
  width: clamp(240px, 62vw, calc(523px * var(--obby-ui-scale, 1)));
  /* Lets the labels respond to the HUD's own width, not the screen's. */
  container-type: inline-size;
  pointer-events: none;
  user-select: none;
  font-family: system-ui, "Segoe UI", Roboto, sans-serif;
  z-index: 20;
}
.obby-hud__jump {
  text-align: center;
  font-size: clamp(14px, calc(23px * var(--obby-ui-scale, 1)), 38px);
  font-weight: 800;
  color: #ffffff;
  letter-spacing: 0.01em;
  text-shadow: 0 3px 0 #16202e, 0 -2px 0 #16202e, 2px 0 0 #16202e,
    -2px 0 0 #16202e, 0 4px 8px rgba(0, 0, 0, 0.45);
  margin-bottom: calc(3px * var(--obby-ui-scale, 1));
}
.obby-hud__total {
  text-align: center;
  font-size: clamp(12px, calc(16px * var(--obby-ui-scale, 1)), 27px);
  font-weight: 800;
  color: #ffffff;
  letter-spacing: 0.02em;
  text-shadow: 0 2px 0 #16202e, 0 -2px 0 #16202e, 2px 0 0 #16202e,
    -2px 0 0 #16202e, 0 3px 6px rgba(0, 0, 0, 0.45);
  margin-bottom: calc(4px * var(--obby-ui-scale, 1));
}
.obby-hud__rebirth {
  position: absolute;
  right: 4px;
  /*
   * Anchored to the BOTTOM, above the bar.
   *
   * The HUD is pinned by its bottom edge, so showing the airborne jump counter
   * grows the box UPWARD - and a top-anchored label rides that moving edge,
   * which is why the rebirth figure jumped whenever jumps appeared. The bar is
   * the one part of the HUD that never moves, so the label is measured from
   * it: the same offset expression as the bar's own height, plus a gap.
   */
  bottom: calc(var(--obby-hud-bar-h) + 4px * var(--obby-ui-scale, 1));
  font-size: clamp(10px, calc(11.5px * var(--obby-ui-scale, 1)), 19px);
  font-weight: 800;
  color: #e879ff;
  text-shadow: 0 2px 0 #2a1038, 0 -1px 0 #2a1038, 1px 0 0 #2a1038, -1px 0 0 #2a1038;
}
.obby-hud__bar {
  position: relative;
  height: var(--obby-hud-bar-h);
  border-radius: 6px;
  background: #4a5666;
  border: 2px solid #16202e;
  overflow: hidden;
  box-shadow: 0 3px 8px rgba(0, 0, 0, 0.35);
}
.obby-hud__fill {
  position: absolute;
  inset: 0 auto 0 0;
  width: 0%;
  background: linear-gradient(#43b6ff, #1b8fe8);
  border-right: 2px solid #0d5f9e;
  transition: width 120ms linear;
}
.obby-hud__level,
.obby-hud__amount {
  position: absolute;
  top: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  font-size: clamp(11px, calc(13px * var(--obby-ui-scale, 1)), 21px);
  font-weight: 800;
  color: #ffffff;
  text-shadow: 0 2px 0 #16202e, 0 -1px 0 #16202e, 1px 0 0 #16202e, -1px 0 0 #16202e;
  white-space: nowrap;
}
.obby-hud__level { left: calc(9px * var(--obby-ui-scale, 1)); }
.obby-hud__amount { right: calc(9px * var(--obby-ui-scale, 1)); }
/*
 * The rebirth prompt. Gold and slowly pulsing, so it reads as something to
 * act on rather than the number it replaced - and slow enough not to compete
 * with the level-up flash that plays on the same element's parent.
 */
.obby-hud__amount--rebirth {
  color: #ffd75e;
  text-shadow: 0 2px 0 #2a1038, 0 -1px 0 #2a1038, 1px 0 0 #2a1038,
    -1px 0 0 #2a1038, 0 0 10px rgba(255, 215, 94, 0.55);
  animation: obby-hud-rebirth-pulse 1.6s ease-in-out infinite;
}
@keyframes obby-hud-rebirth-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.62; }
}
@media (prefers-reduced-motion: reduce) {
  .obby-hud__amount--rebirth { animation: none; }
}
.obby-hud--levelup .obby-hud__bar {
  animation: obby-hud-pop 420ms ease-out;
}
@keyframes obby-hud-pop {
  0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(255, 226, 120, 0.9); }
  35% { transform: scale(1.035); box-shadow: 0 0 0 7px rgba(255, 226, 120, 0); }
  100% { transform: scale(1); box-shadow: 0 3px 8px rgba(0, 0, 0, 0.35); }
}
/*
 * On a narrow bar the centred total runs into the rebirth figure, which sits
 * right-aligned on the same line. Left-aligning the total keeps both on that
 * line, side by side, at any width.
 */
@container (max-width: 420px) {
  .obby-hud__total { text-align: left; padding-left: 4px; }
}
@media (prefers-reduced-motion: reduce) {
  .obby-hud__fill { transition: none; }
  .obby-hud--levelup .obby-hud__bar { animation: none; }
}
`;
  document.head.appendChild(style);
};
