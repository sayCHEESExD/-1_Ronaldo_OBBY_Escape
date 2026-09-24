/**
 * Player progress persistence, checked against a REAL server.
 *
 * Mocks nothing inside the game: it spawns the compiled server (`server/dist`),
 * joins it with real colyseus.js clients exactly as the game does, delivers
 * real webhooks, and reads what landed in storage directly. The ONE stand-in
 * is Bloxity's token verification, which cannot be called for real without a
 * real login - `support/bloxity-verify-stub.mjs` is preloaded into the TEST
 * server only (`node --import`), never into production.
 *
 *   npm run verify:persistence
 *       JSON development store only.
 *   PERSISTENCE_MONGO_HARNESS=scripts/support/mongod-harness.mjs npm run verify:persistence
 *       ...plus MongoDB on a real mongod it starts, stops and restarts
 *       (outage tests included). See that file for where the binary comes from.
 *   MONGODB_URI=mongodb://127.0.0.1:27017/obby_test npm run verify:persistence
 *       ...plus MongoDB at that URI (no outage tests).
 *
 * !!! THE MONGODB DATABASE NAMED IN THE URI IS WIPED. NEVER POINT THIS AT A
 * !!! REAL ONE.
 */
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client } from 'colyseus.js';
import { ROOM_NAME } from '../shared/dist/index.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const STUB = pathToFileURL(join(ROOT, 'scripts', 'support', 'bloxity-verify-stub.mjs')).href;
const SERVER = join(ROOT, 'server', 'dist', 'index.js');
const PORT = Number(process.env.PERSISTENCE_PORT ?? 2690);
const SECRET = 'verify-persistence-secret';
const WEBHOOK = '/bloxity/bux-webhook';
const SLUG = 'anime-backflip-escape';

let failures = 0;
const pass = (message) => console.log(`  ok    ${message}`);
const fail = (message) => {
  failures += 1;
  console.log(`  FAIL  ${message}`);
};
const check = (condition, message) => (condition ? pass(message) : fail(message));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const waitFor = async (probe, timeoutMs = 6000, stepMs = 50) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() > deadline) return value;
    await sleep(stepMs);
  }
};

// ------------------------------------------------------------------ server

const startServer = async (env, port = PORT) => {
  const child = spawn(process.execPath, ['--import', STUB, SERVER], {
    cwd: join(ROOT, 'server'),
    env: { ...process.env, ...env, PORT: String(port), HOST: '127.0.0.1', BLOXITY_WEBHOOK_SECRET: SECRET },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logs = [];
  const collect = (chunk) => logs.push(...String(chunk).split('\n').filter(Boolean));
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);

  const up = await waitFor(async () => {
    try {
      return (await fetch(`http://127.0.0.1:${port}/health`)).ok;
    } catch {
      return false;
    }
  }, 20_000, 150);
  if (!up) {
    console.log(logs.join('\n'));
    throw new Error('server did not come up');
  }
  return {
    logs,
    async stop() {
      if (child.exitCode !== null) return;
      // A HARD stop: on Windows a signal cannot reach a Node handler anyway,
      // and "the process vanished" is the harsher test of durability. Callers
      // wait for writes to land first.
      child.kill('SIGKILL');
      await once(child, 'exit');
    },
  };
};

const joinRoom = async (options, port = PORT) => {
  const client = new Client(`ws://127.0.0.1:${port}`);
  const room = await client.joinOrCreate(ROOM_NAME, options);
  room.onMessage('*', () => {});
  const self = await waitFor(() => room.state?.players?.get?.(room.sessionId));
  if (!self) throw new Error('joined but never saw own player state');
  return room;
};
const me = (room) => room.state.players.get(room.sessionId);
const leave = async (room) => {
  try {
    await room.leave(true);
  } catch {
    /* already gone */
  }
};

/** Deliver a webhook. Resolves `{ status, body }`, or `{ status: 0 }` if nothing answered. */
const deliver = async (userId, transactionId, sku, port = PORT, extra = {}) => {
  try {
    const response = await fetch(`http://127.0.0.1:${port}${WEBHOOK}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-legion-webhook-secret': SECRET },
      body: JSON.stringify({ transactionId, userId, sku, gameSlug: SLUG, ...extra }),
    });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  } catch {
    return { status: 0, body: {} };
  }
};
const grant = async (userId, transactionId, sku, port = PORT) =>
  (await deliver(userId, transactionId, sku, port)).status === 200;

// ---------------------------------------------------------------- backends

const base = { ownedBoots: 1, ownedTrails: 0, trailSlot: 0, ownedAuras: 0, auraSlot: 0, legionName: '', legionPfp: '', updatedAt: 1 };
const SEED = {
  // An existing browser guest with real progress, plus a field a newer build
  // might have added: both must survive every move.
  'g-alpha': { ...base, totalSpeed: 5000, wins: 40, rebirths: 1, ownedBoots: 7, ownedTrails: 2, trailSlot: 1, legionName: 'Alpha', futureField: 'kept' },
  // A browser whose progress must NEVER overwrite an account that has its own.
  'g-gamma': { ...base, totalSpeed: 77, wins: 999, rebirths: 0 },
  // An account that already has progress.
  'bloxity:bob': { ...base, totalSpeed: 900, wins: 500, rebirths: 2 },
  // An account whose pod died holding two claimed grants: one whose save had
  // already landed (its id is in `buxApplied`, its Wins in the 100) and one
  // whose save never did.
  'bloxity:erin': { ...base, totalSpeed: 10, wins: 100, rebirths: 0, buxApplied: ['txn-dead-paid'] },
};

/** Grant records as a pod that has since died left them - far past any lease. */
const deadClaims = () => {
  const claimedAt = Date.now() - 60 * 60_000;
  const record = { userId: 'erin', state: 'claimed', claimedAt, claimedBy: 'gone-pod/1/deadbeef', receivedAt: claimedAt - 1000 };
  return {
    'txn-dead-paid': { ...record, sku: 'wins_sack', wins: 25_000 },
    'txn-dead-unpaid': { ...record, sku: 'wins_pouch', wins: 2_500 },
  };
};

const jsonBackend = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'obby-persist-'));
  const file = join(dir, 'profiles.json');
  const grantsFile = join(dir, 'bux-grants.json');
  const readJson = async (path) => {
    if (!existsSync(path)) return undefined;
    try {
      return JSON.parse(await readFile(path, 'utf8'));
    } catch {
      return undefined;
    }
  };
  return {
    name: 'JSON file (development store)',
    env: { OBBY_DATA_DIR: dir, MONGODB_URI: '' },
    async seed(profiles, grants) {
      await writeFile(file, JSON.stringify({ version: 1, profiles }));
      await writeFile(grantsFile, JSON.stringify(grants));
    },
    async grantState(transactionId) {
      return (await readJson(grantsFile))?.[transactionId]?.state;
    },
    async read(key) {
      return (await readJson(file))?.profiles?.[key];
    },
    file,
    dir,
    async teardown() {
      await rm(dir, { recursive: true, force: true });
    },
  };
};

const mongoBackend = async () => {
  const harness = process.env.PERSISTENCE_MONGO_HARNESS
    ? await import(pathToFileURL(join(ROOT, process.env.PERSISTENCE_MONGO_HARNESS)).href)
    : null;
  const uri = harness ? await harness.start() : process.env.MONGODB_URI;
  const { MongoClient } = await import('mongodb');
  let client = new MongoClient(uri, { serverSelectionTimeoutMS: 3000 });
  await client.connect();
  const collection = () => client.db().collection('profiles');
  const grants = () => client.db().collection('bux_grants');
  await collection().deleteMany({});
  await grants().deleteMany({});
  // A profiles.json left behind by the JSON-file era, for the one-off import.
  const legacyDir = await mkdtemp(join(tmpdir(), 'obby-legacy-'));
  await writeFile(
    join(legacyDir, 'profiles.json'),
    JSON.stringify({
      version: 1,
      profiles: {
        'g-legacy': { ...base, totalSpeed: 321, wins: 12, rebirths: 0 },
        // Also in the database already, with more progress: the file must lose.
        'g-gamma': { ...base, totalSpeed: 1, wins: 1, rebirths: 0 },
      },
    }),
  );
  return {
    name: `MongoDB (${client.db().databaseName})`,
    legacy: true,
    multiPod: true,
    harness,
    env: { MONGODB_URI: uri, OBBY_DATA_DIR: legacyDir },
    async seed(profiles, seededGrants) {
      await collection().deleteMany({});
      await collection().insertMany(Object.entries(profiles).map(([key, value]) => ({ _id: key, ...value })));
      await grants().deleteMany({});
      await grants().insertMany(Object.entries(seededGrants).map(([key, value]) => ({ _id: key, ...value })));
    },
    async grantState(transactionId) {
      return (await grants().findOne({ _id: transactionId }))?.state;
    },
    async read(key) {
      const document = await collection().findOne({ _id: key });
      if (!document) return undefined;
      const { _id, ...rest } = document;
      return rest;
    },
    async reconnect() {
      await client.close().catch(() => {});
      client = new MongoClient(uri, { serverSelectionTimeoutMS: 3000 });
      await client.connect();
    },
    async teardown() {
      await collection().deleteMany({}).catch(() => {});
      await grants().deleteMany({}).catch(() => {});
      await client.close().catch(() => {});
      await rm(legacyDir, { recursive: true, force: true }).catch(() => {});
      await (harness?.destroy ?? harness?.stop)?.();
    },
  };
};

// ---------------------------------------------------------------- the suite

const suite = async (backend) => {
  console.log(`\npersistence: ${backend.name}`);
  await backend.seed(SEED, deadClaims());
  let server = await startServer(backend.env);
  let podB = null;
  const stored = (key) => backend.read(key);

  try {
    // 0. Claims left open by a pod that died are settled on boot, by asking
    //    the buyer's stored profile whether the Wins arrived.
    check(await waitFor(async () => (await backend.grantState('txn-dead-paid')) === 'applied'), "a dead pod's claim whose save LANDED is marked applied, not re-queued");
    // The sweep settles claims one after another, so wait for this one too.
    check(await waitFor(async () => (await backend.grantState('txn-dead-unpaid')) === 'pending'), "a dead pod's claim whose save never landed is owed again");
    const erin = await joinRoom({ playerId: 'g-erin', bloxityToken: 'tok-erin' });
    check(await waitFor(() => me(erin).wins === 2_600), 'the owed one is paid and the landed one is not paid twice (100 + 2,500)');
    await leave(erin);

    // 1. An existing guest profile still works exactly as it did.
    const guest = await joinRoom({ playerId: 'g-alpha' });
    check(me(guest).wins === 40 && me(guest).rebirths === 1, 'existing browser guest profile restores (wins 40, rebirths 1)');

    // 1b. Profiles from the old JSON file are imported, never over newer data.
    if (backend.legacy) {
      const legacy = await joinRoom({ playerId: 'g-legacy' });
      check(me(legacy).wins === 12, 'a profile from the old profiles.json is imported into the database');
      await leave(legacy);
      check((await stored('g-gamma'))?.wins === 999, 'the import never overwrites a profile the database already has');
    }

    // 2. Identity cannot be CLAIMED.
    const spoofKey = await joinRoom({ playerId: 'bloxity:bob' });
    check(me(spoofKey).wins === 0, 'a guest id naming an account key does NOT get that account (wins 0, not 500)');
    const spoofRaw = await joinRoom({ playerId: 'g-spoof', legionUserId: 'bob', bloxityId: 'bob' });
    check(me(spoofRaw).wins === 0, 'a raw account id sent by the browser is ignored');
    const badToken = await joinRoom({ playerId: 'g-bad', bloxityToken: 'tok-forged' });
    check(me(badToken).wins === 0, 'a forged token plays as a guest');
    await Promise.all([leave(spoofKey), leave(spoofRaw), leave(badToken)]);

    // 3. First sign-in, mid-session, moves this browser's progress.
    guest.send('authenticate', { token: 'tok-alice' });
    const alice = await waitFor(() => stored('bloxity:alice'));
    check(alice?.wins === 40 && alice?.rebirths === 1 && alice?.ownedBoots === 7 && alice?.ownedTrails === 2, 'first login migrates the browser profile to the account (fields preserved)');
    check(alice?.migratedFrom === 'g-alpha', 'the account records where its progress came from (migratedFrom)');
    check(alice?.futureField === 'kept', 'fields this build does not know about survive the migration');
    const tomb = await waitFor(async () => {
      const value = await stored('g-alpha');
      return value?.migratedTo ? value : null;
    });
    check(tomb?.migratedTo === 'bloxity:alice' && tomb?.wins === 40, 'the guest copy is kept as a recovery copy, marked migratedTo');
    check(me(guest).wins === 40, 'the session keeps its progress through the sign-in');

    // 4. Signing out falls back to the browser's own profile - fresh, since it moved.
    guest.send('authenticate', { token: '' });
    check(await waitFor(() => me(guest).wins === 0), 'logout falls back to guest play (the moved guest profile starts fresh)');
    check((await stored('bloxity:alice'))?.wins === 40, 'the account keeps its progress after logout');

    // 5. ...and signing back in on the same session brings the account back.
    guest.send('authenticate', { token: 'tok-alice' });
    check(await waitFor(() => me(guest).wins === 40), 'signing back in restores the account (wins 40)');
    await leave(guest);

    // 6. Reconnect as the same account.
    await sleep(300);
    const again = await joinRoom({ playerId: 'g-alpha', bloxityToken: 'tok-alice' });
    check(me(again).wins === 40, 'reconnecting as the same account loads the same progress');
    await leave(again);

    // 7. The same account on another browser / device.
    await sleep(300);
    const other = await joinRoom({ playerId: 'g-other-device', bloxityToken: 'tok-alice' });
    check(me(other).wins === 40 && me(other).rebirths === 1, 'the same account on another browser loads the same progress');
    await leave(other);

    // 8. An account that HAS progress is never overwritten by a browser's.
    const bob = await joinRoom({ playerId: 'g-gamma', bloxityToken: 'tok-bob' });
    check(me(bob).wins === 500, "an existing account loads its own profile, not the browser's (500, not 999)");
    const gamma = await stored('g-gamma');
    check(gamma?.wins === 999 && !gamma?.migratedTo, 'the browser profile is left untouched');
    bob.send('authenticate', { token: '' });
    check(await waitFor(() => me(bob).wins === 999), "logout returns to that browser's own guest progress (999)");
    check((await stored('bloxity:bob'))?.wins === 500, 'the account profile still reads 500');
    await leave(bob);

    // 9. Purchases go to the VERIFIED account only.
    check(await grant('bob', 'txn-verify-1', 'wins_pouch'), 'webhook accepted a purchase for bob');
    const thief = await joinRoom({ playerId: 'g-thief', legionUserId: 'bob', bloxityId: 'bob' });
    await sleep(1500);
    check(me(thief).wins === 0, "a browser naming bob's id does not collect bob's purchase");
    await leave(thief);
    const buyer = await joinRoom({ playerId: 'g-gamma', bloxityToken: 'tok-bob' });
    check(await waitFor(() => me(buyer).wins === 3_000), 'the verified account collects it (500 + 2,500)');
    await leave(buyer);
    check(await waitFor(async () => (await backend.grantState('txn-verify-1')) === 'applied'), 'the grant is marked applied once the save carrying it lands');
    const wrongGame = await deliver('bob', 'txn-wrong-game', 'wins_pouch', PORT, { gameSlug: 'some-other-game' });
    check(wrongGame.status === 422, 'a purchase for another game is refused');
    const malformed = await deliver({ $ne: '' }, 'txn-bad-1', 'wins_pouch');
    check(malformed.status === 422, 'a non-string user id is refused, never used as a query');

    // 10. Bloxity not answering is not a sign-out and not a refusal.
    const down = await joinRoom({ playerId: 'g-down', bloxityToken: 'tok-down' });
    check(me(down).wins === 0, 'Bloxity unavailable: the player is let in as a guest');
    await leave(down);

    // 11. A server restart loses nothing. Let writes land, then kill it outright.
    await sleep(2500);
    await server.stop();
    server = await startServer(backend.env);
    const r1 = await joinRoom({ playerId: 'g-anything', bloxityToken: 'tok-alice' });
    check(me(r1).wins === 40, 'after a restart the account still has its progress');
    const r2 = await joinRoom({ playerId: 'g-gamma' });
    check(me(r2).wins === 999, 'after a restart the guest still has its progress');
    const r3 = await joinRoom({ playerId: 'g-x2', bloxityToken: 'tok-bob' });
    check(me(r3).wins === 3_000, 'after a restart the purchase is still there');
    await Promise.all([leave(r1), leave(r2), leave(r3)]);

    // 11b. A RESTART BETWEEN THE WEBHOOK AND THE JOIN. Killed the instant it
    //      answered; the purchase must survive, and the retry must not pay twice.
    const first = await deliver('carol', 'txn-restart-1', 'wins_sack');
    check(first.status === 200 && first.body.status === 'granted', 'webhook for carol answered 200 (recorded)');
    await server.stop();
    server = await startServer(backend.env);
    const retried = await deliver('carol', 'txn-restart-1', 'wins_sack');
    check(retried.status === 200 && retried.body.status === 'duplicate', 'the same transaction retried after the restart is a duplicate (200)');
    const carol = await joinRoom({ playerId: 'g-carol', bloxityToken: 'tok-carol' });
    check(await waitFor(() => me(carol).wins === 25_000), 'a purchase recorded before a restart is collected after it (25,000)');
    check(await waitFor(async () => (await stored('bloxity:carol'))?.wins === 25_000), "and saved into carol's profile");
    check(await waitFor(async () => (await backend.grantState('txn-restart-1')) === 'applied'), 'and marked applied');

    // 11c. Bought while already playing: handed over without a rejoin, once.
    check(await grant('carol', 'txn-live-1', 'wins_pouch'), 'webhook for carol while she is in a room');
    check(await waitFor(() => me(carol).wins === 27_500), 'a purchase made mid-session arrives in the session (+2,500)');
    await sleep(3500);
    check(me(carol).wins === 27_500, 'and it is paid once, not on every poll');
    await leave(carol);

    // 11d. SEVERAL PODS, ONE DATABASE.
    if (backend.multiPod) {
      podB = await startServer(backend.env, PORT + 1);
      check(await grant('dave', 'txn-pod-1', 'wins_pouch', PORT + 1), 'webhook delivered to pod B');
      const daveA = await joinRoom({ playerId: 'g-dave', bloxityToken: 'tok-dave' }, PORT);
      check(await waitFor(() => me(daveA).wins === 2_500), 'a purchase recorded on pod B is collected on pod A');
      const cross = await deliver('dave', 'txn-pod-1', 'wins_pouch', PORT);
      check(cross.status === 200 && cross.body.status === 'duplicate', 'the retry landing on the OTHER pod is still a duplicate');

      const daveB = await joinRoom({ playerId: 'g-dave-2', bloxityToken: 'tok-dave' }, PORT + 1);
      await waitFor(() => me(daveB).wins > 0);
      const baseA = me(daveA).wins;
      const baseB = me(daveB).wins;
      const burst = Array.from({ length: 12 }, (_, i) => `txn-race-${i}`);
      const answers = await Promise.all(
        burst.flatMap((txn, i) =>
          i % 3 === 0
            ? [deliver('dave', txn, 'wins_pouch', PORT), deliver('dave', txn, 'wins_pouch', PORT + 1)]
            : [deliver('dave', txn, 'wins_pouch', i % 2 === 0 ? PORT : PORT + 1)],
        ),
      );
      check(answers.every((a) => a.status === 200), 'every delivery of the burst answered 200');
      check(answers.filter((a) => a.body.status === 'granted').length === burst.length, 'each transaction was recorded exactly once across both pods');
      const gained = () => me(daveA).wins - baseA + (me(daveB).wins - baseB);
      const expected = burst.length * 2_500;
      await waitFor(() => gained() >= expected, 15_000);
      await sleep(3500);
      check(gained() === expected, `${burst.length} grants raced across two pods are paid exactly once (+${expected}, got +${gained()})`);
      const states = await Promise.all(burst.map((txn) => waitFor(async () => (await backend.grantState(txn)) === 'applied')));
      check(states.every(Boolean), 'every raced grant ends applied');
      await Promise.all([leave(daveA), leave(daveB)]);
      await sleep(500);
      await podB.stop();
      podB = null;
    }

    // 12. Storage failure never wipes anybody.
    if (backend.file) {
      await sleep(2500);
      await server.stop();
      const before = await readFile(backend.file, 'utf8');
      await writeFile(backend.file, `${before.slice(0, 40)}<<corrupt`);
      server = await startServer(backend.env);
      await joinRoom({ playerId: 'g-gamma' }).then(leave);
      const aside = (await readdir(backend.dir)).filter((name) => name.includes('.corrupt-'));
      check(aside.length === 1, 'a corrupt profile file is moved aside, not overwritten');
      const kept = aside[0] ? await readFile(join(backend.dir, aside[0]), 'utf8') : '';
      check(kept.startsWith(before.slice(0, 40)), 'the moved-aside file still holds the original data');
    } else if (backend.harness) {
      // Outage at the WEBHOOK: nothing recorded, so nothing promised.
      await backend.harness.stop();
      const refusedGrant = await deliver('carol', 'txn-outage-1', 'wins_pouch');
      check(refusedGrant.status >= 500, `with the database down the webhook answers 5xx (got ${refusedGrant.status}), not 2xx`);
      await backend.harness.restart();
      await backend.reconnect();
      check(await grant('carol', 'txn-outage-1', 'wins_pouch'), "Bloxity's retry once the database is back is accepted");
      const carolBack = await joinRoom({ playerId: 'g-carol', bloxityToken: 'tok-carol' });
      check(await waitFor(() => me(carolBack).wins === 30_000, 10_000), 'and paid once (27,500 + 2,500)');
      await leave(carolBack);

      // Outage at JOIN: refused, not started fresh.
      await sleep(1000);
      await backend.harness.stop();
      let refused = false;
      try {
        await joinRoom({ playerId: 'g-gamma' }).then(leave);
      } catch (error) {
        refused = /progress/i.test(String(error?.message ?? error));
      }
      check(refused, 'with the database down a join is REFUSED, not started fresh');
      await backend.harness.restart();
      await backend.reconnect();
      const back = await joinRoom({ playerId: 'g-gamma' });
      check(me(back).wins === 999, 'once the database is back the same player has everything');

      // Outage MID-SESSION: a sign-out that cannot read storage stays put, and
      // the save that cannot land is retried until it does.
      const live = await joinRoom({ playerId: 'g-live', bloxityToken: 'tok-alice' });
      const beforeSave = (await stored('bloxity:alice'))?.updatedAt ?? 0;
      await backend.harness.stop();
      live.send('authenticate', { token: '' });
      await sleep(7000);
      check(me(live).wins === 40, 'a sign-out that cannot reach storage leaves the player where they were');
      await leave(live);
      await leave(back);
      await sleep(500);
      await backend.harness.restart();
      await backend.reconnect();
      const landed = await waitFor(async () => ((await stored('bloxity:alice'))?.updatedAt ?? 0) > beforeSave, 45_000, 500);
      check(Boolean(landed), 'a save made during the outage is retried and lands once the database is back');
      check((await stored('bloxity:alice'))?.wins === 40, 'and it carries the right progress');
    } else {
      console.log('  skip  outage tests (set PERSISTENCE_MONGO_HARNESS to run them)');
    }

    const crashes = server.logs.filter((line) => /unhandled|TypeError|ReferenceError|RangeError/i.test(line));
    check(crashes.length === 0, 'no unhandled errors in the server log');
    if (crashes.length) console.log(crashes.slice(0, 5).join('\n'));
  } finally {
    await server.stop();
    await podB?.stop();
  }
};

const backends = [await jsonBackend()];
if (process.env.MONGODB_URI || process.env.PERSISTENCE_MONGO_HARNESS) backends.push(await mongoBackend());

for (const backend of backends) {
  try {
    await suite(backend);
  } catch (error) {
    fail(`${backend.name}: ${error?.stack ?? error}`);
  } finally {
    await backend.teardown();
  }
}

console.log(failures === 0 ? '\npersistence OK' : `\npersistence FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);
