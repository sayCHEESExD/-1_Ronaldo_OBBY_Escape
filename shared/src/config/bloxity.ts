/**
 * The slug this game is registered under on bloxity.io - its page is
 * https://bloxity.io/g/anime-backflip-escape.
 *
 * ONE value for both sides, because they must agree: the client passes it to
 * `Legion.SDK.init` (the SDK's own token check and the Bux catalogue use it),
 * and the server verifies every login token against it with
 * `POST /v1/auth/game-token/verify`. A token is a capability for ONE game, so
 * verifying against any other slug rejects every signed-in player - which is
 * exactly how progress stayed per-browser while this said
 * '1-backflip-obby-escape'.
 *
 * It is NOT the hosting app id (`speed-backflip-escape`, which Legion injects
 * as BLOXITY_GAME_ID and the deploy workflow uses); the two differ for this
 * game.
 */
export const BLOXITY_GAME_SLUG = 'anime-backflip-escape';
