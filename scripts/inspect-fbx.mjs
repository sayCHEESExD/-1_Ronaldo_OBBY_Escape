#!/usr/bin/env node
/**
 * Offline inspector for binary FBX files. Zero dependencies.
 *
 * Prints the scene graph summary, bone hierarchy, mesh stats and - most
 * usefully - every texture path the file references, so dead absolute paths
 * are visible without opening the model in a DCC tool.
 *
 * Usage: node scripts/inspect-fbx.mjs assets/player/player.fbx
 */
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const MAGIC = 'Kaydara FBX Binary  ';

class Reader {
  constructor(buffer) {
    this.buf = buffer;
    this.pos = 0;
  }
  u8() {
    return this.buf.readUInt8(this.pos++);
  }
  u32() {
    const v = this.buf.readUInt32LE(this.pos);
    this.pos += 4;
    return v;
  }
  i32() {
    const v = this.buf.readInt32LE(this.pos);
    this.pos += 4;
    return v;
  }
  u64() {
    const v = Number(this.buf.readBigUInt64LE(this.pos));
    this.pos += 8;
    return v;
  }
  bytes(n) {
    const v = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return v;
  }
}

const readProperty = (r) => {
  const type = String.fromCharCode(r.u8());
  switch (type) {
    case 'Y': {
      const v = r.buf.readInt16LE(r.pos);
      r.pos += 2;
      return v;
    }
    case 'C':
      return r.u8() !== 0;
    case 'I':
      return r.i32();
    case 'F': {
      const v = r.buf.readFloatLE(r.pos);
      r.pos += 4;
      return v;
    }
    case 'D': {
      const v = r.buf.readDoubleLE(r.pos);
      r.pos += 8;
      return v;
    }
    case 'L': {
      const v = Number(r.buf.readBigInt64LE(r.pos));
      r.pos += 8;
      return v;
    }
    case 'S':
    case 'R': {
      const len = r.u32();
      const raw = r.bytes(len);
      return type === 'S' ? raw.toString('utf8').replace(/\0/g, '::') : raw;
    }
    case 'f':
    case 'd':
    case 'l':
    case 'i':
    case 'b': {
      const count = r.u32();
      const encoding = r.u32();
      const length = r.u32();
      let data = r.bytes(length);
      if (encoding === 1) data = inflateSync(data);
      const out = [];
      const sizes = { f: 4, d: 8, l: 8, i: 4, b: 1 };
      const step = sizes[type];
      for (let i = 0; i < count; i += 1) {
        const at = i * step;
        if (type === 'f') out.push(data.readFloatLE(at));
        else if (type === 'd') out.push(data.readDoubleLE(at));
        else if (type === 'l') out.push(Number(data.readBigInt64LE(at)));
        else if (type === 'i') out.push(data.readInt32LE(at));
        else out.push(data.readUInt8(at) !== 0);
      }
      return out;
    }
    default:
      throw new Error(`Unknown FBX property type "${type}" at byte ${r.pos}`);
  }
};

const readNode = (r, version) => {
  const wide = version >= 7500;
  const endOffset = wide ? r.u64() : r.u32();
  const numProps = wide ? r.u64() : r.u32();
  wide ? r.u64() : r.u32(); // property list length, unused
  const nameLen = r.u8();

  if (endOffset === 0) return null;

  const name = r.bytes(nameLen).toString('utf8');
  const props = [];
  for (let i = 0; i < numProps; i += 1) props.push(readProperty(r));

  const children = [];
  const sentinelSize = wide ? 25 : 13;
  while (r.pos < endOffset - sentinelSize) {
    const child = readNode(r, version);
    if (!child) break;
    children.push(child);
  }
  r.pos = endOffset;

  return { name, props, children };
};

const parseFbx = (path) => {
  const buf = readFileSync(path);
  if (buf.subarray(0, MAGIC.length).toString('binary') !== MAGIC) {
    throw new Error(`${path} is not a binary FBX (ASCII FBX is not supported)`);
  }
  const r = new Reader(buf);
  r.pos = 23;
  const version = r.u32();

  const roots = [];
  for (;;) {
    const node = readNode(r, version);
    if (!node) break;
    roots.push(node);
  }
  return { version, roots, byteLength: buf.length };
};

const findChild = (node, name) => node.children.find((c) => c.name === name);

const main = () => {
  const path = process.argv[2];
  if (!path) {
    console.error('usage: node scripts/inspect-fbx.mjs <file.fbx>');
    process.exit(1);
  }

  const { version, roots, byteLength } = parseFbx(path);
  const byName = Object.fromEntries(roots.map((n) => [n.name, n]));

  console.log(`file:    ${path}`);
  console.log(`size:    ${byteLength} bytes`);
  console.log(`version: FBX ${version}`);

  const creator = byName['Creator'];
  if (creator) console.log(`creator: ${creator.props[0]}`);

  const objects = byName['Objects']?.children ?? [];
  const shortName = (raw) => String(raw).split('::')[0];

  const models = objects.filter((o) => o.name === 'Model');
  const bones = models.filter((o) => o.props[2] === 'LimbNode');
  const geometries = objects.filter((o) => o.name === 'Geometry');
  const deformers = objects.filter((o) => o.name === 'Deformer');
  const anims = objects.filter((o) => o.name.startsWith('Anim'));

  console.log(`\nmodels:     ${models.length}`);
  console.log(`bones:      ${bones.length}  [${bones.map((b) => shortName(b.props[1])).join(', ')}]`);
  console.log(`geometries: ${geometries.length}`);
  console.log(`deformers:  ${deformers.length}`);
  console.log(`animations: ${anims.length === 0 ? 'none (bind pose only)' : anims.length}`);

  for (const geo of geometries) {
    const verts = findChild(geo, 'Vertices')?.props[0] ?? [];
    const indices = findChild(geo, 'PolygonVertexIndex')?.props[0] ?? [];
    const polygons = indices.filter((i) => i < 0).length;
    console.log(
      `  geometry ${shortName(geo.props[1])}: ${verts.length / 3} verts, ${polygons} polygons`,
    );
  }

  console.log('\ntexture references (as authored):');
  const videos = objects.filter((o) => o.name === 'Video');
  if (videos.length === 0) console.log('  none');
  for (const video of videos) {
    const file =
      findChild(video, 'RelativeFilename')?.props[0] ?? findChild(video, 'Filename')?.props[0];
    const embedded = findChild(video, 'Content') !== undefined;
    console.log(`  ${shortName(video.props[1])}: ${file}${embedded ? '  [embedded]' : ''}`);
  }
  console.log(
    '\nNote: absolute paths above are resolved to their BASENAME by three.js FBXLoader,\n' +
      'then remapped by client/src/config/assets.ts so no dead path is ever requested.',
  );
};

main();
