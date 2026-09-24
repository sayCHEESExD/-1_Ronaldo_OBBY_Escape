/**
 * The slug this game is registered under on bloxity.io - its page is
 * https://bloxity.io/g/ronaldo-obby-escape.
 *
 * ONE value for both sides, because they must agree: the client passes it to
 * `Legion.SDK.init` (the SDK's own token check and the Bux catalogue use it),
 * and the server verifies every login token against it with
 * `POST /v1/auth/game-token/verify`. A token is a capability for ONE game, so
 * verifying against any other slug rejects every signed-in player - progress
 * then stays per-browser, silently.
 *
 * It is NOT necessarily the hosting app id (`ronaldo-obby-escape`, which
 * Legion injects as BLOXITY_GAME_ID and the deploy workflow uses). The two
 * happen to be spelled alike here; if the portal registers the game under a
 * different slug, THIS is the value to change, and the deploy workflow's
 * bundle check with it.
 */
export const BLOXITY_GAME_SLUG = 'ronaldo-obby-escape';
