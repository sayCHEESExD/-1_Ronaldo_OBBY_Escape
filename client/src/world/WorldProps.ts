import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DodecahedronGeometry,
  DoubleSide,
  IcosahedronGeometry,
  LatheGeometry,
  Matrix4,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  TorusGeometry,
  Vector2,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { WORLD_COLORS } from '../config/worldVisuals.js';
import { BANNER_DESIGNS, bannerAtlas, crowd, pitchMarkings, waterfallStreaks } from './WorldArt.js';
import { at, seededRandom, type Prop, type PropPart } from './PropBatch.js';
import { glow, toon } from './ToonKit.js';

/**
 * The football prop library, built once from primitives: floodlights, goals,
 * a grandstand, footballs, trophies, corner flags, bunting and supporters'
 * flags - plus the natural scenery (boulders, floating islets, waterfalls)
 * the gorge itself needs.
 *
 * Each prop merges everything that shares a material into ONE geometry, so a
 * floodlight is a few instanced draws however many stand along the route.
 * Sizes are to the character's scale at 1 (a player is 3.2 units tall, so a
 * real goal is about 13 wide); callers scale the placement.
 */

/** Merge primitives (each with an optional placement) into one geometry. */
export const merge = (items: readonly (readonly [BufferGeometry, Matrix4?])[]): BufferGeometry => {
  const prepared = items.map(([geometry, matrix]) => {
    const flat = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    geometry.dispose();
    if (matrix) flat.applyMatrix4(matrix);
    return flat;
  });
  // Keep only the attributes every piece has, or the merge refuses.
  const first = prepared[0];
  if (!first) return new BufferGeometry();
  const shared = Object.keys(first.attributes).filter((name) =>
    prepared.every((g) => g.getAttribute(name) !== undefined),
  );
  for (const g of prepared) {
    for (const name of Object.keys(g.attributes)) if (!shared.includes(name)) g.deleteAttribute(name);
  }
  const merged = mergeGeometries(prepared, false);
  for (const g of prepared) g.dispose();
  if (!merged) throw new Error('prop geometry merge failed');
  merged.computeBoundingSphere();
  return merged;
};

/** A box whose top edge bows at the ends - a sagging rope when `lift` < 0. */
export const bentBox = (width: number, height: number, depth: number, lift: number): BufferGeometry => {
  const geometry = new BoxGeometry(width, height, depth, 16, 1, 1);
  const position = geometry.getAttribute('position') as BufferAttribute;
  for (let i = 0; i < position.count; i += 1) {
    const t = position.getX(i) / (width / 2);
    position.setY(i, position.getY(i) + lift * t * t);
  }
  geometry.computeVertexNormals();
  return geometry;
};

/** A flat triangle hanging from its top edge - a pennant or a corner flag. */
const triangle = (width: number, height: number): BufferGeometry => {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new BufferAttribute(new Float32Array([-width / 2, 0, 0, width / 2, 0, 0, 0, -height, 0]), 3),
  );
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array([0, 1, 1, 1, 0.5, 0]), 2));
  return geometry;
};

const UP = new Vector3(0, 1, 0);

/** A thin bar from `a` to `b` - net cords and lattice struts. */
const bar = (a: Vector3, b: Vector3, thickness: number): [BufferGeometry, Matrix4] => {
  const direction = new Vector3().subVectors(b, a);
  const geometry = new BoxGeometry(thickness, direction.length(), thickness);
  const matrix = new Matrix4().compose(
    new Vector3().addVectors(a, b).multiplyScalar(0.5),
    new Quaternion().setFromUnitVectors(UP, direction.normalize()),
    new Vector3(1, 1, 1),
  );
  return [geometry, matrix];
};

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

export const MAT = {
  red: () => toon(WORLD_COLORS.red),
  green: () => toon(WORLD_COLORS.green),
  ink: () => toon(WORLD_COLORS.ink),
  gold: () => toon(WORLD_COLORS.gold, { emissive: 0x6a4a00, emissiveIntensity: 0.4 }),
  white: () => toon(WORLD_COLORS.white),
  navy: () => toon(WORLD_COLORS.navy),
  steel: () => toon(WORLD_COLORS.steel),
  concrete: () => toon(WORLD_COLORS.concrete),
  stone: () => toon(WORLD_COLORS.stone),
  net: () => toon(0xdfe5ef),
  lamp: () => glow(WORLD_COLORS.lampGlow),
  crowd: () => toon(0xffffff, { map: crowd() }),
  pitch: () => toon(0xffffff, { map: pitchMarkings() }),
  flagRed: () => toon(WORLD_COLORS.red, { doubleSide: true, sway: 0.05, swayBase: 0, swayDir: -1 }),
  flagGold: () => toon(0xffd84a, { doubleSide: true, sway: 0.05, swayBase: 0, swayDir: -1 }),
  pennant: (color: number) => toon(color, { doubleSide: true }),
  ballVc: () => toon(0xffffff, { vertexColors: true }),
  rockVc: () => toon(0xffffff, { vertexColors: true }),
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

const cache = new Map<string, Prop>();
const once = (key: string, build: () => Prop): Prop => {
  const existing = cache.get(key);
  if (existing) return existing;
  const prop = build();
  cache.set(key, prop);
  return prop;
};

/** Every geometry the library built, for the world's dispose pass. */
export const disposeProps = (): void => {
  const seen = new Set<BufferGeometry>();
  for (const prop of cache.values()) for (const part of prop.parts) seen.add(part.geometry);
  for (const geometry of seen) geometry.dispose();
  cache.clear();
  waterfallMaterial?.map?.dispose();
  waterfallMaterial?.dispose();
  waterfallMaterial = null;
};

/**
 * A stadium floodlight tower, 26 units tall: a tapered mast carrying a
 * tilted bank of lamps that faces +Z.
 */
export const floodlight = (): Prop =>
  once('floodlight', () => {
    const steel = merge([
      [new CylinderGeometry(0.34, 0.62, 24, 8), at(0, 12, 0)],
      [new BoxGeometry(1.6, 0.5, 1.6), at(0, 0.25, 0)],
      // Service platform under the head.
      [new BoxGeometry(5.6, 0.2, 1.6), at(0, 23.6, 0.3)],
    ]);
    const head: [BufferGeometry, Matrix4][] = [[new BoxGeometry(6, 3.4, 0.5), at(0, 25.6, 0.2, 0, 1, -0.4)]];
    const lamps: [BufferGeometry, Matrix4][] = [];
    for (let row = 0; row < 3; row += 1) {
      for (let col = 0; col < 5; col += 1) {
        const y = 24.6 + row * 1.05;
        const z = 0.5 + (y - 25.6) * -0.42;
        lamps.push([new BoxGeometry(0.95, 0.8, 0.14), at(-2.3 + col * 1.15, y, z, 0, 1, -0.4)]);
      }
    }
    return {
      parts: [
        { geometry: steel, material: MAT.steel() },
        { geometry: merge(head), material: MAT.navy() },
        { geometry: merge(lamps), material: MAT.lamp() },
      ],
      castShadow: true,
    };
  });

/** A pitch-side lamp post, 4.6 units tall, twin lamps facing +Z. */
export const lampPost = (): Prop =>
  once('lampPost', () => {
    const post = merge([
      [new CylinderGeometry(0.1, 0.16, 4.2, 6), at(0, 2.1, 0)],
      [new CylinderGeometry(0.34, 0.42, 0.26, 8), at(0, 0.13, 0)],
      [new BoxGeometry(1.5, 0.12, 0.12), at(0, 4.2, 0)],
    ]);
    const heads = merge([
      [new BoxGeometry(0.62, 0.46, 0.34), at(-0.62, 4.42, 0.06, 0, 1, -0.3)],
      [new BoxGeometry(0.62, 0.46, 0.34), at(0.62, 4.42, 0.06, 0, 1, -0.3)],
    ]);
    const light = merge([
      [new BoxGeometry(0.5, 0.34, 0.06), at(-0.62, 4.42, 0.25, 0, 1, -0.3)],
      [new BoxGeometry(0.5, 0.34, 0.06), at(0.62, 4.42, 0.25, 0, 1, -0.3)],
    ]);
    return {
      parts: [
        { geometry: post, material: MAT.steel() },
        { geometry: heads, material: MAT.navy() },
        { geometry: light, material: MAT.lamp() },
      ],
      castShadow: true,
    };
  });

/**
 * Net cords filling the rectangle spanned by `origin`, `u` and `v`, spaced
 * about `step` apart.
 */
const netPanel = (
  origin: Vector3,
  u: Vector3,
  v: Vector3,
  step: number,
  cord: number,
): [BufferGeometry, Matrix4][] => {
  const cords: [BufferGeometry, Matrix4][] = [];
  const nu = Math.max(1, Math.round(u.length() / step));
  const nv = Math.max(1, Math.round(v.length() / step));
  for (let i = 0; i <= nu; i += 1) {
    const a = origin.clone().addScaledVector(u, i / nu);
    cords.push(bar(a, a.clone().add(v), cord));
  }
  for (let j = 0; j <= nv; j += 1) {
    const a = origin.clone().addScaledVector(v, j / nv);
    cords.push(bar(a, a.clone().add(u), cord));
  }
  return cords;
};

/**
 * A full-size goal facing +Z: white posts and crossbar, stanchions running
 * back, and a net over the back, sides and roof. 13 wide, 4.4 tall.
 */
export const goal = (): Prop =>
  once('goal', () => {
    const w = 6.5;
    const h = 4.4;
    const d = 3.4;
    const r = 0.2;
    const frame = merge([
      [new CylinderGeometry(r, r, h, 10), at(-w, h / 2, 0)],
      [new CylinderGeometry(r, r, h, 10), at(w, h / 2, 0)],
      [new CylinderGeometry(r, r, w * 2 + r * 2, 10), at(0, h, 0, 0, 1, 0, Math.PI / 2)],
    ]);
    const stanchions = merge([
      bar(new Vector3(-w, h, 0), new Vector3(-w, h * 0.7, -d), 0.12),
      bar(new Vector3(w, h, 0), new Vector3(w, h * 0.7, -d), 0.12),
      bar(new Vector3(-w, h * 0.7, -d), new Vector3(-w, 0, -d), 0.12),
      bar(new Vector3(w, h * 0.7, -d), new Vector3(w, 0, -d), 0.12),
      bar(new Vector3(-w, 0.06, -d), new Vector3(w, 0.06, -d), 0.12),
    ]);
    const net = merge([
      ...netPanel(new Vector3(-w, 0, -d), new Vector3(w * 2, 0, 0), new Vector3(0, h * 0.7, 0), 0.9, 0.035),
      ...netPanel(new Vector3(-w, h, 0), new Vector3(w * 2, 0, 0), new Vector3(0, -h * 0.3, -d), 0.9, 0.035),
      ...netPanel(new Vector3(-w, 0, 0), new Vector3(0, 0, -d), new Vector3(0, h, 0), 0.9, 0.035),
      ...netPanel(new Vector3(w, 0, 0), new Vector3(0, 0, -d), new Vector3(0, h, 0), 0.9, 0.035),
    ]);
    return {
      parts: [
        { geometry: frame, material: MAT.white() },
        { geometry: stanchions, material: MAT.steel() },
        { geometry: net, material: MAT.net() },
      ],
      castShadow: true,
    };
  });

/**
 * A giant goal frame built to an exact span: posts at +/- `halfSpan` rising
 * from `footY` to a crossbar at `topY`, with the net over its roof and down
 * its sides running back along -Z. The opening itself is left clear - it is
 * the way out of the start - and none of it is collision.
 */
export const spanGoal = (halfSpan: number, footY: number, topY: number, depth: number): Prop =>
  once(`spanGoal:${halfSpan}:${footY}:${topY}:${depth}`, () => {
    const height = topY - footY;
    const radius = Math.max(0.5, halfSpan * 0.04);
    const frame = merge([
      [new CylinderGeometry(radius, radius, height, 14), at(-halfSpan, footY + height / 2, 0)],
      [new CylinderGeometry(radius, radius, height, 14), at(halfSpan, footY + height / 2, 0)],
      [new CylinderGeometry(radius, radius, halfSpan * 2 + radius * 2, 14), at(0, topY, 0, 0, 1, 0, Math.PI / 2)],
    ]);
    const back = merge([
      bar(new Vector3(-halfSpan, topY, 0), new Vector3(-halfSpan, topY - height * 0.25, -depth), radius * 0.5),
      bar(new Vector3(halfSpan, topY, 0), new Vector3(halfSpan, topY - height * 0.25, -depth), radius * 0.5),
      bar(new Vector3(-halfSpan, topY - height * 0.25, -depth), new Vector3(-halfSpan, footY, -depth), radius * 0.5),
      bar(new Vector3(halfSpan, topY - height * 0.25, -depth), new Vector3(halfSpan, footY, -depth), radius * 0.5),
    ]);
    const step = 1.6;
    const cord = 0.07;
    const net = merge([
      ...netPanel(
        new Vector3(-halfSpan, topY, 0),
        new Vector3(halfSpan * 2, 0, 0),
        new Vector3(0, -height * 0.25, -depth),
        step,
        cord,
      ),
      ...netPanel(new Vector3(-halfSpan, footY, 0), new Vector3(0, 0, -depth), new Vector3(0, height, 0), step, cord),
      ...netPanel(new Vector3(halfSpan, footY, 0), new Vector3(0, 0, -depth), new Vector3(0, height, 0), step, cord),
    ]);
    return {
      parts: [
        { geometry: frame, material: MAT.white() },
        { geometry: back, material: MAT.steel() },
        { geometry: net, material: MAT.net() },
      ],
      castShadow: true,
    };
  });

/**
 * A football, radius 1, resting on y = 0: a subdivided icosahedron with its
 * twelve pentagon patches painted black through vertex colours.
 */
export const football = (): Prop =>
  once('football', () => {
    const geometry = new IcosahedronGeometry(1, 2).toNonIndexed();
    const base = new IcosahedronGeometry(1, 0);
    const corners: Vector3[] = [];
    const basePosition = base.getAttribute('position') as BufferAttribute;
    for (let i = 0; i < basePosition.count; i += 1) {
      const corner = new Vector3().fromBufferAttribute(basePosition, i).normalize();
      if (!corners.some((c) => c.distanceTo(corner) < 1e-3)) corners.push(corner);
    }
    base.dispose();

    const position = geometry.getAttribute('position') as BufferAttribute;
    const colors = new Float32Array(position.count * 3);
    const centroid = new Vector3();
    const a = new Vector3();
    const b = new Vector3();
    const c = new Vector3();
    for (let f = 0; f < position.count; f += 3) {
      a.fromBufferAttribute(position, f);
      b.fromBufferAttribute(position, f + 1);
      c.fromBufferAttribute(position, f + 2);
      centroid.copy(a).add(b).add(c).normalize();
      const nearest = Math.max(...corners.map((corner) => corner.dot(centroid)));
      const k = nearest > 0.955 ? 0.08 : 1;
      for (let v = 0; v < 3; v += 1) colors.set([k, k, k], (f + v) * 3);
    }
    geometry.setAttribute('color', new BufferAttribute(colors, 3));
    geometry.translate(0, 1, 0);
    return { parts: [{ geometry, material: MAT.ballVc() }], castShadow: true };
  });

/** A giant gold trophy on a navy plinth, about 9 units tall. */
export const trophyCup = (): Prop =>
  once('trophyCup', () => {
    const profile = [
      [0, 0],
      [1.5, 0],
      [1.5, 0.35],
      [0.9, 0.5],
      [0.5, 1.1],
      [0.36, 2.4],
      [0.7, 3.0],
      [1.7, 3.6],
      [2.1, 4.8],
      [2.2, 6.0],
      [2.0, 6.05],
      [0, 5.9],
    ].map(([x, y]) => new Vector2(x, y));
    const cup = new LatheGeometry(profile, 20);
    const handles = merge([
      [new TorusGeometry(1.0, 0.18, 8, 16, Math.PI), at(-2.1, 4.9, 0, 0, 1, 0, Math.PI / 2)],
      [new TorusGeometry(1.0, 0.18, 8, 16, Math.PI), at(2.1, 4.9, 0, 0, 1, 0, -Math.PI / 2)],
    ]);
    const plinth = merge([[new BoxGeometry(4.2, 1.6, 4.2), at(0, 0.8, 0)]]);
    const lift = new Matrix4().makeTranslation(0, 1.6, 0);
    return {
      parts: [
        { geometry: merge([[cup], [handles]]), material: MAT.gold(), matrix: lift },
        { geometry: plinth, material: MAT.navy() },
      ],
      castShadow: true,
    };
  });

/**
 * A grandstand facing +Z: a raked bank of packed seats under a cantilevered
 * roof, 40 wide and about 15 tall.
 */
export const grandstand = (): Prop =>
  once('grandstand', () => {
    const width = 40;
    const depth = 14;
    const height = 12;
    const rake = Math.atan2(height - 1.5, depth);
    const slope = Math.hypot(height - 1.5, depth);

    const seats = new PlaneGeometry(width, slope);
    const uv = seats.getAttribute('uv') as BufferAttribute;
    for (let i = 0; i < uv.count; i += 1) uv.setXY(i, uv.getX(i) * 3, uv.getY(i) * 1.5);
    seats.rotateX(-Math.PI / 2 + rake);
    seats.translate(0, 1.5 + (height - 1.5) / 2, -depth / 2);

    const concrete = merge([
      // Back wall and the two end walls.
      [new BoxGeometry(width + 1, height + 1, 1), at(0, (height + 1) / 2, -depth - 0.5)],
      [new BoxGeometry(1, height + 1, depth + 1), at(-width / 2 - 0.5, (height + 1) / 2, -depth / 2)],
      [new BoxGeometry(1, height + 1, depth + 1), at(width / 2 + 0.5, (height + 1) / 2, -depth / 2)],
    ]);
    const parapet = merge([[new BoxGeometry(width + 2, 1.5, 0.6), at(0, 0.75, 0.2)]]);
    const roof = merge([[new BoxGeometry(width + 3, 0.5, depth + 5), at(0, height + 3.4, -depth / 2 + 1.5)]]);
    const posts: [BufferGeometry, Matrix4][] = [];
    for (const x of [-width / 2, -width / 6, width / 6, width / 2]) {
      posts.push([new CylinderGeometry(0.3, 0.3, height + 3.2, 6), at(x, (height + 3.2) / 2, -depth - 0.2)]);
    }
    return {
      parts: [
        { geometry: seats, material: MAT.crowd() },
        { geometry: concrete, material: MAT.concrete() },
        { geometry: parapet, material: MAT.white() },
        { geometry: roof, material: MAT.navy() },
        { geometry: merge(posts), material: MAT.steel() },
      ],
      castShadow: true,
    };
  });

/** A corner flag, 2.8 tall, its pennant hanging from the top. */
export const cornerFlag = (): Prop =>
  once('cornerFlag', () => {
    const pole = merge([[new CylinderGeometry(0.06, 0.06, 2.8, 6), at(0, 1.4, 0)]]);
    const cloth = triangle(1.1, 0.8);
    cloth.rotateY(Math.PI / 2);
    cloth.translate(0, 2.75, 0.55);
    return {
      parts: [
        { geometry: pole, material: MAT.white() },
        { geometry: cloth, material: MAT.flagRed() },
      ],
    };
  });

/**
 * A string of pennants `span` long along X, sagging `sag` in the middle,
 * hung from y = 0. Four colours in rotation, each colour one draw.
 */
export const bunting = (span: number, sag: number): Prop =>
  once(`bunting:${span}:${sag}`, () => {
    const colors = [WORLD_COLORS.red, WORLD_COLORS.green, WORLD_COLORS.white, 0xffd84a] as const;
    const groups: [BufferGeometry, Matrix4][][] = colors.map(() => []);
    const count = Math.max(4, Math.round(span / 1.3));
    for (let i = 0; i < count; i += 1) {
      const x = -span / 2 + ((i + 0.5) * span) / count;
      const t = x / (span / 2);
      const y = -sag + sag * t * t;
      (groups[i % colors.length] as [BufferGeometry, Matrix4][]).push([triangle(0.9, 1.1), at(x, y, 0)]);
    }
    const rope = merge([[bentBox(span, 0.06, 0.06, sag), at(0, -sag, 0)]]);
    return {
      parts: [
        { geometry: rope, material: MAT.ink() },
        ...colors.map((color, i) => ({
          geometry: merge(groups[i] as [BufferGeometry, Matrix4][]),
          material: MAT.pennant(color),
        })),
      ],
    };
  });

/** A stadium lamp hung from its hook at y = 0, shining down. */
export const hangingLamp = (): Prop =>
  once('hangingLamp', () => {
    const housing = merge([
      [new CylinderGeometry(0.03, 0.03, 0.9, 4), at(0, -0.45, 0)],
      [new CylinderGeometry(0.28, 0.62, 0.5, 10), at(0, -1.1, 0)],
    ]);
    const light = merge([[new CylinderGeometry(0.56, 0.56, 0.08, 10), at(0, -1.38, 0)]]);
    return {
      parts: [
        { geometry: housing, material: MAT.navy() },
        { geometry: light, material: MAT.lamp() },
      ],
    };
  });

/** A small painted pitch, 24 x 15, with a goal at each end. Top at y = 0.05. */
export const miniPitch = (): Prop =>
  once('miniPitch', () => {
    const turf = new BoxGeometry(24, 0.1, 15);
    const goals: PropPart[] = goal().parts.flatMap((part) => [
      { ...part, matrix: at(-12, 0.05, 0, Math.PI / 2, 0.45) },
      { ...part, matrix: at(12, 0.05, 0, -Math.PI / 2, 0.45) },
    ]);
    return {
      parts: [{ geometry: turf, material: MAT.pitch() }, ...goals],
      castShadow: true,
    };
  });

/**
 * A supporters' flag on its pole, 6.4 tall. `design` picks the atlas column.
 * The cloth hangs from its top edge and flutters at the hem.
 */
export const banner = (design: number): Prop =>
  once(`banner:${design}`, () => {
    const columns = BANNER_DESIGNS.length;
    const cloth = new PlaneGeometry(1.25, 4.8, 2, 8);
    // Pick this design's column of the atlas.
    const uv = cloth.getAttribute('uv') as BufferAttribute;
    for (let i = 0; i < uv.count; i += 1) uv.setX(i, (design + uv.getX(i)) / columns);
    // Hang from y = 0 (top edge) down to -4.8, so the sway shader pins the top.
    cloth.translate(0.72, -2.4, 0);
    const clothMaterial = toon(0xffffff, {
      map: bannerAtlas(),
      doubleSide: true,
      sway: 0.045,
      swayBase: 0,
      swayDir: -1,
    });
    const pole = merge([
      [new CylinderGeometry(0.07, 0.09, 6.4, 6), at(0, -3.0, 0)],
      [new CylinderGeometry(0.045, 0.045, 1.45, 5), at(0.72, 0, 0, 0, 1, 0, Math.PI / 2)],
      [new IcosahedronGeometry(0.12, 0), at(0, 0.3, 0)],
    ]);
    // Placement puts the pole foot on the ground, so lift everything by 6.1.
    const lift = new Matrix4().makeTranslation(0, 6.1, 0);
    return {
      parts: [
        { geometry: cloth, material: clothMaterial, matrix: lift },
        { geometry: pole, material: MAT.steel(), matrix: lift },
      ],
      castShadow: true,
    };
  });

/** A mossy boulder. Seeded so every client grows the same stone. */
export const boulder = (seed: number): Prop =>
  once(`boulder:${seed}`, () => {
    const geometry = new DodecahedronGeometry(1, 1).toNonIndexed();
    const random = seededRandom(seed);
    const position = geometry.getAttribute('position') as BufferAttribute;
    const jitter = new Map<string, number>();
    const colors = new Float32Array(position.count * 3);
    const rock = new Color(0x9a9082);
    const moss = new Color(0x6f9a4a);
    for (let i = 0; i < position.count; i += 1) {
      const x = position.getX(i);
      const y = position.getY(i);
      const z = position.getZ(i);
      const key = `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
      let k = jitter.get(key);
      if (k === undefined) {
        k = 0.8 + random() * 0.35;
        jitter.set(key, k);
      }
      position.setXYZ(i, x * k * 1.2, Math.max(y * k * 0.8, -0.3), z * k);
      const c = y > 0.45 ? moss : rock;
      colors.set([c.r, c.g, c.b], i * 3);
    }
    geometry.setAttribute('color', new BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    return { parts: [{ geometry, material: MAT.rockVc() }], castShadow: true };
  });

/**
 * A floating islet: a grassy disc on an inverted rock spire. Scenery that
 * holds trees and pitch-side props beside the route without touching the play
 * space. Its top surface sits at y = 0.
 */
export const floatingIslet = (): Prop =>
  once('floatingIslet', () => {
    const rock = merge([
      [new CylinderGeometry(4.2, 0.6, 7, 7), at(0, -3.9, 0)],
      [new CylinderGeometry(2.2, 0.3, 4, 6), at(1.6, -6.5, 0.8)],
    ]);
    const top = merge([[new CylinderGeometry(4.5, 4.3, 0.8, 9), at(0, -0.4, 0)]]);
    return {
      parts: [
        { geometry: rock, material: toon(0x8a7f73) },
        { geometry: top, material: toon(0x79b64a) },
      ],
    };
  });

/**
 * A waterfall sheet 1 wide and 1 tall, hanging from y = 0. Callers scale it.
 * The shared material's texture is scrolled once a frame by `animateWater`.
 */
let waterfallMaterial: MeshBasicMaterial | null = null;
export const waterfall = (): Prop =>
  once('waterfall', () => {
    const geometry = new PlaneGeometry(1, 1);
    geometry.translate(0, -0.5, 0);
    const map = waterfallStreaks().clone();
    map.needsUpdate = true;
    waterfallMaterial = new MeshBasicMaterial({
      map,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      opacity: 0.9,
    });
    return { parts: [{ geometry, material: waterfallMaterial }] };
  });

/** Scroll every waterfall. */
export const animateWaterfalls = (delta: number): void => {
  const map = waterfallMaterial?.map;
  if (map) map.offset.y += delta * 1.6;
};

/** Build a prop from explicit parts (for one-off, per-scene pieces). */
export const customProp = (parts: PropPart[], castShadow = false): Prop => ({ parts, castShadow });
