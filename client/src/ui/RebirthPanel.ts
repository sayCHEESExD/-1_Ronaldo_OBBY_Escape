import { maxLevelForRebirth, rebirthMultiplier } from '@obby/shared';
import { iconMarkup } from '../config/uiIcons.js';
import { menuKeyFor } from '../config/menuKeys.js';
import { modalLayer } from './ModalLayer.js';

/** What the panel needs to render, all replicated from the server. */
export interface RebirthView {
  readonly level: number;
  readonly maxLevel: number;
  readonly rebirths: number;
}

/**
 * The rebirth button and its confirmation panel.
 *
 * Shows the before/after of a rebirth - multiplier and level cap - and only
 * lets the player commit once the server says they have reached their max
 * level. The button itself never changes any state: it sends a request and
 * waits for replicated state to come back.
 */
export class RebirthPanel {
  private readonly button: HTMLButtonElement;
  private readonly overlay: HTMLDivElement;
  private readonly beforeMultiplier: HTMLDivElement;
  private readonly afterMultiplier: HTMLDivElement;
  private readonly beforeLevel: HTMLDivElement;
  private readonly afterLevel: HTMLDivElement;
  private readonly progressFill: HTMLDivElement;
  private readonly progressText: HTMLDivElement;
  private readonly confirm: HTMLButtonElement;

  private view: RebirthView = { level: 1, maxLevel: 10, rebirths: 0 };
  private readonly onRebirth: () => void;

  constructor(parent: HTMLElement, onRebirth: () => void) {
    injectStyles();
    this.onRebirth = onRebirth;

    this.button = document.createElement('button');
    this.button.className = 'obby-rebirth-btn';
    this.button.type = 'button';
    this.button.innerHTML =
      `<span class="obby-rebirth-btn__icon">${iconMarkup('rebirth')}</span>` +
      `<span class="obby-rebirth-btn__label">Rebirth</span>` +
      `<span class="obby-menu-key">${menuKeyFor('rebirth')?.label ?? ''}</span>`;
    this.button.addEventListener('click', () => this.toggle());
    parent.appendChild(this.button);

    this.overlay = document.createElement('div');
    this.overlay.className = 'obby-rebirth';
    this.overlay.hidden = true;

    const card = div('obby-rebirth__card');

    const close = document.createElement('button');
    close.className = 'obby-rebirth__close';
    close.type = 'button';
    close.textContent = '✕';
    close.addEventListener('click', () => this.close());

    const title = div('obby-rebirth__title');
    title.innerHTML = `<span class="obby-rebirth__title-icon">${iconMarkup('rebirth')}</span>Rebirth`;

    const columns = div('obby-rebirth__columns');
    const beforeCol = div('obby-rebirth__col');
    const arrowCol = div('obby-rebirth__arrows');
    const afterCol = div('obby-rebirth__col');

    beforeCol.appendChild(heading('Before'));
    this.beforeMultiplier = tile('obby-tile--mult');
    this.beforeLevel = tile('obby-tile--level');
    beforeCol.append(this.beforeMultiplier, this.beforeLevel);

    arrowCol.append(div('obby-rebirth__arrow'), div('obby-rebirth__arrow'));

    afterCol.appendChild(heading('After'));
    this.afterMultiplier = tile('obby-tile--mult');
    this.afterLevel = tile('obby-tile--level');
    afterCol.append(this.afterMultiplier, this.afterLevel);

    columns.append(beforeCol, arrowCol, afterCol);

    const warning = div('obby-rebirth__warning');
    warning.textContent = 'Rebirth resets your levels!';

    const bar = div('obby-rebirth__bar');
    this.progressFill = div('obby-rebirth__fill');
    this.progressText = div('obby-rebirth__progress');
    bar.append(this.progressFill, this.progressText);

    this.confirm = document.createElement('button');
    this.confirm.className = 'obby-rebirth__confirm';
    this.confirm.type = 'button';
    this.confirm.textContent = 'Rebirth';
    this.confirm.addEventListener('click', () => {
      if (this.confirm.disabled) return;
      this.onRebirth();
      this.close();
    });

    card.append(close, title, columns, warning, bar, this.confirm);
    this.overlay.appendChild(card);
    // Clicking the dim backdrop closes, but clicks inside the card must not.
    this.overlay.addEventListener('click', (event) => {
      if (event.target === this.overlay) this.close();
    });
    parent.appendChild(this.overlay);
    modalLayer.register(this);

    this.render();
  }

  /** Feed replicated state. Safe to call every frame. */
  update(view: RebirthView): void {
    if (
      view.level === this.view.level &&
      view.maxLevel === this.view.maxLevel &&
      view.rebirths === this.view.rebirths
    ) {
      return;
    }
    this.view = view;
    this.render();
  }

  dispose(): void {
    modalLayer.unregister(this);
    this.button.remove();
    this.overlay.remove();
  }

  /** True while the panel is showing. */
  get isOpen(): boolean {
    return !this.overlay.hidden;
  }

  /** Clicking the launcher a second time puts the panel away again. */
  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  open(): void {
    // Anything else showing closes first, so panels never stack.
    modalLayer.opened(this);
    this.overlay.hidden = false;
  }

  close(): void {
    this.overlay.hidden = true;
  }

  private render(): void {
    const { level, maxLevel, rebirths } = this.view;
    const next = rebirths + 1;

    this.beforeMultiplier.textContent = `x${rebirthMultiplier(rebirths).toFixed(2)}`;
    this.afterMultiplier.textContent = `x${rebirthMultiplier(next).toFixed(2)}`;
    this.beforeLevel.textContent = `Level ${maxLevel}`;
    this.afterLevel.textContent = `Level ${maxLevelForRebirth(next)}`;

    const ready = level >= maxLevel;
    const fraction = maxLevel > 0 ? Math.min(level / maxLevel, 1) : 0;
    this.progressFill.style.width = `${(fraction * 100).toFixed(1)}%`;
    this.progressText.textContent = `${level}/${maxLevel}`;

    this.confirm.disabled = !ready;
    this.confirm.textContent = ready ? 'Rebirth' : `Reach Level ${maxLevel}`;
    this.button.classList.toggle('obby-rebirth-btn--ready', ready);
  }
}

const div = (className: string): HTMLDivElement => {
  const node = document.createElement('div');
  node.className = className;
  return node;
};

const heading = (text: string): HTMLDivElement => {
  const node = div('obby-rebirth__heading');
  node.textContent = text;
  return node;
};

const tile = (variant: string): HTMLDivElement => {
  const node = div(`obby-tile ${variant}`);
  return node;
};

let stylesInjected = false;

const injectStyles = (): void => {
  if (stylesInjected) return;
  stylesInjected = true;

  const style = document.createElement('style');
  style.textContent = `
/* Same rail tile as the shop launchers - see CosmeticShop for the pattern. */
.obby-rebirth-btn {
  position: fixed;
  left: calc(var(--obby-safe-l, 0px) + 12px * var(--obby-ui-scale, 1));
  top: calc(50% + (var(--obby-rail-top, 70px) - var(--obby-rail-center, 262px)) * var(--obby-ui-scale, 1));
  width: calc(68px * var(--obby-ui-scale, 1));
  height: calc(68px * var(--obby-ui-scale, 1));
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  padding: 0;
  border-radius: calc(13px * var(--obby-ui-scale, 1));
  border: calc(3px * var(--obby-ui-scale, 1)) solid #ffffff;
  background-color: #4aa3e8;
  background-image: linear-gradient(180deg, rgba(255, 255, 255, 0.3), rgba(0, 0, 0, 0.3));
  color: #ffffff;
  font: 900 calc(12px * var(--obby-ui-scale, 1))/1 system-ui, "Segoe UI", Roboto, sans-serif;
  text-shadow: 0 2px 0 #16202e, 0 -1px 0 #16202e, 1px 0 0 #16202e, -1px 0 0 #16202e;
  cursor: pointer;
  z-index: 21;
  box-shadow: 0 4px 0 rgba(0, 0, 0, 0.45);
}
.obby-rebirth-btn__icon { font-size: calc(52px * var(--obby-ui-scale, 1)); line-height: 1; }
.obby-rebirth-btn__label { margin-top: calc(-9px * var(--obby-ui-scale, 1)); }
.obby-rebirth-btn:hover { filter: brightness(1.1); }
.obby-rebirth-btn:active { transform: translateY(3px); box-shadow: none; }
.obby-rebirth-btn--ready { animation: obby-rebirth-ready 1.4s ease-in-out infinite; }
@keyframes obby-rebirth-ready {
  0%, 100% { box-shadow: 0 4px 0 rgba(0, 0, 0, 0.45); }
  50% { box-shadow: 0 4px 0 rgba(0, 0, 0, 0.45), 0 0 0 6px rgba(255, 226, 120, 0.4); }
}

.obby-rebirth {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  /*
   * Backdrop dimming, scaled by the portal's background_transparency setting.
   * 0.62 x the default 0.9 is the 0.55 this panel has always used, so a player
   * who never touches the setting sees no change.
   */
  background: rgba(6, 10, 18, calc(0.62 * var(--obby-panel-opacity, 0.9)));
  z-index: 40;
  font-family: system-ui, "Segoe UI", Roboto, sans-serif;
}
.obby-rebirth[hidden] { display: none; }
.obby-rebirth__card {
  position: relative;
  width: min(560px, 92vw);
  padding: 20px 24px 22px;
  border-radius: 12px;
  border: 5px solid #b9d2ff;
  background: #060a14;
  box-shadow: 0 16px 44px rgba(0, 0, 0, 0.6);
}
.obby-rebirth__close {
  position: absolute;
  top: -14px;
  right: -14px;
  width: 44px;
  height: 40px;
  border-radius: 9px;
  border: 4px solid #ffffff;
  background-color: #ee2b3c;
  background-image: linear-gradient(180deg, rgba(255, 255, 255, 0.28), rgba(0, 0, 0, 0.22));
  color: #ffffff;
  font: 900 21px/1 system-ui, sans-serif;
  text-shadow: 0 2px 0 rgba(0, 0, 0, 0.45);
  box-shadow: 0 4px 0 rgba(0, 0, 0, 0.45);
  cursor: pointer;
}
.obby-rebirth__close:active { transform: translateY(3px); box-shadow: none; }
.obby-rebirth__title {
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: clamp(24px, 4vw, 32px);
  font-weight: 900;
  color: #ffffff;
  text-shadow: 0 3px 0 #16202e, 0 -2px 0 #16202e, 2px 0 0 #16202e, -2px 0 0 #16202e;
  margin-bottom: 12px;
  padding-bottom: 10px;
  border-bottom: 3px solid #2b3d63;
}
.obby-rebirth__title-icon { font-size: 0.95em; }
.obby-rebirth__columns {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 10px;
}
.obby-rebirth__col { display: grid; gap: 10px; justify-items: stretch; }
.obby-rebirth__heading {
  text-align: center;
  font-size: clamp(15px, 2.4vw, 21px);
  font-weight: 800;
  color: #ffffff;
  text-shadow: 0 2px 0 #16202e;
}
.obby-rebirth__arrows { display: grid; gap: 10px; padding-top: 32px; }
.obby-rebirth__arrow {
  width: 30px;
  height: 42px;
  background: #ffffff;
  clip-path: polygon(0 30%, 55% 30%, 55% 8%, 100% 50%, 55% 92%, 55% 70%, 0 70%);
  opacity: 0.92;
}
.obby-tile {
  display: grid;
  place-items: center;
  height: 46px;
  border-radius: 10px;
  font-size: clamp(16px, 2.7vw, 24px);
  font-weight: 900;
  color: #ffffff;
  text-shadow: 0 2px 0 rgba(0, 0, 0, 0.45);
  border: 3px solid rgba(0, 0, 0, 0.35);
}
.obby-tile--mult { background: linear-gradient(#63c8ff, #2f9ae0); }
.obby-tile--level { background: linear-gradient(#ffd35e, #f0a92c); }
.obby-rebirth__warning {
  margin: 16px 0 10px;
  text-align: center;
  font-size: clamp(14px, 2.3vw, 19px);
  font-weight: 800;
  color: #ff7ae0;
  text-shadow: 0 2px 0 #3a1030;
}
.obby-rebirth__bar {
  position: relative;
  height: 30px;
  border-radius: 8px;
  border: 3px solid #16202e;
  background: #4a5666;
  overflow: hidden;
}
.obby-rebirth__fill {
  position: absolute;
  inset: 0 auto 0 0;
  background: linear-gradient(#57e06a, #2eb045);
  transition: width 150ms linear;
}
.obby-rebirth__progress {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-size: clamp(13px, 2.1vw, 17px);
  font-weight: 800;
  color: #ffffff;
  text-shadow: 0 2px 0 #16202e;
}
.obby-rebirth__confirm {
  display: block;
  width: 100%;
  margin-top: 14px;
  padding: 12px;
  border-radius: 10px;
  border: 4px solid #ffffff;
  background-color: #ff9f1a;
  background-image: linear-gradient(180deg, rgba(255, 255, 255, 0.26), rgba(0, 0, 0, 0.24));
  color: #ffffff;
  font-size: clamp(16px, 2.6vw, 22px);
  font-weight: 900;
  text-shadow: 0 2px 0 rgba(0, 0, 0, 0.45);
  box-shadow: 0 4px 0 rgba(0, 0, 0, 0.4);
  cursor: pointer;
}
.obby-rebirth__confirm:active:not(:disabled) { transform: translateY(3px); box-shadow: none; }
.obby-rebirth__confirm:disabled {
  background-color: #46536e;
  border-color: #8a97ad;
  color: #b8c4dc;
  cursor: not-allowed;
}
@media (prefers-reduced-motion: reduce) {
  .obby-rebirth-btn--ready { animation: none; }
  .obby-rebirth__fill { transition: none; }
}
`;
  document.head.appendChild(style);
};
