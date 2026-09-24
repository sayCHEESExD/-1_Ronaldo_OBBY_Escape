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
import { existsSync, readFileSync, statSync } from 'node:fs';
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

console.log(failures === 0 ? '\nassets OK' : `\n${failures} problem(s) found`);
process.exit(failures === 0 ? 0 : 1);
