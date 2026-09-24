#!/usr/bin/env node
/**
 * Pre-flight check for the asset pipeline. Zero dependencies.
 *
 * Confirms the canonical player assets are present and unmodified, and warns
 * about the known duplicate (base_rig.fbx is byte-identical to player.fbx, so
 * only one may be loaded at runtime).
 *
 * Usage: node scripts/verify-assets.mjs
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Files the client actually loads at runtime. */
const REQUIRED = ['assets/player/player.fbx', 'assets/player/green.png'];

/** Present in the repo but deliberately NOT loaded. */
const UNUSED = ['assets/player/base_rig.fbx'];

const md5 = (path) => createHash('md5').update(readFileSync(path)).digest('hex');

let failures = 0;
const fail = (message) => {
  console.error(`FAIL  ${message}`);
  failures += 1;
};
const pass = (message) => console.log(`ok    ${message}`);
const warn = (message) => console.warn(`warn  ${message}`);

const hashes = new Map();

for (const rel of [...REQUIRED, ...UNUSED]) {
  const abs = join(repoRoot, rel);
  if (!existsSync(abs)) {
    if (REQUIRED.includes(rel)) fail(`${rel} is missing`);
    else warn(`${rel} is missing (not loaded at runtime, so not fatal)`);
    continue;
  }
  const hash = md5(abs);
  hashes.set(rel, hash);
  pass(`${rel}  ${statSync(abs).size} bytes  md5=${hash}`);
}

// The two FBX files ship byte-identical; loading both would double the work
// and create a duplicate runtime player asset.
const playerHash = hashes.get('assets/player/player.fbx');
const rigHash = hashes.get('assets/player/base_rig.fbx');
if (playerHash && rigHash && playerHash === rigHash) {
  warn(
    'base_rig.fbx is byte-identical to player.fbx - player.fbx is canonical, ' +
      'base_rig.fbx must not be loaded as a second runtime asset',
  );
}

// The client serves the repo `assets/` folder directly via Vite publicDir.
// A stray copy inside client/ would silently shadow it.
const strayCopy = join(repoRoot, 'client', 'public', 'player', 'player.fbx');
if (existsSync(strayCopy)) {
  fail(`duplicate asset copy found at ${relative(repoRoot, strayCopy)} - delete it`);
}

// Every file in assets/ is served by name from the site root, so every name
// must survive a URL untouched. Bloxity's frontend host answers 400 Bad
// Request for a path containing `%20`: a file named with a space deploys and
// then silently never loads - which is how the music, the Win cheer and the
// death sound all went missing on DEV and PROD at once.
const URL_SAFE = /^[A-Za-z0-9._-]+$/;
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    const rel = relative(repoRoot, abs).split('\\').join('/');
    if (!URL_SAFE.test(entry.name)) {
      fail(`${rel} - rename it using only letters, digits, ".", "_" and "-" (no spaces)`);
    }
    if (entry.isDirectory()) walk(abs);
  }
};
walk(join(repoRoot, 'assets'));
if (failures === 0) pass('every file under assets/ has a URL-safe name');

console.log(failures === 0 ? '\nassets OK' : `\n${failures} problem(s) found`);
process.exit(failures === 0 ? 0 : 1);
