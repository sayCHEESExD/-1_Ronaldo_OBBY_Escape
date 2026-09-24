import { logger } from '../util/logger.js';
import { API_URL, GAME_SLUG, PORTAL_URL, resolveProportions } from './bloxityConfig.js';
import type {
  LegionEquipped,
  LegionFriend,
  LegionFriendRequestResult,
  LegionGuest,
  LegionInviteLinkOptions,
  LegionPlayerEvent,
  LegionProportions,
  LegionPurchaseResult,
  LegionSdk,
  LegionUser,
  Unsubscribe,
} from './sdkTypes.js';

const SCOPE = 'Bloxity';

const NOOP: Unsubscribe = () => undefined;

/**
 * The single point of contact with `window.Legion`.
 *
 * Everything else in the client imports this object, never the global - the
 * same containment the project already applies to colyseus.js. Two things fall
 * out of that: the SDK can be swapped or stubbed in one file, and the "is it
 * even loaded?" question is answered once instead of at forty call sites.
 *
 * ABSENCE IS NORMAL. The script comes from a third-party CDN, so it can be
 * blocked, offline or simply missing on a developer's machine - and this is a
 * playable game either way. Every method below therefore degrades to a no-op
 * or a documented empty value rather than throwing, and `available` lets the
 * UI hide what it cannot offer. Nothing in the game's own loop depends on it.
 *
 * The user object is deliberately NOT cached. `getUser()` is cheap and the SDK
 * is the owner of that state; a copy held here would be one login away from
 * being wrong.
 */
class BloxitySdkFacade {
  private sdk: LegionSdk | null = null;
  private initialised = false;

  /** True once `init` has found the script and initialised it. */
  get available(): boolean {
    return this.sdk !== null;
  }

  /**
   * Initialise the SDK exactly once, before any namespace is used.
   *
   * Safe to call again: the second call returns the same answer instead of
   * re-initialising, because the SDK installs window listeners on init and a
   * second pass would double them.
   */
  init(): boolean {
    if (this.initialised) return this.available;
    this.initialised = true;

    const sdk = window.Legion?.SDK;
    if (!sdk || typeof sdk.init !== 'function') {
      logger.warn(
        SCOPE,
        'SDK script not present - running without Bloxity (login, friends, ' +
          'avatar, portal settings and Bux are unavailable)',
      );
      return false;
    }

    try {
      // The slug is passed even when embedded, where the portal would supply
      // it: standalone hosting and every Bux purchase resolve their catalog by
      // it. The two URLs are normally absent, and the SDK resolves them - see
      // `PORTAL_URL`.
      sdk.init({
        gameSlug: GAME_SLUG,
        ...(PORTAL_URL ? { portalUrl: PORTAL_URL } : {}),
        ...(API_URL ? { apiUrl: API_URL } : {}),
      });
    } catch (error: unknown) {
      logger.error(SCOPE, 'init failed', error);
      return false;
    }

    this.sdk = sdk;
    logger.info(
      SCOPE,
      `initialised gameSlug="${GAME_SLUG}" ` +
        `mode=${sdk.portal.isEmbeddedInLegion() ? 'embedded' : 'standalone'}`,
    );
    return true;
  }

  // --- auth -------------------------------------------------------------

  /** The signed-in account, or null. Never cached - always read through. */
  getUser(): LegionUser | null {
    return this.sdk?.auth.getUser() ?? null;
  }

  /** The JWT for this game's own backend, or null. */
  getToken(): string | null {
    return this.sdk?.auth.getToken() ?? null;
  }

  isLoggedIn(): boolean {
    return this.sdk?.auth.isLoggedIn() ?? false;
  }

  /** The portal's identity for a signed-out player: still a name and a face. */
  getGuest(): LegionGuest | null {
    return this.sdk?.auth.getGuest?.() ?? null;
  }

  /** Open login. Picks the in-game modal or a popup window by environment. */
  async showAuthPopup(): Promise<LegionUser | null> {
    if (!this.sdk) return null;
    try {
      return await this.sdk.auth.showAuthPopup();
    } catch (error: unknown) {
      logger.error(SCOPE, 'login failed', error);
      return null;
    }
  }

  logout(): void {
    this.sdk?.auth.logout();
  }

  /**
   * The single source of truth for auth state.
   *
   * Fires immediately with the current user, then on every login and logout,
   * so a subscriber never has to read the state separately first.
   */
  onUserChanged(cb: (user: LegionUser | null) => void): Unsubscribe {
    if (!this.sdk) {
      // Still fire once, so a caller's "no user" path runs identically whether
      // the SDK is missing or the player is simply signed out.
      cb(null);
      return NOOP;
    }
    return this.sdk.auth.onUserChanged(cb);
  }

  /** Hand the identity to this game's own server to verify. */
  async authenticateWithServer(url: string): Promise<unknown | null> {
    if (!this.sdk) return null;
    try {
      return await this.sdk.auth.authenticateWithServer(url);
    } catch (error: unknown) {
      logger.error(SCOPE, 'server authentication failed', error);
      return null;
    }
  }

  // --- avatar -----------------------------------------------------------

  /**
   * What the player is wearing - signed in OR as a guest.
   *
   * The SDK's own `avatar.getEquipped()` reads only a logged-in user and
   * reports `skinId: '-1'` for everybody else, which would dress every guest
   * as the default avatar whatever they picked. A guest's selection lives on
   * the guest identity instead, so that is where it is read from.
   */
  getEquipped(): LegionEquipped {
    if (!this.sdk) return {};
    if (this.sdk.auth.getUser()) return this.sdk.avatar.getEquipped();
    return this.getGuest()?.avatar ?? this.sdk.avatar.getEquipped();
  }

  /** Always seven numbers: the SDK returns `{}` before the player customises. */
  getProportions(): Required<LegionProportions> {
    if (!this.sdk) return resolveProportions(null);
    // The SDK's live state first - it is what the customizer writes to. A
    // guest whose state is still empty falls back to their saved selection.
    const live = this.sdk.avatar.getProportions();
    if (Object.keys(live ?? {}).length > 0 || this.sdk.auth.getUser()) return resolveProportions(live);
    return resolveProportions(this.getGuest()?.avatar?.proportions);
  }

  async setProportions(partial: LegionProportions): Promise<void> {
    if (!this.sdk) return;
    try {
      await this.sdk.avatar.setProportions(partial);
    } catch (error: unknown) {
      logger.error(SCOPE, 'setProportions failed', error);
    }
  }

  async resetProportions(): Promise<void> {
    if (!this.sdk) return;
    try {
      await this.sdk.avatar.resetProportions();
    } catch (error: unknown) {
      logger.error(SCOPE, 'resetProportions failed', error);
    }
  }

  onAvatarChanged(cb: (equipped: LegionEquipped) => void): Unsubscribe {
    return this.sdk?.avatar.onAvatarChanged(cb) ?? NOOP;
  }

  onProportionsChanged(cb: (p: Required<LegionProportions>) => void): Unsubscribe {
    if (!this.sdk) return NOOP;
    return this.sdk.avatar.onProportionsChanged((raw) => cb(resolveProportions(raw)));
  }

  showCustomizer(): void {
    this.sdk?.avatar.showCustomizer();
  }

  hideCustomizer(): void {
    this.sdk?.avatar.hideCustomizer();
  }

  toggleCustomizer(): void {
    this.sdk?.avatar.toggleCustomizer();
  }

  isCustomizerOpen(): boolean {
    return this.sdk?.avatar.isCustomizerOpen() ?? false;
  }

  // --- social -----------------------------------------------------------

  async getFriends(): Promise<LegionFriend[]> {
    if (!this.sdk) return [];
    try {
      return await this.sdk.social.getFriends();
    } catch (error: unknown) {
      logger.error(SCOPE, 'getFriends failed', error);
      return [];
    }
  }

  async inviteFriend(userId: string): Promise<boolean> {
    if (!this.sdk) return false;
    try {
      return await this.sdk.social.inviteFriend(userId);
    } catch (error: unknown) {
      logger.error(SCOPE, 'inviteFriend failed', error);
      return false;
    }
  }

  getInviteFriendsLink(options?: LegionInviteLinkOptions): string {
    if (!this.sdk) return '';
    try {
      return this.sdk.social.getInviteFriendsLink(options);
    } catch (error: unknown) {
      logger.error(SCOPE, 'getInviteFriendsLink failed', error);
      return '';
    }
  }

  async sendFriendRequest(userId: string): Promise<LegionFriendRequestResult> {
    if (!this.sdk) return { success: false, error: 'Bloxity unavailable' };
    try {
      return await this.sdk.social.sendFriendRequest(userId);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  }

  // --- settings ---------------------------------------------------------

  /** Subscribe to one portal setting. Fires immediately, then on change. */
  listenSetting(key: string, cb: (value: string) => void): Unsubscribe {
    return this.sdk?.settings.listen(key, cb) ?? NOOP;
  }

  getSetting(key: string): string {
    return this.sdk?.settings.get(key) ?? '';
  }

  getAllSettings(): Record<string, string> {
    return this.sdk?.settings.getAll() ?? {};
  }

  /** Re-fire every registered listener with the current value. */
  triggerAllSettings(): void {
    this.sdk?.settings.triggerAll();
  }

  /**
   * Re-pull settings from their source of truth.
   *
   * Settings are SYNCED per account, so a player who logs in mid-session has a
   * different set from the guest defaults they started with. The SDK does not
   * re-pull on its own when the user changes; listeners registered with
   * `listenSetting` receive whatever arrives.
   */
  refreshSettings(): void {
    this.sdk?.settings.refresh();
  }

  // --- game lifecycle ---------------------------------------------------

  loadingStep(text: string): void {
    this.sdk?.game.loadingStep(text);
  }

  loadingEnd(): void {
    this.sdk?.game.loadingEnd();
  }

  gameplayStart(): void {
    this.sdk?.game.gameplayStart();
  }

  gameplayEnd(): void {
    this.sdk?.game.gameplayEnd();
  }

  /** Announce the joinable room, or `''` while in a menu. */
  updateRoom(roomId: string, partyId?: string): void {
    if (!this.sdk) return;
    if (partyId === undefined) this.sdk.game.updateRoom(roomId);
    else this.sdk.game.updateRoom(roomId, partyId);
  }

  playerJoined(username: string): void {
    if (username) this.sdk?.game.playerJoined(username);
  }

  playerInRoom(username: string): void {
    if (username) this.sdk?.game.playerInRoom(username);
  }

  // --- player events ----------------------------------------------------

  onPlayerEvent(cb: (event: LegionPlayerEvent, data?: unknown) => void): Unsubscribe {
    return this.sdk?.player.onEvent(cb) ?? NOOP;
  }

  // --- bux --------------------------------------------------------------

  /**
   * Ask the portal to sell `sku`.
   *
   * The SKU is all that is sent: the price lives in the server-side catalog
   * keyed by game slug, so a client cannot name its own price - which is the
   * same reason nothing in this game's own economy is decided client-side.
   */
  async requestPurchase(
    sku: string,
    metadata?: Record<string, unknown>,
  ): Promise<LegionPurchaseResult> {
    if (!this.sdk) return { success: false, error: 'Bloxity unavailable' };
    try {
      return await this.sdk.bux.requestPurchase(sku, metadata);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(SCOPE, `purchase "${sku}" failed`, error);
      return { success: false, error: message };
    }
  }

  async getBuxBalance(): Promise<number | null> {
    if (!this.sdk) return null;
    try {
      return await this.sdk.bux.getBalance();
    } catch (error: unknown) {
      logger.error(SCOPE, 'getBalance failed', error);
      return null;
    }
  }

  // --- portal -----------------------------------------------------------

  isEmbedded(): boolean {
    return this.sdk?.portal.isEmbeddedInLegion() ?? false;
  }

  isInIframe(): boolean {
    return this.sdk?.portal.isInIframe() ?? false;
  }

  /** Open the portal's own pause menu. `true` re-locks the cursor on resume. */
  showPortalMenu(lockCursorOnResume = true): void {
    this.sdk?.portal.showMenu(lockCursorOnResume);
  }

  requestFullscreen(): void {
    this.sdk?.portal.requestFullscreen();
  }

  exitFullscreen(): void {
    this.sdk?.portal.exitFullscreen();
  }

  /** Portal-driven pointer-lock changes, where this build of the SDK sends them. */
  onPointerLockChanged(cb: (locked: boolean) => void): Unsubscribe {
    return this.sdk?.portal.onPointerLockChanged?.(cb) ?? NOOP;
  }

  // --- raw API ----------------------------------------------------------

  /** Authenticated call to api.bloxity.io. The bearer token is attached for us. */
  async apiGet(path: string): Promise<unknown> {
    if (!this.sdk) return null;
    return this.sdk.api.get(path);
  }
}

export const bloxity = new BloxitySdkFacade();

/**
 * The name a player is shown as - Bloxity's own rule, exactly.
 *
 * Every place the Bloxity SDK shows a person it uses `displayName || username`,
 * and its documented way to label the current player is `username`: an
 * account is NOT guaranteed to carry a `displayName`. Requiring one left every
 * signed-in account without it nameless - no plate overhead and "Player" on
 * the scoreboards. So: the display name when there is one, otherwise the
 * username, never with a leading `@`, and never an internal or account id.
 */
export const visibleName = (
  person: { readonly displayName?: string | null; readonly username?: string | null } | null | undefined,
): string => {
  const clean = (value: string | null | undefined): string => (value ?? '').trim().replace(/^@+/, '').trim();
  return clean(person?.displayName) || clean(person?.username);
};
