/**
 * A real `mongod` for the persistence OUTAGE tests - stopped and restarted on
 * the SAME port and data directory, so "the database went away and came back"
 * is literal. (mongodb-memory-server's own restart does not reuse a port
 * within one process, which is why it is not driven here.)
 *
 * The binary is NOT a repo dependency. Point MONGOD_BIN at one, or leave it to
 * be found in mongodb-memory-server's download cache (~/.cache/mongodb-binaries),
 * which you can populate OUTSIDE this repo with e.g.
 *   npx --yes mongodb-memory-server-core@latest   (in a scratch folder)
 *
 * Exports start() -> uri, stop(), restart() - the contract
 * `verify-persistence.mjs` reads through PERSISTENCE_MONGO_HARNESS.
 */
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, readdirSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConnection } from 'node:net';

const PORT = Number(process.env.MONGOD_PORT ?? 27617);
let dbPath = null;
let child = null;

const findBinary = () => {
  if (process.env.MONGOD_BIN) return process.env.MONGOD_BIN;
  const cache = join(homedir(), '.cache', 'mongodb-binaries');
  if (!existsSync(cache)) throw new Error('no mongod: set MONGOD_BIN');
  const found = readdirSync(cache).filter((name) => name.startsWith('mongod')).sort().pop();
  if (!found) throw new Error(`no mongod in ${cache}: set MONGOD_BIN`);
  return join(cache, found);
};

const listening = () =>
  new Promise((resolve) => {
    const socket = createConnection({ port: PORT, host: '127.0.0.1' });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });

const launch = async () => {
  child = spawn(findBinary(), ['--port', String(PORT), '--dbpath', dbPath, '--bind_ip', '127.0.0.1', '--quiet'], {
    stdio: 'ignore',
  });
  const deadline = Date.now() + 20_000;
  while (!(await listening())) {
    if (Date.now() > deadline) throw new Error('mongod did not start');
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
};

export const start = async () => {
  dbPath = await mkdtemp(join(tmpdir(), 'obby-mongod-'));
  await launch();
  return `mongodb://127.0.0.1:${PORT}/obby_persistence_test`;
};

export const stop = async () => {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGKILL');
  await once(child, 'exit');
  child = null;
  // Wait for the port to be free before anyone restarts on it.
  while (await listening()) await new Promise((resolve) => setTimeout(resolve, 100));
};

export const restart = async () => {
  await stop();
  await launch();
};

/** Stop, and remove the data directory. */
export const destroy = async () => {
  await stop();
  if (dbPath) await rm(dbPath, { recursive: true, force: true }).catch(() => {});
};
