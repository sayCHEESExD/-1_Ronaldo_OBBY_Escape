/**
 * Type declarations for the Bloxity SDK, which ships as a plain script that
 * installs `window.Legion` and carries no types of its own.
 *
 * Declared from the live API surface rather than guessed: every member below
 * exists on `Legion.SDK` at runtime. Optional members are marked optional so a
 * newer or older build of the script cannot make this file a lie - the façade
 * in `BloxitySdk` checks before it calls.
 *
 * This is the ONLY file that describes the SDK's shape, and `BloxitySdk` is
 * the only file that reads the global. Everything else in the client talks to
 * the façade, the same way the rest of the client reaches Colyseus only
 * through `net/`.
 */

/** A signed-in Bloxity account. */
export interface LegionUser {
  _id: string;
  username: string;
  displayName?: string;
  email?: string;
  pfp?: string;
  avatar?: unknown;
}

/**
 * The identity every player has, signed in or not.
 *
 * The portal names and pictures guests too, so there is always somebody to
 * show - "not authenticated" is never the right thing to put on screen.
 */
export interface LegionGuest {
  username: string;
  displayName?: string;
  pfp?: string;
  isGuest: true;
  /**
   * The guest's own avatar selection, forwarded by the portal (or remembered
   * locally). A guest can dress up too, so this is as real as a user's.
   */
  avatar?: LegionEquipped & { proportions?: LegionProportions };
}

export type LegionPresenceStatus = 'online' | 'in-game' | 'in_game' | 'away' | 'offline';

export interface LegionPresence {
  status: LegionPresenceStatus;
  currentGame?: string;
  currentRoom?: string;
  currentParty?: string;
  gameSlug?: string;
  gameName?: string;
  lastSeen?: string;
}

export interface LegionFriend {
  _id: string;
  username: string;
  displayName?: string;
  pfp?: string;
  presence: LegionPresence;
}

/** Cosmetic and body-part slots. `-1` (or absent) means nothing equipped. */
export interface LegionEquipped {
  hatId?: string | null;
  backId?: string | null;
  skinId?: string | null;
  headId?: string | null;
  armLId?: string | null;
  armRId?: string | null;
  legLId?: string | null;
  legRId?: string | null;
  torsoId?: string | null;
}

/**
 * Body proportions, every one a multiplier around 1.
 *
 * All optional: the SDK returns `{}` for a player who has never touched the
 * customizer, so a caller that assumes seven numbers gets `undefined` and
 * multiplies a scale by NaN. `resolveProportions` fills the defaults in.
 */
export interface LegionProportions {
  height?: number;
  shoulderWidth?: number;
  armLength?: number;
  legOffsetX?: number;
  torsoScaleX?: number;
  neckHeight?: number;
  headScale?: number;
}

export interface LegionPurchaseResult {
  success: boolean;
  transactionId?: string;
  error?: string;
}

export interface LegionFriendRequestResult {
  success: boolean;
  status?: 'accepted' | 'pending';
  error?: string;
}

export interface LegionInviteLinkOptions {
  gameSlug?: string;
  roomId?: string;
  partyId?: string;
  baseUrl?: string;
  ref?: string;
}

/** Events delivered by `player.onEvent`. */
export type LegionPlayerEvent =
  | 'respawn_request'
  | 'chat_message_sent'
  | 'pointer_lock_changed';

export type Unsubscribe = () => void;

export interface LegionSdk {
  init(options: { gameSlug?: string; apiUrl?: string; portalUrl?: string }): void;

  auth: {
    getUser(): LegionUser | null;
    getToken(): string | null;
    getGuest?(): LegionGuest | null;
    isLoggedIn(): boolean;
    showAuthPopup(): Promise<LegionUser | null>;
    logout(): void;
    onUserChanged(cb: (user: LegionUser | null) => void): Unsubscribe;
    authenticateWithServer(url: string): Promise<unknown | null>;
  };

  avatar: {
    getEquipped(): LegionEquipped;
    getProportions(): LegionProportions;
    setProportions(partial: LegionProportions): Promise<unknown>;
    resetProportions(): Promise<unknown>;
    onAvatarChanged(cb: (equipped: LegionEquipped) => void): Unsubscribe;
    onProportionsChanged(cb: (proportions: LegionProportions) => void): Unsubscribe;
    showCustomizer(): void;
    hideCustomizer(): void;
    toggleCustomizer(): void;
    isCustomizerOpen(): boolean;
  };

  social: {
    getFriends(): Promise<LegionFriend[]>;
    inviteFriend(userId: string): Promise<boolean>;
    getInviteFriendsLink(options?: LegionInviteLinkOptions): string;
    sendFriendRequest(userId: string): Promise<LegionFriendRequestResult>;
  };

  settings: {
    get(key: string): string;
    getAll(): Record<string, string>;
    listen(key: string, cb: (value: string) => void): Unsubscribe;
    onChanged(cb: (settings: Record<string, string>) => void): Unsubscribe;
    triggerAll(): void;
    refresh(): void;
  };

  game: {
    loadingStep(text: string): void;
    loadingEnd(): void;
    gameplayStart(): void;
    gameplayEnd(): void;
    updateRoom(roomId: string, partyId?: string): void;
    playerJoined(username: string): void;
    playerInRoom(username: string): void;
  };

  player: {
    respawn(): void;
    onEvent(cb: (event: LegionPlayerEvent, data?: unknown) => void): Unsubscribe;
  };

  bux: {
    requestPurchase(
      sku: string,
      metadata?: Record<string, unknown>,
    ): Promise<LegionPurchaseResult>;
    getBalance(): Promise<number>;
  };

  portal: {
    showMenu(lockCursorOnResume?: boolean): void;
    requestFullscreen(): void;
    exitFullscreen(): void;
    isInIframe(): boolean;
    isEmbeddedInLegion(): boolean;
    onPointerLockChanged?(cb: (locked: boolean) => void): Unsubscribe;
  };

  api: {
    get(path: string): Promise<unknown>;
    post(path: string, body?: unknown): Promise<unknown>;
    patch(path: string, body?: unknown): Promise<unknown>;
    delete(path: string): Promise<unknown>;
  };
}

declare global {
  interface Window {
    Legion?: { SDK?: LegionSdk };
  }
}
