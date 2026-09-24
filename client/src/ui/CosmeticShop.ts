import { formatSpeed } from '@obby/shared';
import { iconMarkup } from '../config/uiIcons.js';
import { modalLayer } from './ModalLayer.js';

/** One buyable row, as far as the shop is concerned. */
export interface CosmeticRow {
  readonly slot: number;
  readonly name: string;
  readonly cost: number;
  readonly multiplier: number;
  /** CSS colour for the row's swatch. */
  readonly swatch: string;
  /** Optional second colour, for the animated styles. */
  readonly swatchAccent?: string;
}

/** What the shop asks the server to do. It never changes state itself. */
export interface CosmeticShopNetwork {
  buy(slot: number): void;
  equip(slot: number): void;
}

export interface CosmeticShopOptions {
  /** Button label and popup title, e.g. "Trails". */
  readonly title: string;
  /** Emoji shown on the button and in the title. */
  readonly icon: string;
  /** What the multiplier does, e.g. "Speed" or "Wins". */
  readonly effect: string;
  /** Distance from the top of the screen for the launcher button. */
  readonly buttonTop: number;
  /** Keyboard shortcut shown on the rail button, e.g. "2". */
  readonly menuKey?: string;
  /** Accent colour for the button. */
  readonly accent: string;
  readonly rows: readonly CosmeticRow[];
}

/**
 * A buy-and-equip cosmetic shop: a launcher button plus its popup.
 *
 * Trails and auras present identically - a list of tiers with a cost, a
 * multiplier and an owned/equipped state - so they share this one panel rather
 * than two near-identical files. What each multiplier DOES is not this class's
 * business; it renders `effect` as a label and nothing more.
 *
 * Purely a view. Every button sends a request and waits for replicated state
 * to come back, so the shop can never show something the server has not
 * agreed to.
 */
export class CosmeticShop {
  private readonly options: CosmeticShopOptions;
  private readonly network: CosmeticShopNetwork;

  private readonly button: HTMLButtonElement;
  private readonly overlay: HTMLDivElement;
  private readonly list: HTMLDivElement;
  private readonly walletLabel: HTMLDivElement;

  /** Row nodes by slot, so an update repaints rather than rebuilds. */
  private readonly rowNodes = new Map<number, HTMLDivElement>();

  private wins = 0;
  private owned = 0;
  private equipped = 0;

  constructor(
    parent: HTMLElement,
    options: CosmeticShopOptions,
    network: CosmeticShopNetwork,
  ) {
    injectStyles();
    this.options = options;
    this.network = network;

    this.button = document.createElement('button');
    this.button.className = 'obby-cos-btn';
    this.button.type = 'button';
    // A custom property rather than an inline `top`: an inline style outranks
    // every selector, so the mobile stylesheet could never restack the rail.
    this.button.style.setProperty('--obby-rail-top', `${options.buttonTop}px`);
    this.button.style.setProperty('--accent', options.accent);
    const keyBadge = options.menuKey
      ? `<span class="obby-menu-key">${options.menuKey}</span>`
      : '';
    this.button.innerHTML =
      `<span class="obby-cos-btn__icon">${options.icon}</span>` +
      `<span class="obby-cos-btn__label">${options.title}</span>${keyBadge}`;
    this.button.addEventListener('click', () => this.toggle());
    parent.appendChild(this.button);

    this.overlay = document.createElement('div');
    this.overlay.className = 'obby-cos';
    this.overlay.hidden = true;

    const card = document.createElement('div');
    card.className = 'obby-cos__card';

    const header = document.createElement('div');
    header.className = 'obby-cos__header';

    const title = document.createElement('div');
    title.className = 'obby-cos__title';
    title.innerHTML = `<span>${options.icon}</span>${options.title}`;

    this.walletLabel = document.createElement('div');
    this.walletLabel.className = 'obby-cos__wallet';

    const close = document.createElement('button');
    close.className = 'obby-cos__close';
    close.type = 'button';
    close.textContent = '✕';
    close.addEventListener('click', () => this.close());

    header.append(title, this.walletLabel, close);

    this.list = document.createElement('div');
    this.list.className = 'obby-cos__list';
    for (const row of options.rows) this.list.appendChild(this.buildRow(row));

    card.append(header, this.list);
    this.overlay.appendChild(card);
    // Clicking the backdrop closes; clicking the card must not.
    this.overlay.addEventListener('click', (event) => {
      if (event.target === this.overlay) this.close();
    });
    parent.appendChild(this.overlay);
    modalLayer.register(this);
  }

  /** Mirror the replicated wallet and inventory. */
  setState(wins: number, owned: number, equipped: number): void {
    if (wins === this.wins && owned === this.owned && equipped === this.equipped) return;
    this.wins = wins;
    this.owned = owned;
    this.equipped = equipped;
    this.repaint();
  }

  /** True while the popup is showing. */
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
    this.repaint();
    this.overlay.hidden = false;
    this.button.classList.add('obby-cos-btn--open');
  }

  close(): void {
    this.overlay.hidden = true;
    this.button.classList.remove('obby-cos-btn--open');
  }

  dispose(): void {
    modalLayer.unregister(this);
    this.button.remove();
    this.overlay.remove();
  }

  private buildRow(row: CosmeticRow): HTMLDivElement {
    const node = document.createElement('div');
    node.className = 'obby-cos__row';

    const text = document.createElement('div');
    text.className = 'obby-cos__text';

    const name = document.createElement('div');
    name.className = 'obby-cos__name';
    name.textContent = row.name;

    // Icon and multiplier sit together under the name, as in the reference.
    const foot = document.createElement('div');
    foot.className = 'obby-cos__foot';

    const swatch = document.createElement('div');
    swatch.className = 'obby-cos__swatch';
    swatch.style.background = row.swatchAccent
      ? `linear-gradient(135deg, ${row.swatch}, ${row.swatchAccent})`
      : row.swatch;

    const meta = document.createElement('div');
    meta.className = 'obby-cos__meta';
    meta.textContent = `x${row.multiplier} ${this.options.effect}`;

    foot.append(swatch, meta);
    text.append(name, foot);

    const action = document.createElement('button');
    action.className = 'obby-cos__action';
    action.type = 'button';
    action.addEventListener('click', () => this.act(row));

    node.append(text, action);
    this.rowNodes.set(row.slot, node);
    return node;
  }

  /**
   * One button, three meanings - buy, equip, or unequip.
   *
   * All three are REQUESTS. Nothing here writes ownership or the equipped
   * slot; the row only changes once the server replicates it back.
   */
  private act(row: CosmeticRow): void {
    const owned = (this.owned & (1 << (row.slot - 1))) !== 0;
    if (!owned) {
      if (this.wins < row.cost) return;
      this.network.buy(row.slot);
      return;
    }
    this.network.equip(this.equipped === row.slot ? 0 : row.slot);
  }

  private repaint(): void {
    // innerHTML rather than textContent because the trophy is now an <img>.
    // The content is our own config plus a formatted number - nothing here
    // comes from another player or the server.
    this.walletLabel.innerHTML = `${iconMarkup('trophy')} ${formatSpeed(this.wins)}`;

    for (const row of this.options.rows) {
      const node = this.rowNodes.get(row.slot);
      if (!node) continue;
      const action = node.querySelector('.obby-cos__action') as HTMLButtonElement | null;
      if (!action) continue;

      const owned = (this.owned & (1 << (row.slot - 1))) !== 0;
      const equipped = this.equipped === row.slot;
      const affordable = this.wins >= row.cost;

      node.classList.toggle('obby-cos__row--owned', owned);
      node.classList.toggle('obby-cos__row--equipped', equipped);

      if (equipped) {
        action.textContent = 'Unequip';
        action.className = 'obby-cos__action obby-cos__action--equipped';
        action.disabled = false;
      } else if (owned) {
        action.textContent = 'Equip';
        action.className = 'obby-cos__action obby-cos__action--equip';
        action.disabled = false;
      } else {
        action.innerHTML = `${iconMarkup('trophy')} ${formatSpeed(row.cost)}`;
        action.className = `obby-cos__action obby-cos__action--buy${
          affordable ? '' : ' obby-cos__action--poor'
        }`;
        action.disabled = !affordable;
      }
    }
  }
}

let stylesInjected = false;

const injectStyles = (): void => {
  if (stylesInjected) return;
  stylesInjected = true;

  const style = document.createElement('style');
  style.textContent = `
/*
 * The left feature rail: square tiles with a heavy white outline, stacked
 * under the trophy counter. Icon above, label below, exactly as the reference.
 */
.obby-cos-btn {
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
  border: calc(3px * var(--obby-ui-scale, 1)) solid #ffffff;
  border-radius: calc(13px * var(--obby-ui-scale, 1));
  background-color: var(--accent, #7b5bff);
  background-image: linear-gradient(180deg, rgba(255, 255, 255, 0.3), rgba(0, 0, 0, 0.3));
  color: #ffffff;
  font: 900 calc(12px * var(--obby-ui-scale, 1))/1 system-ui, "Segoe UI", Roboto, sans-serif;
  letter-spacing: 0.01em;
  text-shadow: 0 2px 0 #16202e, 0 -1px 0 #16202e, 1px 0 0 #16202e, -1px 0 0 #16202e;
  box-shadow: 0 4px 0 rgba(0, 0, 0, 0.45);
  cursor: pointer;
  z-index: 21;
}
.obby-cos-btn__icon { font-size: calc(52px * var(--obby-ui-scale, 1)); line-height: 1; }
/*
 * The shortcut badge, pinned to the tile's corner.
 *
 * Shared by every rail button - the rebirth panel injects its own styles, so
 * whichever loads first defines it and the rule is identical either way.
 */
.obby-menu-key {
  position: absolute;
  top: calc(3px * var(--obby-ui-scale, 1));
  right: calc(4px * var(--obby-ui-scale, 1));
  min-width: calc(15px * var(--obby-ui-scale, 1));
  padding: 0 calc(3px * var(--obby-ui-scale, 1));
  border-radius: calc(5px * var(--obby-ui-scale, 1));
  background: rgba(10, 16, 28, 0.72);
  color: #ffffff;
  font: 900 calc(11px * var(--obby-ui-scale, 1))/calc(16px * var(--obby-ui-scale, 1))
    system-ui, "Segoe UI", Roboto, sans-serif;
  text-align: center;
  pointer-events: none;
}
/*
 * The label sits OVER the bottom of the artwork rather than under it. At this
 * icon size a stacked layout would not fit the tile, and the reference art has
 * the two overlapping anyway.
 *
 * Matched by its own CLASS, never by position. This was a last-child rule, and
 * adding the shortcut badge after the label silently handed the rule to the
 * badge - which is absolutely positioned, so the offset vanished and the label
 * dropped onto the tile's bottom edge.
 */
.obby-cos-btn__label { margin-top: calc(-9px * var(--obby-ui-scale, 1)); }
/*
 * Custom icon art. Sized in em units so one image tracks whatever text it
 * sits with - 27px in the rail tile, 21px on mobile, 29px in the modal title
 * - and swapping the file is the only thing needed to change the icon.
 * (No backticks in here: this whole stylesheet is a template literal.)
 */
.obby-icon {
  display: inline-block;
  width: 1em;
  height: 1em;
  object-fit: contain;
  vertical-align: -0.12em;
}
.obby-cos-btn:hover { filter: brightness(1.1); }
.obby-cos-btn:active { transform: translateY(3px); box-shadow: none; }
.obby-cos-btn--open { outline: 3px solid rgba(255, 255, 255, 0.75); outline-offset: 2px; }

.obby-cos {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  /*
   * Backdrop dimming, scaled by the portal's background_transparency setting.
   * 0.62 x the default 0.9 is the 0.55 this panel has always used, so a player
   * who never touches the setting sees no change.
   */
  background: rgba(6, 10, 18, calc(0.62 * var(--obby-panel-opacity, 0.9)));
  z-index: 40;
  font-family: system-ui, "Segoe UI", Roboto, sans-serif;
}
/*
 * REQUIRED. A class selector outranks the user-agent's [hidden] rule, so
 * without this the display:flex above wins and setting .hidden has no
 * visible effect at all - the panel could be closed in script and stay on
 * screen forever. RebirthPanel has always carried the same line.
 */
.obby-cos[hidden] { display: none; }

.obby-cos__card {
  width: min(540px, 94vw);
  max-height: 82vh;
  display: flex;
  flex-direction: column;
  background: #060a14;
  border: 5px solid #b9d2ff;
  border-radius: 12px;
  box-shadow: 0 16px 44px rgba(0, 0, 0, 0.6);
  overflow: hidden;
}
.obby-cos__header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px 9px;
  border-bottom: 3px solid #2b3d63;
}
.obby-cos__title {
  display: flex;
  align-items: center;
  gap: 9px;
  flex: 1;
  font-size: 29px;
  font-weight: 900;
  color: #ffffff;
  text-shadow: 0 3px 0 #16202e, 0 -2px 0 #16202e, 2px 0 0 #16202e, -2px 0 0 #16202e;
}
.obby-cos__wallet {
  font-size: 15px;
  font-weight: 900;
  color: #ffd75e;
  text-shadow: 0 2px 0 #16202e;
}
.obby-cos__close {
  width: 44px;
  height: 40px;
  flex: none;
  border: 4px solid #ffffff;
  border-radius: 9px;
  background-color: #ee2b3c;
  background-image: linear-gradient(180deg, rgba(255, 255, 255, 0.28), rgba(0, 0, 0, 0.22));
  color: #ffffff;
  font: 900 21px/1 system-ui, sans-serif;
  text-shadow: 0 2px 0 rgba(0, 0, 0, 0.45);
  box-shadow: 0 4px 0 rgba(0, 0, 0, 0.45);
  cursor: pointer;
}
.obby-cos__close:hover { filter: brightness(1.12); }
.obby-cos__close:active { transform: translateY(3px); box-shadow: none; }

.obby-cos__list { overflow-y: auto; padding: 9px; display: grid; gap: 9px; }

/* One item card: name on top, icon + multiplier beneath, action on the right. */
.obby-cos__row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 11px;
  border-radius: 9px;
  background: #0b1020;
  border: 3px solid #7f93bd;
}
.obby-cos__row--equipped { border-color: #6bff8c; }
.obby-cos__text { flex: 1; min-width: 0; }
.obby-cos__name {
  font-size: 23px;
  font-weight: 900;
  color: #ffffff;
  letter-spacing: 0.005em;
  text-shadow: 0 3px 0 #0a0f1c, 0 -2px 0 #0a0f1c, 2px 0 0 #0a0f1c, -2px 0 0 #0a0f1c;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.obby-cos__foot { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
.obby-cos__swatch {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  border: 2px solid rgba(255, 255, 255, 0.55);
  box-shadow: 0 0 10px rgba(255, 255, 255, 0.25);
  flex: none;
}
.obby-cos__meta {
  font-size: 14px;
  font-weight: 800;
  color: #e6edff;
  text-shadow: 0 2px 0 #0a0f1c;
}

.obby-cos__action {
  min-width: 132px;
  padding: 11px 12px;
  flex: none;
  border: 4px solid #ffffff;
  border-radius: 10px;
  background-color: #4a5975;
  background-image: linear-gradient(180deg, rgba(255, 255, 255, 0.26), rgba(0, 0, 0, 0.24));
  color: #ffffff;
  font: 900 19px/1 system-ui, sans-serif;
  text-shadow: 0 2px 0 rgba(0, 0, 0, 0.45);
  box-shadow: 0 4px 0 rgba(0, 0, 0, 0.4);
  cursor: pointer;
}
.obby-cos__action:active { transform: translateY(3px); box-shadow: none; }
.obby-cos__action--equip,
.obby-cos__action--equipped { background-color: #ff9f1a; }
.obby-cos__action--buy { background-color: #57d43a; }
.obby-cos__action--poor {
  background-color: #46536e;
  color: #b8c4dc;
  cursor: not-allowed;
}
.obby-cos__action--poor:active { transform: none; box-shadow: 0 4px 0 rgba(0, 0, 0, 0.4); }
`;
  document.head.append(style);
};
