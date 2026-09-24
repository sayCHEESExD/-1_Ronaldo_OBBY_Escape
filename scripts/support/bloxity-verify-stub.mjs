/**
 * A stand-in for Bloxity's token verification, for `verify:persistence` ONLY.
 *
 * Preloaded into the TEST server with `node --import`, so production code
 * carries no test switch of any kind: the server calls exactly the URL it
 * always calls, and this intercepts that one URL in the test process. Every
 * other request goes to the real `fetch`.
 *
 * It answers in the shape Bloxity's own SDK reads from this route
 * (`{ user: { _id, ... } }` on success, `401 GAME_TOKEN_INVALID` otherwise),
 * and REFUSES a request for any other game slug - so the suite also proves the
 * server asks about the right game, which is the bug that kept every signed-in
 * player on their browser's guest profile.
 *
 *   tok-alice / tok-bob / tok-carol / tok-dave / tok-erin -> that account
 *   tok-down   -> 503, Bloxity unavailable
 *   otherwise  -> 401, not a login
 */
const VERIFY_URL = 'https://api.bloxity.io/v1/auth/game-token/verify';
const ACCOUNTS = {
  'tok-alice': 'alice',
  'tok-bob': 'bob',
  'tok-carol': 'carol',
  'tok-dave': 'dave',
  'tok-erin': 'erin',
};
const EXPECTED_SLUG = process.env.STUB_EXPECT_SLUG ?? 'anime-backflip-escape';

const realFetch = globalThis.fetch;

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url !== VERIFY_URL) return realFetch(input, init);

  const header = new Headers(init.headers).get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  let slug = '';
  try {
    slug = JSON.parse(String(init.body ?? '{}')).gameSlug ?? '';
  } catch {
    /* no body */
  }

  if (init.method !== 'POST') return json(404, { error: 'Not Found' });
  if (!token) return json(401, { code: 'GAME_TOKEN_REQUIRED' });
  if (token === 'tok-down') return json(503, { error: 'unavailable' });
  if (slug !== EXPECTED_SLUG) return json(401, { code: 'GAME_TOKEN_INVALID', why: `wrong game "${slug}"` });

  const id = ACCOUNTS[token];
  if (!id) return json(401, { code: 'GAME_TOKEN_INVALID' });
  return json(200, { user: { _id: id, username: id } });
};
