import { createHash } from 'node:crypto';
import { serverConfig } from '../config/serverConfig.js';
import { logger } from '../util/logger.js';

const SCOPE = 'auth';

/**
 * Bloxity's API host. The same constant the SDK itself resolves every call
 * against, and deliberately not configurable: this is the one request whose
 * answer decides whose progress a player gets, and an environment knob that
 * could point it anywhere else is a knob that could hand out accounts.
 */
const BLOXITY_API = 'https://api.bloxity.io';

/**
 * The verification route, taken from Bloxity's own SDK rather than invented.
 *
 * `legion-sdk.js` validates the token it holds with exactly this call -
 * `POST {api}/v1/auth/game-token/verify`, the token as a Bearer credential and
 * `{ gameSlug }` as the body - and treats a 401 as "this login is not valid".
 * Probed live: with no token it answers `401 GAME_TOKEN_REQUIRED`, with a junk
 * one `401 GAME_TOKEN_INVALID`, and a made-up sibling route `404`, so the
 * route is real and it is what rejects a bad login.
 *
 * Verified by ASKING BLOXITY, never by checking the JWT locally. The token is
 * a JWT, but this server does not hold the key it is signed with - Legion's
 * `JWT_SECRET` is documented as the game's OWN secret, not as Bloxity's - and
 * decoding a JWT without its key proves nothing about who issued it.
 */
const VERIFY_PATH = '/v1/auth/game-token/verify';

/** A slow answer is treated as no answer. The join's seat is held for 15 s. */
const TIMEOUT_MS = 6000;
/** How long a good answer is trusted before it is asked again. */
const VERIFIED_TTL_MS = 5 * 60_000;
/** How long a REJECTION is remembered, so a spamming client costs one call. */
const REJECTED_TTL_MS = 30_000;
/** A token longer than this is not a token. */
const MAX_TOKEN_LENGTH = 8192;
/** The shape of a Bloxity account id: a Mongo ObjectId in practice. */
const ACCOUNT_ID = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * What Bloxity said about a token.
 *
 * Three answers, not two, and the difference matters. `rejected` is Bloxity
 * saying this is not a valid login - the player is a guest. `unavailable` is
 * Bloxity not saying anything - a timeout, a 5xx, a malformed reply - and a
 * player who IS signed in must not be quietly demoted for good because the
 * portal hiccuped, so the room tries again later.
 */
export type VerifyResult =
  | { readonly kind: 'verified'; readonly accountId: string }
  | { readonly kind: 'rejected' }
  | { readonly kind: 'unavailable' };

interface CachedResult {
  readonly result: VerifyResult;
  readonly until: number;
}

/**
 * Server-side verification of a Bloxity login.
 *
 * FAILS CLOSED. Nothing short of a 2xx from Bloxity carrying an account id is
 * a verified account; every other outcome leaves the player a guest.
 */
class BloxityAuth {
  /** Keyed by a HASH of the token, so no raw credential sits in memory. */
  private readonly cache = new Map<string, CachedResult>();
  /** One request per token at a time, however often it is presented. */
  private readonly inFlight = new Map<string, Promise<VerifyResult>>();

  async verify(token: unknown): Promise<VerifyResult> {
    if (typeof token !== 'string') return { kind: 'rejected' };
    const trimmed = token.trim();
    if (!trimmed || trimmed.length > MAX_TOKEN_LENGTH) return { kind: 'rejected' };

    const key = createHash('sha256').update(trimmed).digest('hex');
    const now = Date.now();
    const cached = this.cache.get(key);
    if (cached && cached.until > now) return cached.result;

    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const request = this.ask(trimmed).then((result) => {
      this.inFlight.delete(key);
      if (result.kind === 'verified') {
        // Never trusted past the token's own expiry, when it carries one.
        const expiry = tokenExpiry(trimmed);
        const until = Math.min(now + VERIFIED_TTL_MS, expiry ?? Number.POSITIVE_INFINITY);
        this.cache.set(key, { result, until });
      } else if (result.kind === 'rejected') {
        this.cache.set(key, { result, until: now + REJECTED_TTL_MS });
      }
      // `unavailable` is never cached: the next attempt should really ask.
      this.prune(now);
      return result;
    });
    this.inFlight.set(key, request);
    return request;
  }

  private async ask(token: string): Promise<VerifyResult> {
    let response: Response;
    try {
      response = await fetch(`${BLOXITY_API}${VERIFY_PATH}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ gameSlug: serverConfig.gameSlug }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      logger.warn(SCOPE, `Bloxity verification unreachable: ${String(error)}`);
      return { kind: 'unavailable' };
    }

    if (response.status === 401 || response.status === 403) {
      return { kind: 'rejected' };
    }
    if (!response.ok) {
      logger.warn(SCOPE, `Bloxity verification answered HTTP ${response.status}`);
      return { kind: 'unavailable' };
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      logger.warn(SCOPE, 'Bloxity verification answered 2xx with no JSON');
      return { kind: 'unavailable' };
    }

    /*
     * `{ user }`, or the user itself: the SDK reads the reply of this exact
     * call as `'user' in payload && payload.user ? payload.user : payload`,
     * and the account id is the user's `_id` - the same field the client's
     * `LegionUser` carries and the Bux webhook addresses grants to.
     */
    const user =
      payload && typeof payload === 'object' && 'user' in payload && payload.user
        ? (payload as { user: unknown }).user
        : payload;
    const accountId =
      user && typeof user === 'object' ? (user as { _id?: unknown })._id : undefined;

    if (typeof accountId !== 'string' || !ACCOUNT_ID.test(accountId)) {
      // A 2xx without an account is not a login. Fail closed, loudly.
      logger.warn(SCOPE, 'Bloxity verification answered 2xx without a usable account id');
      return { kind: 'unavailable' };
    }
    return { kind: 'verified', accountId };
  }

  private prune(now: number): void {
    if (this.cache.size < 2048) return;
    for (const [key, entry] of this.cache) {
      if (entry.until <= now) this.cache.delete(key);
    }
  }
}

/**
 * When a JWT says it expires, in epoch milliseconds - or null.
 *
 * Used ONLY to cap how long a verified answer is cached. Nothing is trusted
 * from the payload: the account comes from Bloxity's reply, not from here.
 */
const tokenExpiry = (token: string): number | null => {
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const json = Buffer.from(part, 'base64url').toString('utf8');
    const exp = (JSON.parse(json) as { exp?: unknown }).exp;
    return typeof exp === 'number' && Number.isFinite(exp) ? exp * 1000 : null;
  } catch {
    return null;
  }
};

export const bloxityAuth = new BloxityAuth();
