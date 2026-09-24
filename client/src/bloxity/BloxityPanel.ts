import { BUX_PRODUCTS } from '@obby/shared';
import { modalLayer } from '../ui/ModalLayer.js';
import { logger } from '../util/logger.js';
import { resolvePfpUrl } from './bloxityConfig.js';
import { bloxity, visibleName } from './BloxitySdk.js';
import type { LegionFriend, LegionUser } from './sdkTypes.js';

const SCOPE = 'BloxityPanel';

/**
 * Where the launcher sits in the left rail, under the audio tile.
 *
 * Not on the 76px step the tiles above use: the audio block is a tile plus a
 * slider and a key hint, so it is taller than a tile and this clears all three.
 */
const RAIL_TOP = 386;

/** Another player in the current room, as the Bloxity panel lists them. */
export interface RoomPlayer {
  readonly sessionId: string;
  /** Bloxity display name, or empty if the player sent none. */
  readonly name: string;
  /** Bloxity account id, or empty for a guest. */
  readonly userId: string;
  /** Bloxity avatar URL, or empty. */
  readonly pfp: string;
}

export interface BloxityPanelOptions {
  /** Shortcut shown on the launcher, e.g. "4". */
  readonly menuKey: string;
  /** Everyone else in the room right now, read fresh on every repaint. */
  readonly getRoomPlayers: () => readonly RoomPlayer[];
}

/**
 * The Bloxity panel: account, friends, invites and Bux.
 *
 * A `ModalPanel` like every other popup in this game, so it goes through
 * `modalLayer` and inherits the rules that already exist - only one panel up
 * at a time, Escape closes it, gameplay input is suppressed while it is open
 * and the pointer lock comes back when it closes.
 *
 * It RENDERS state, it does not own any. The user comes from `onUserChanged`
 * on every repaint rather than from a field, so a login in another tab or a
 * logout from the portal cannot leave a stale name on screen.
 */
export class BloxityPanel {
  private readonly button: HTMLButtonElement;
  private readonly overlay: HTMLDivElement;
  private readonly body: HTMLDivElement;

  private friends: LegionFriend[] = [];
  private friendsLoading = false;
  private buxBalance: number | null = null;
  private notice = '';
  private readonly getRoomPlayers: () => readonly RoomPlayer[];

  constructor(parent: HTMLElement, options: BloxityPanelOptions) {
    injectStyles();
    this.getRoomPlayers = options.getRoomPlayers;

    this.button = document.createElement('button');
    this.button.className = 'obby-blox-btn';
    this.button.type = 'button';
    this.button.style.setProperty('--obby-rail-top', `${RAIL_TOP}px`);
    this.button.innerHTML =
      '<span class="obby-blox-btn__icon">🌐</span>' +
      '<span class="obby-blox-btn__label">Bloxity</span>' +
      (options.menuKey ? `<span class="obby-menu-key">${options.menuKey}</span>` : '');
    this.button.addEventListener('click', () => this.toggle());
    parent.appendChild(this.button);

    this.overlay = document.createElement('div');
    this.overlay.className = 'obby-blox';
    this.overlay.hidden = true;

    const card = document.createElement('div');
    card.className = 'obby-blox__card';

    const header = document.createElement('div');
    header.className = 'obby-blox__header';
    const title = document.createElement('div');
    title.className = 'obby-blox__title';
    title.textContent = 'Bloxity';
    const close = document.createElement('button');
    close.className = 'obby-blox__close';
    close.type = 'button';
    close.textContent = '✕';
    close.addEventListener('click', () => this.close());
    header.append(title, close);

    this.body = document.createElement('div');
    this.body.className = 'obby-blox__body';

    card.append(header, this.body);
    this.overlay.appendChild(card);
    this.overlay.addEventListener('click', (event) => {
      if (event.target === this.overlay) this.close();
    });
    parent.appendChild(this.overlay);

    modalLayer.register(this);
  }

  get isOpen(): boolean {
    return !this.overlay.hidden;
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  open(): void {
    modalLayer.opened(this);
    this.overlay.hidden = false;
    this.button.classList.add('obby-blox-btn--open');
    this.repaint();
    // Both are network round-trips, so they are refreshed on open rather than
    // polled - a panel nobody has opened should cost nothing.
    void this.loadFriends();
    void this.loadBalance();
  }

  close(): void {
    this.overlay.hidden = true;
    this.button.classList.remove('obby-blox-btn--open');
  }

  /** Re-render after an auth, avatar or purchase change. */
  refresh(): void {
    if (this.isOpen) this.repaint();
  }

  /**
   * Re-fetch friends and the Bux balance after the identity changed.
   *
   * Only while open: a closed panel fetches both when it next opens, and a
   * login should not cost network round-trips nobody is looking at. A logout
   * clears the friends list before repainting, so the previous account's
   * friends are never shown under a guest name.
   */
  reloadData(): void {
    if (!this.isOpen) return;
    if (!bloxity.isLoggedIn()) this.friends = [];
    this.repaint();
    void this.loadFriends();
    void this.loadBalance();
  }

  dispose(): void {
    modalLayer.unregister(this);
    this.button.remove();
    this.overlay.remove();
  }

  // --- data -------------------------------------------------------------

  private async loadFriends(): Promise<void> {
    if (!bloxity.isLoggedIn()) {
      this.friends = [];
      return;
    }
    this.friendsLoading = true;
    this.repaint();
    this.friends = await bloxity.getFriends();
    this.friendsLoading = false;
    this.repaint();
  }

  private async loadBalance(): Promise<void> {
    this.buxBalance = await bloxity.getBuxBalance();
    this.repaint();
  }

  private say(message: string): void {
    this.notice = message;
    this.repaint();
  }

  // --- rendering --------------------------------------------------------

  private repaint(): void {
    if (!this.isOpen) return;
    this.body.replaceChildren();

    if (!bloxity.available) {
      this.body.appendChild(
        section('Not connected', [
          note(
            'The Bloxity SDK is not loaded, so login, friends, avatars and Bux ' +
              'are unavailable. The game itself is unaffected.',
          ),
        ]),
      );
      return;
    }

    this.body.appendChild(this.buildAccount());
    this.body.appendChild(this.buildFriends());
    this.body.appendChild(this.buildRoomPlayers());
    this.body.appendChild(this.buildBux());

    if (this.notice) this.body.appendChild(note(this.notice));
  }

  private buildAccount(): HTMLElement {
    const user = bloxity.getUser();
    const guest = user ? null : bloxity.getGuest();

    const row = document.createElement('div');
    row.className = 'obby-blox__account';

    const pfp = resolvePfpUrl(user?.pfp ?? guest?.pfp ?? '');
    if (pfp) {
      const img = document.createElement('img');
      img.src = pfp;
      img.alt = '';
      img.className = 'obby-blox__pfp';
      row.appendChild(img);
    }

    const names = document.createElement('div');
    names.className = 'obby-blox__names';
    const primary = document.createElement('div');
    primary.className = 'obby-blox__name';
    primary.textContent = (user ? visibleName(user) : visibleName(guest)) || (user ? 'Bloxity player' : 'Guest');
    const secondary = document.createElement('div');
    secondary.className = 'obby-blox__handle';
    // The account's own handle is not shown: a player is their DISPLAY NAME
    // here and everywhere else in the game.
    secondary.textContent = user ? 'Signed in to Bloxity' : 'Playing as a guest';
    names.append(primary, secondary);
    row.appendChild(names);

    const actions = document.createElement('div');
    actions.className = 'obby-blox__actions';
    if (user) {
      actions.appendChild(
        button('Log out', 'ghost', () => {
          bloxity.logout();
          this.say('Logged out.');
        }),
      );
    } else {
      actions.appendChild(
        button('Log in', 'primary', async () => {
          const result = await bloxity.showAuthPopup();
          this.say(result ? `Welcome, ${displayNameOf(result)}.` : 'Login cancelled.');
        }),
      );
    }
    actions.appendChild(button('Customise', 'ghost', () => bloxity.showCustomizer()));
    row.appendChild(actions);

    return section('Account', [row]);
  }

  private buildFriends(): HTMLElement {
    const children: HTMLElement[] = [];

    const linkRow = document.createElement('div');
    linkRow.className = 'obby-blox__actions';
    linkRow.appendChild(
      button('Copy invite link', 'ghost', async () => {
        const link = bloxity.getInviteFriendsLink();
        if (!link) {
          this.say('No invite link available yet.');
          return;
        }
        try {
          await navigator.clipboard.writeText(link);
          this.say('Invite link copied.');
        } catch {
          // Clipboard access is refused in plenty of contexts; showing the URL
          // still lets the player copy it by hand.
          this.say(link);
        }
      }),
    );
    children.push(linkRow);

    if (!bloxity.isLoggedIn()) {
      children.push(note('Log in to see who is online.'));
      return section('Friends', children);
    }
    if (this.friendsLoading) {
      children.push(note('Loading friends…'));
      return section('Friends', children);
    }
    if (this.friends.length === 0) {
      children.push(note('No friends yet. Add some on bloxity.io.'));
      return section('Friends', children);
    }

    for (const friend of this.friends) {
      const row = document.createElement('div');
      row.className = 'obby-blox__friend';

      if (friend.pfp) {
        const img = document.createElement('img');
        img.src = resolvePfpUrl(friend.pfp);
        img.alt = '';
        img.className = 'obby-blox__pfp obby-blox__pfp--small';
        row.appendChild(img);
      }

      const names = document.createElement('div');
      names.className = 'obby-blox__names';
      const primary = document.createElement('div');
      primary.className = 'obby-blox__name';
      primary.textContent = visibleName(friend) || 'Bloxity friend';
      const status = document.createElement('div');
      status.className = `obby-blox__status obby-blox__status--${presenceClass(friend)}`;
      status.textContent = presenceLabel(friend);
      names.append(primary, status);
      row.appendChild(names);

      row.appendChild(
        button('Invite', 'primary', async () => {
          const ok = await bloxity.inviteFriend(friend._id);
          this.say(
            ok
              ? `Invited ${visibleName(friend) || 'your friend'}.`
              : `Could not invite ${visibleName(friend) || 'your friend'}.`,
          );
        }),
      );

      children.push(row);
    }

    return section('Friends', children);
  }

  /**
   * Everyone else in this room, with an "Add friend" action.
   *
   * Only players whose Bloxity account id is known get the button: a guest has
   * no account to befriend, an existing friend needs no request, and the same
   * account open in another tab is not somebody to add. The list is read fresh
   * from the replicated room state on every repaint.
   */
  private buildRoomPlayers(): HTMLElement {
    const children: HTMLElement[] = [];
    const me = bloxity.getUser();
    const friendIds = new Set(this.friends.map((friend) => friend._id));
    const others = this.getRoomPlayers().filter((player) => player.name);

    if (others.length === 0) {
      children.push(note('Nobody else is in this room right now.'));
      return section('In this room', children);
    }

    for (const player of others) {
      const row = document.createElement('div');
      row.className = 'obby-blox__friend';

      if (player.pfp) {
        const img = document.createElement('img');
        img.src = player.pfp;
        img.alt = '';
        img.className = 'obby-blox__pfp obby-blox__pfp--small';
        row.appendChild(img);
      }

      const names = document.createElement('div');
      names.className = 'obby-blox__names';
      const primary = document.createElement('div');
      primary.className = 'obby-blox__name';
      primary.textContent = player.name;
      const detail = document.createElement('div');
      detail.className = 'obby-blox__handle';
      names.append(primary, detail);
      row.appendChild(names);

      if (!player.userId) {
        detail.textContent = 'Guest';
      } else if (me && player.userId === me._id) {
        detail.textContent = 'You, in another tab';
      } else if (friendIds.has(player.userId)) {
        detail.textContent = 'Friend';
      } else if (!bloxity.isLoggedIn()) {
        // `isLoggedIn`, not `getUser`: the SDK can hold a user object whose
        // token is missing or expired, and a friend request made with it is
        // certain to fail. This is the same gate the friends list uses.
        detail.textContent = 'Log in to add friends';
      } else {
        detail.textContent = 'Bloxity player';
        row.appendChild(
          button('Add friend', 'primary', async () => {
            const result = await bloxity.sendFriendRequest(player.userId);
            if (!result.success) {
              this.say(
                result.error
                  ? `Friend request failed: ${result.error}`
                  : `Could not add ${player.name}.`,
              );
              return;
            }
            if (result.status === 'accepted') {
              this.say(`You and ${player.name} are now friends.`);
              // They had already asked, so this completed the friendship.
              void this.loadFriends();
            } else {
              this.say(`Friend request sent to ${player.name}.`);
            }
          }),
        );
      }

      children.push(row);
    }

    return section('In this room', children);
  }

  private buildBux(): HTMLElement {
    const children: HTMLElement[] = [];

    const balance = document.createElement('div');
    balance.className = 'obby-blox__balance';
    balance.textContent =
      this.buxBalance === null ? 'Balance unavailable' : `Balance: ${this.buxBalance} Bux`;
    children.push(balance);

    for (const product of BUX_PRODUCTS) {
      const row = document.createElement('div');
      row.className = 'obby-blox__product';

      const text = document.createElement('div');
      text.className = 'obby-blox__names';
      const name = document.createElement('div');
      name.className = 'obby-blox__name';
      name.textContent = `${product.name} — ${product.wins.toLocaleString()} Wins`;
      const blurb = document.createElement('div');
      blurb.className = 'obby-blox__handle';
      blurb.textContent = product.blurb;
      text.append(name, blurb);
      row.appendChild(text);

      row.appendChild(
        button('Buy', 'primary', async () => {
          this.say(`Opening checkout for ${product.name}…`);
          // No metadata: the webhook credits the Bloxity ACCOUNT that paid,
          // never an id this browser supplies.
          const result = await bloxity.requestPurchase(product.sku);
          if (!result.success) {
            this.say(result.error ? `Purchase failed: ${result.error}` : 'Purchase cancelled.');
            return;
          }
          logger.info(SCOPE, `purchase ok sku=${product.sku} tx=${result.transactionId ?? '?'}`);
          // Nothing is granted here on purpose. Wins are server-authoritative,
          // and the Bux webhook credits them on the game server - the balance
          // arrives through the normal replicated state a moment later.
          this.say(
            `Purchase complete. ${product.wins.toLocaleString()} Wins will land shortly.`,
          );
          void this.loadBalance();
        }),
      );

      children.push(row);
    }

    return section('Bux', children);
  }
}

// --- helpers ------------------------------------------------------------

const displayNameOf = (user: LegionUser | null): string => visibleName(user) || 'player';

const presenceClass = (friend: LegionFriend): string => {
  const status = friend.presence?.status ?? 'offline';
  if (status === 'in-game' || status === 'in_game') return 'ingame';
  if (status === 'online') return 'online';
  if (status === 'away') return 'away';
  return 'offline';
};

const presenceLabel = (friend: LegionFriend): string => {
  const presence = friend.presence;
  const status = presence?.status ?? 'offline';
  if (status === 'in-game' || status === 'in_game') {
    return presence?.gameName ? `In ${presence.gameName}` : 'In a game';
  }
  if (status === 'online') return 'Online';
  if (status === 'away') return 'Away';
  return 'Offline';
};

const section = (title: string, children: HTMLElement[]): HTMLElement => {
  const wrap = document.createElement('div');
  wrap.className = 'obby-blox__section';
  const heading = document.createElement('div');
  heading.className = 'obby-blox__heading';
  heading.textContent = title;
  wrap.append(heading, ...children);
  return wrap;
};

const note = (text: string): HTMLElement => {
  const node = document.createElement('div');
  node.className = 'obby-blox__note';
  node.textContent = text;
  return node;
};

const button = (
  label: string,
  kind: 'primary' | 'ghost',
  onClick: () => void | Promise<void>,
): HTMLButtonElement => {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = `obby-blox__action obby-blox__action--${kind}`;
  node.textContent = label;
  node.addEventListener('click', () => void onClick());
  return node;
};

let stylesInjected = false;

const injectStyles = (): void => {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
/* Launcher tile, matching the rest of the left rail. */
.obby-blox-btn {
  position: fixed;
  left: calc(var(--obby-safe-l, 0px) + 12px * var(--obby-ui-scale, 1));
  top: calc(50% + (var(--obby-rail-top, 386px) - var(--obby-rail-center, 262px)) * var(--obby-ui-scale, 1));
  width: calc(68px * var(--obby-ui-scale, 1));
  height: calc(68px * var(--obby-ui-scale, 1));
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: calc(3px * var(--obby-ui-scale, 1)) solid #ffffff;
  border-radius: calc(13px * var(--obby-ui-scale, 1));
  background-color: #2f6bd8;
  background-image: linear-gradient(180deg, rgba(255, 255, 255, 0.3), rgba(0, 0, 0, 0.3));
  color: #ffffff;
  font: 900 calc(12px * var(--obby-ui-scale, 1))/1 system-ui, "Segoe UI", Roboto, sans-serif;
  text-shadow: 0 2px 0 #16202e, 0 -1px 0 #16202e, 1px 0 0 #16202e, -1px 0 0 #16202e;
  box-shadow: 0 4px 0 rgba(0, 0, 0, 0.45);
  cursor: pointer;
  z-index: 21;
}
.obby-blox-btn__icon { font-size: calc(34px * var(--obby-ui-scale, 1)); line-height: 1; }
.obby-blox-btn__label { margin-top: calc(2px * var(--obby-ui-scale, 1)); }
.obby-blox-btn:hover { filter: brightness(1.1); }
.obby-blox-btn:active { transform: translateY(3px); box-shadow: none; }
.obby-blox-btn--open { outline: 3px solid rgba(255, 255, 255, 0.75); outline-offset: 2px; }

.obby-blox {
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
/* A class selector outranks the user-agent [hidden] rule; without this the
   display:flex above wins and the panel can never be closed from script. */
.obby-blox[hidden] { display: none; }

.obby-blox__card {
  width: min(560px, 94vw);
  max-height: 84vh;
  display: flex;
  flex-direction: column;
  background: #060a14;
  border: 5px solid #b9d2ff;
  border-radius: 12px;
  box-shadow: 0 16px 44px rgba(0, 0, 0, 0.6);
  overflow: hidden;
}
.obby-blox__header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px 9px;
  border-bottom: 3px solid #2b3d63;
}
.obby-blox__title {
  flex: 1;
  font-size: 29px;
  font-weight: 900;
  color: #ffffff;
  text-shadow: 0 3px 0 #16202e, 0 -2px 0 #16202e, 2px 0 0 #16202e, -2px 0 0 #16202e;
}
.obby-blox__close {
  width: 44px;
  height: 40px;
  flex: none;
  border: 4px solid #ffffff;
  border-radius: 9px;
  background-color: #ee2b3c;
  color: #ffffff;
  font: 900 21px/1 system-ui, sans-serif;
  box-shadow: 0 4px 0 rgba(0, 0, 0, 0.45);
  cursor: pointer;
}
.obby-blox__close:active { transform: translateY(3px); box-shadow: none; }

.obby-blox__body { overflow-y: auto; padding: 10px; display: grid; gap: 12px; }
.obby-blox__section { display: grid; gap: 7px; }
.obby-blox__heading {
  font-size: 13px;
  font-weight: 900;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #7fa6e8;
}
.obby-blox__account,
.obby-blox__friend,
.obby-blox__product {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px;
  border: 3px solid #2b3d63;
  border-radius: 10px;
  background: #0c1526;
}
.obby-blox__pfp {
  width: 46px;
  height: 46px;
  flex: none;
  border-radius: 50%;
  border: 3px solid #3aa8ff;
  object-fit: cover;
}
.obby-blox__pfp--small { width: 34px; height: 34px; border-width: 2px; }
.obby-blox__names { flex: 1; min-width: 0; }
.obby-blox__name {
  font-size: 15px;
  font-weight: 900;
  color: #ffffff;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.obby-blox__handle { font-size: 12px; color: #8fa8cc; }
.obby-blox__status { font-size: 12px; font-weight: 700; }
.obby-blox__status--online { color: #57d977; }
.obby-blox__status--ingame { color: #ffd75e; }
.obby-blox__status--away { color: #ffa726; }
.obby-blox__status--offline { color: #6b7d99; }
.obby-blox__actions { display: flex; gap: 7px; flex-wrap: wrap; }
.obby-blox__action {
  border: 3px solid #ffffff;
  border-radius: 9px;
  padding: 7px 12px;
  font: 900 13px/1 system-ui, sans-serif;
  color: #ffffff;
  cursor: pointer;
  box-shadow: 0 3px 0 rgba(0, 0, 0, 0.45);
}
.obby-blox__action--primary { background-color: #35b559; }
.obby-blox__action--ghost { background-color: #2f4f86; }
.obby-blox__action:hover { filter: brightness(1.12); }
.obby-blox__action:active { transform: translateY(2px); box-shadow: none; }
.obby-blox__note { font-size: 13px; color: #9fb6d6; line-height: 1.45; }
.obby-blox__balance { font-size: 15px; font-weight: 900; color: #ffa726; }
`;
  document.head.appendChild(style);
};
