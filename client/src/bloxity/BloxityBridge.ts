import { logger } from '../util/logger.js';
import type { PlayerCharacter } from '../player/PlayerCharacter.js';
import { encodeAvatarLook, parseAvatarLook, type AvatarLook } from '@obby/shared';
import { bloxity, visibleName } from './BloxitySdk.js';
import { BloxityPanel, type RoomPlayer } from './BloxityPanel.js';
import {
  SETTING_KEYS,
  avatarPfpUrl,
  resolvePfpUrl,
  settingBool,
  settingNumber,
} from './bloxityConfig.js';
import type { LegionEquipped, LegionUser, Unsubscribe } from './sdkTypes.js';

const SCOPE = 'BloxityBridge';

/**
 * What the game exposes to the Bloxity layer.
 *
 * A narrow interface rather than the `Game` object: the bridge is wiring, and
 * wiring that could reach into the whole composition root would end up holding
 * gameplay logic. Everything here is a setting the portal can move or an
 * action it can ask for - nothing reads game state back.
 */
export interface BloxityHost {
  /** Master volume, 0..1. */
  setMasterVolume(level: number): void;
  /** Music volume, 0..1, independent of the master. */
  setMusicVolume(level: number): void;
  /** 'Low' | 'Medium' | 'High' | 'Ultra'. */
  setGraphicsQuality(level: string): void;
  setShowFps(visible: boolean): void;
  /** Multiplier on the game's own mouse sensitivity. */
  setCameraSensitivity(scale: number): void;
  /** Opacity for the game's own panel backdrops, 0..1. */
  setPanelOpacity(opacity: number): void;
  /** Ask the game to put the player back at spawn. */
  respawn(): void;
  /** The local character, once it exists, for the avatar layer to dress. */
  getCharacterForAvatar(): PlayerCharacter | null;
  /**
   * The portal took the pointer for its own menu (false) or handed it back
   * (true). The game's pointer-lock owner decides what that means for it.
   */
  setPortalPointerLock(locked: boolean): void;
  /** Tell the room who this player is now, e.g. after a login. Cosmetic only. */
  updateIdentity(name: string, userId: string, pfp: string): void;
  /**
   * The LOGIN may have changed: have the room re-check `loginToken`, so the
   * session moves onto the signed-in account's profile (or back to the
   * browser's own on sign-out).
   */
  updateLogin(): void;
  /** Tell the room how this player is dressed now (`encodeAvatarLook`). Cosmetic only. */
  setAvatarLook(look: string): void;
  /** Everyone else in the room right now. */
  getRoomPlayers(): readonly RoomPlayer[];
}

/**
 * Everything this game does with Bloxity, in one place.
 *
 * ONE `onUserChanged` subscription is the source of truth for identity: the
 * panel, the friends list, the avatar and the Bux balance all hang off it
 * rather than each asking separately, so they cannot disagree about who is
 * playing. Nothing here caches the user - the callback is a signal to re-read,
 * not a copy to keep.
 *
 * The bridge owns no gameplay rules. Portal settings are forwarded to the
 * subsystem that owns each one, portal events are forwarded as requests, and
 * the game's own authority is untouched: a Bux purchase asks the portal to
 * charge and the game SERVER to credit, and this file never grants anything.
 */
export class BloxityBridge {
  private readonly host: BloxityHost;
  private readonly panel: BloxityPanel;
  private readonly chat: ChatFeed;
  private readonly subscriptions: Unsubscribe[] = [];

  /** The equipment the SDK last announced through `onAvatarChanged`. */
  private equipped: LegionEquipped | null = null;
  private chatEnabled = true;
  private started = false;

  /**
   * The account id seen on the last `onUserChanged`, or `undefined` before the
   * first one.
   *
   * The callback fires immediately with the CURRENT state as well as on real
   * changes. That first call must still dress the avatar, but re-pulling
   * settings or re-announcing an identity the room already has would be a
   * redundant round-trip on every boot.
   */
  private lastUserId: string | null | undefined = undefined;

  constructor(container: HTMLElement, host: BloxityHost, menuKey: string) {
    this.host = host;
    this.panel = new BloxityPanel(container, {
      menuKey,
      getRoomPlayers: () => host.getRoomPlayers(),
    });
    this.chat = new ChatFeed(container);
  }

  /** The panel, so the composition root can bind its keyboard shortcut. */
  get menuPanel(): BloxityPanel {
    return this.panel;
  }

  /**
   * Subscribe to everything. Call once, after the world and player exist.
   *
   * Deliberately tolerant of the SDK being absent: every subscription below
   * degrades to a no-op, so this runs unconditionally and the game has exactly
   * one code path whether or not the portal is there.
   */
  start(): void {
    if (this.started) return;
    this.started = true;

    this.subscribeAuth();
    this.subscribeAvatar();
    this.subscribeSettings();
    this.subscribePlayerEvents();

    // Apply everything the portal already knows, now that the listeners exist.
    bloxity.triggerAllSettings();
    logger.info(SCOPE, `wired (sdk ${bloxity.available ? 'present' : 'absent'})`);
  }

  /**
   * The name to introduce this player by.
   *
   * Guests are named too, so there is always something better than an empty
   * string - which the SDK would ignore anyway.
   */
  get playerName(): string {
    const user = bloxity.getUser();
    // Display name only. A signed-in account without one stays unnamed rather
    // than being shown by its @handle.
    if (user) return visibleName(user);
    return visibleName(bloxity.getGuest());
  }

  /** The signed-in account's id, or empty for a guest. Read through, never cached. */
  get playerUserId(): string {
    return bloxity.getUser()?._id ?? '';
  }

  /**
   * The portal's login token, or '' for a guest - read through, never cached.
   *
   * What the SERVER verifies with Bloxity to decide whose progress this is.
   * `playerUserId` above is only a label: an id the browser reports is an id
   * the browser chose, so progression is never keyed on it.
   */
  get loginToken(): string {
    return bloxity.getToken() ?? '';
  }

  /**
   * The player's Bloxity avatar URL, signed in or not.
   *
   * Guests have a portal-generated picture as well as a name, so this is
   * rarely empty - which is what lets the scoreboards show a face for
   * everybody rather than only for signed-in players.
   */
  get playerPfp(): string {
    // Rendered from the avatar actually being worn, so it follows every
    // change the player makes. Without the SDK there is no avatar to render,
    // and the stored picture (if any) is the best there is.
    if (bloxity.available) return avatarPfpUrl(this.avatarLook);
    const user = bloxity.getUser();
    if (user?.pfp) return resolvePfpUrl(user.pfp);
    return resolvePfpUrl(bloxity.getGuest()?.pfp ?? '');
  }

  /** Announce the joinable room so a friend's invite lands in the right one. */
  setRoom(roomId: string): void {
    bloxity.updateRoom(roomId);
  }

  /** A remote player arrived while we were already here. */
  playerJoined(name: string): void {
    bloxity.playerJoined(name);
  }

  /** A remote player was already here when we joined. */
  playerInRoom(name: string): void {
    bloxity.playerInRoom(name);
  }

  dispose(): void {
    for (const unsubscribe of this.subscriptions) unsubscribe();
    this.subscriptions.length = 0;
    this.panel.dispose();
    this.chat.dispose();
    bloxity.gameplayEnd();
  }

  // --- subscriptions ----------------------------------------------------

  private subscribeAuth(): void {
    this.subscriptions.push(
      bloxity.onUserChanged((user: LegionUser | null) => {
        logger.info(
          SCOPE,
          user
            ? `signed in as "${visibleName(user)}" (displayName ${user.displayName ? 'set' : 'absent'}, username ${user.username ? 'set' : 'absent'})`
            : 'signed out (playing as guest)',
        );
        // Identity decides the avatar, the friends list and the balance, so
        // they are all refreshed from this one place rather than separately.
        // The panel re-reads the user itself; this only tells it when to.
        this.applyAvatar();
        this.panel.reloadData();

        // EVERY announcement is passed on: the network layer compares it with
        // what the room actually has and sends only a real difference. This
        // must not be gated on the account id changing - the SDK announces
        // one login more than once (restored, then refreshed from its API),
        // and the one that finally carries the display name has the same id.
        this.host.updateIdentity(this.playerName, this.playerUserId, this.playerPfp);
        // AND whose progress this is. The server verifies the token with
        // Bloxity and moves the session onto the account's profile. Deduped by
        // the network layer, so a repeated announcement sends nothing.
        this.host.updateLogin();

        const userId = user?._id ?? null;
        const changed = this.lastUserId !== undefined && userId !== this.lastUserId;
        this.lastUserId = userId;
        // A different account wears different things. The SDK announces the
        // new equipment right after this; until it does, fall back to the
        // user object rather than dress the new account in the old one's look.
        if (changed) {
          this.equipped = null;
          this.applyAvatar();
        }
        // Settings are synced PER ACCOUNT, so a login brings a different set
        // from the guest defaults. Re-pull them; the registered listeners
        // apply whatever arrives.
        if (changed) bloxity.refreshSettings();
      }),
    );
  }

  private subscribeAvatar(): void {
    this.subscriptions.push(
      // The SDK hands every listener its current equipment - `{...state.equipped}`
      // from the customizer, the portal handshake or its API - and documents it
      // as what the game should dress the character in. `getEquipped()` reads a
      // DIFFERENT copy (the user object's `avatar`), which is not updated by
      // those paths; re-reading it here is what left every player on the
      // default look and every scoreboard row on the same default icon.
      bloxity.onAvatarChanged((equipped) => {
        this.equipped = equipped;
        this.applyAvatar();
      }),
      bloxity.onProportionsChanged(() => this.applyAvatar()),
    );
  }

  private subscribeSettings(): void {
    for (const key of SETTING_KEYS) {
      this.subscriptions.push(
        bloxity.listenSetting(key, (value) => this.applySetting(key, value)),
      );
    }
  }

  private subscribePlayerEvents(): void {
    this.subscriptions.push(
      bloxity.onPlayerEvent((event, data) => {
        switch (event) {
          case 'respawn_request':
            // A request, not a teleport. It goes through the game's own
            // respawn path so the server still owns where the player lands.
            this.host.respawn();
            return;
          case 'chat_message_sent':
            if (this.chatEnabled && typeof data === 'string') this.chat.push(data);
            return;
          case 'pointer_lock_changed':
            // NOT informational. The SDK emits this only when the PORTAL takes
            // the pointer for its pause menu (false) or hands it back (true) -
            // it never echoes the game's own lock changes. Unhandled, the
            // game's pointer-lock owner treats the portal's release as an
            // accidental one and grabs the pointer straight back, behind the
            // portal's own menu.
            this.host.setPortalPointerLock(data === true);
            return;
          default:
            return;
        }
      }),
      // `portal.onPointerLockChanged` is deliberately NOT subscribed as well:
      // in this SDK it feeds from the very same emitter as the event above,
      // so listening to both would handle every portal handoff twice.
    );
  }

  // --- settings ---------------------------------------------------------

  /** Route one portal setting to whichever subsystem owns it. */
  private applySetting(key: string, value: string): void {
    switch (key) {
      case 'master_volume':
        this.host.setMasterVolume(settingNumber(value, 80) / 100);
        return;
      case 'music_volume':
        this.host.setMusicVolume(settingNumber(value, 80) / 100);
        return;
      case 'graphics_quality':
        this.host.setGraphicsQuality(value);
        return;
      case 'show_fps':
        this.host.setShowFps(settingBool(value));
        return;
      case 'camera_sensitivity':
        this.host.setCameraSensitivity(settingNumber(value, 1));
        return;
      case 'enable_chat':
        this.chatEnabled = settingBool(value, true);
        if (!this.chatEnabled) this.chat.clear();
        return;
      case 'fullscreen':
        // The portal owns the frame this game is in, so fullscreen is asked
        // for rather than taken - the Fullscreen API would only ever expand
        // the iframe's own document.
        if (settingBool(value)) bloxity.requestFullscreen();
        else bloxity.exitFullscreen();
        return;
      case 'background_transparency':
        // Applied to this game's own panel backdrops, NOT to the WebGL clear
        // colour: the canvas is created without an alpha buffer (the sky is
        // opaque art, not a background to see through), and turning that on
        // would be a rendering change rather than a setting.
        this.host.setPanelOpacity(settingNumber(value, 0.9));
        return;
      default:
        return;
    }
  }

  // --- avatar -----------------------------------------------------------

  /**
   * The player's current Bloxity look - skin, hat, back, proportions - read
   * through the SDK every time, never cached. Signed in or guest alike.
   */
  get avatarLook(): AvatarLook {
    // What the SDK last ANNOUNCED the player wearing, when it has announced
    // anything; `getEquipped()` only as the fallback before that.
    const equipped = this.equipped ?? bloxity.getEquipped();
    // Through the same shared cleaner the server applies to remote looks: the
    // SDK marks an empty slot '-1', and passed through raw that became a
    // picture key of "_h-1_b-1_hd-1..." and a request for a hat called "-1".
    return parseAvatarLook(encodeAvatarLook({
      skin: equipped.skinId ?? '',
      hat: equipped.hatId ?? '',
      back: equipped.backId ?? '',
      // Which Bloxity body-part model fills each slot - the SDK's own fields.
      parts: {
        head: equipped.headId ?? '',
        torso: equipped.torsoId ?? '',
        armL: equipped.armLId ?? '',
        armR: equipped.armRId ?? '',
        legL: equipped.legLId ?? '',
        legR: equipped.legRId ?? '',
      },
      proportions: bloxity.getProportions(),
    }));
  }

  /**
   * Dress the local character in the player's Bloxity look, and tell the
   * room, so every other client dresses them identically.
   *
   * Runs after the character's own material exists, so nothing the model
   * loader set up can overwrite it afterwards.
   */
  private applyAvatar(): void {
    const look = this.avatarLook;
    this.host.setAvatarLook(encodeAvatarLook(look));
    // The picture on the scoreboards is a render of this look, so a changed
    // avatar is a changed picture. The network layer drops no-op updates.
    this.host.updateIdentity(this.playerName, this.playerUserId, this.playerPfp);
    const character = this.host.getCharacterForAvatar();
    if (!character) return;
    // The character's own appearance layer: while a Ronaldo is worn it only
    // records the look, which is what every other client does with it too.
    character.appearance.applyLook(look);
  }
}

/**
 * Portal chat, shown as a short stack of lines above the HUD.
 *
 * This game has no chat of its own - messages are composed in the portal and
 * arrive as an event - so all that is needed is somewhere to read them. Lines
 * expire on their own so the feed can never grow over the play area.
 */
class ChatFeed {
  private readonly root: HTMLElement;
  private readonly timers = new Set<number>();

  constructor(parent: HTMLElement) {
    injectChatStyles();
    this.root = document.createElement('div');
    this.root.className = 'obby-chat';
    parent.appendChild(this.root);
  }

  push(message: string): void {
    const line = document.createElement('div');
    line.className = 'obby-chat__line';
    line.textContent = message;
    this.root.appendChild(line);

    const timer = window.setTimeout(() => {
      line.remove();
      this.timers.delete(timer);
    }, 9000);
    this.timers.add(timer);

    // Four lines is as much as can sit above the HUD without covering it.
    while (this.root.childElementCount > 4) this.root.firstElementChild?.remove();
  }

  clear(): void {
    this.root.replaceChildren();
  }

  dispose(): void {
    for (const timer of this.timers) window.clearTimeout(timer);
    this.timers.clear();
    this.root.remove();
  }
}

let chatStylesInjected = false;

const injectChatStyles = (): void => {
  if (chatStylesInjected) return;
  chatStylesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
.obby-chat {
  position: fixed;
  left: calc(var(--obby-safe-l, 0px) + 96px * var(--obby-ui-scale, 1));
  /* Above the touch stick when there is one; otherwise near the bottom edge. */
  bottom: var(--obby-chat-bottom, calc(var(--obby-safe-b, 0px) + 74px * var(--obby-ui-scale, 1)));
  display: grid;
  gap: 4px;
  max-width: min(420px, 46vw);
  pointer-events: none;
  z-index: 23;
}
.obby-chat__line {
  padding: 5px 9px;
  border-radius: 8px;
  background: rgba(8, 14, 26, 0.68);
  color: #e8f0ff;
  font: 700 13px/1.35 system-ui, "Segoe UI", Roboto, sans-serif;
  overflow-wrap: anywhere;
}
body.obby-touch-mode .obby-chat { display: none; }
`;
  document.head.appendChild(style);
};
