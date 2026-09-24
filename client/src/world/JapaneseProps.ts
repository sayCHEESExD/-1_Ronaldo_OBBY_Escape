import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DodecahedronGeometry,
  DoubleSide,
  ExtrudeGeometry,
  IcosahedronGeometry,
  Matrix4,
  MeshBasicMaterial,
  PlaneGeometry,
  Shape,
  SphereGeometry,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { WORLD_COLORS } from '../config/worldVisuals.js';
import { BANNER_DESIGNS, bannerAtlas, lanternPaper, roofTiles, waterfallStreaks } from './JapaneseArt.js';
import { at, seededRandom, type Prop, type PropPart } from './PropBatch.js';
import { glow, toon } from './ToonKit.js';

/**
 * The Japanese prop library, built once from primitives.
 *
 * Each prop merges everything that shares a material into ONE geometry, so a
 * torii is three instanced draws however many stand along the route. Sizes
 * are real-world-ish at scale 1; callers scale the placement.
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

/** A box whose top edge bows up at the ends - a torii lintel or a bridge deck. */
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

/** An arch: the middle rises by `rise` - a drum bridge. */
export const archBox = (width: number, height: number, depth: number, rise: number): BufferGeometry => {
  const geometry = new BoxGeometry(width, height, depth, 20, 1, 1);
  const position = geometry.getAttribute('position') as BufferAttribute;
  for (let i = 0; i < position.count; i += 1) {
    const t = position.getX(i) / (width / 2);
    position.setY(i, position.getY(i) + rise * (1 - t * t));
  }
  geometry.computeVertexNormals();
  return geometry;
};

/**
 * A sweeping gabled roof: concave slopes rising to a ridge, extruded along Z.
 * The concave curve and the lifted eaves are what make it read as Japanese.
 */
export const gableRoof = (width: number, height: number, length: number): BufferGeometry => {
  const half = width / 2;
  const shape = new Shape();
  shape.moveTo(-half, height * 0.08);
  shape.quadraticCurveTo(-half * 0.45, height * 0.22, 0, height);
  shape.quadraticCurveTo(half * 0.45, height * 0.22, half, height * 0.08);
  shape.lineTo(half * 0.94, -height * 0.06);
  shape.quadraticCurveTo(half * 0.4, height * 0.08, 0, height * 0.82);
  shape.quadraticCurveTo(-half * 0.4, height * 0.08, -half * 0.94, -height * 0.06);
  shape.closePath();
  const geometry = new ExtrudeGeometry(shape, { depth: length, bevelEnabled: false, curveSegments: 6 });
  geometry.translate(0, 0, -length / 2);
  return geometry;
};

/** A square hipped roof tier: a four-sided frustum turned to face the axes. */
export const hipRoof = (bottomHalf: number, topHalf: number, height: number): BufferGeometry => {
  const geometry = new CylinderGeometry(topHalf * Math.SQRT2, bottomHalf * Math.SQRT2, height, 4, 1);
  geometry.rotateY(Math.PI / 4);
  return geometry;
};

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

export const MAT = {
  red: () => toon(WORLD_COLORS.vermilion),
  redGlow: () => toon(WORLD_COLORS.vermilion, { emissive: 0xff3a1a, emissiveIntensity: 0.45 }),
  ink: () => toon(WORLD_COLORS.ink),
  gold: () => toon(WORLD_COLORS.gold, { emissive: 0x6a4a00, emissiveIntensity: 0.4 }),
  stone: () => toon(WORLD_COLORS.stone),
  stoneDark: () => toon(WORLD_COLORS.stoneDark),
  wood: () => toon(0x8a5a3a),
  timber: () => toon(WORLD_COLORS.timber),
  plaster: () => toon(0xf6ecd8),
  roof: () => toon(0xffffff, { map: roofTiles() }),
  straw: () => toon(0xe8d28a),
  paper: () => glow(0xffffff, { doubleSide: true }),
  lanternLight: () => glow(0xffd889),
  lanternPaper: () => glow(0xffffff, { map: lanternPaper() }),
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
 * A torii gate, 10 units tall with pillars 9 apart.
 *
 * `glowing` gives the lacquer an inner light, for the late route where the
 * sky darkens and the gates have to carry the scene.
 */
export const torii = (glowing = false): Prop =>
  once(`torii:${glowing}`, () => {
    const red = merge([
      [new CylinderGeometry(0.42, 0.5, 9.4, 10), at(-4.5, 4.7, 0)],
      [new CylinderGeometry(0.42, 0.5, 9.4, 10), at(4.5, 4.7, 0)],
      [new BoxGeometry(11.4, 0.55, 0.42), at(0, 7.3, 0)],
      [bentBox(12.6, 0.5, 0.75, 0.35), at(0, 9.3, 0)],
      [new BoxGeometry(0.45, 1.5, 0.36), at(0, 8.3, 0)],
    ]);
    const ink = merge([
      [bentBox(14.2, 0.55, 1.05, 0.62), at(0, 9.82, 0)],
      [new CylinderGeometry(0.62, 0.62, 0.7, 10), at(-4.5, 0.35, 0)],
      [new CylinderGeometry(0.62, 0.62, 0.7, 10), at(4.5, 0.35, 0)],
    ]);
    return {
      parts: [
        { geometry: red, material: glowing ? MAT.redGlow() : MAT.red() },
        { geometry: ink, material: MAT.ink() },
      ],
      castShadow: true,
    };
  });

/**
 * A torii built to an exact span: pillars at +/- `halfSpan`, rising from
 * `footY` to a lintel at `topY`. Used where a gate must frame something of a
 * fixed width - the gorge mouth and every island - without scaling the
 * pillars into ovals.
 */
export const spanTorii = (halfSpan: number, footY: number, topY: number, glowing: boolean): Prop =>
  once(`spanTorii:${halfSpan}:${footY}:${topY}:${glowing}`, () => {
    const height = topY - footY;
    const radius = Math.max(0.5, halfSpan * 0.045);
    const nukiY = topY - height * 0.22;
    const red = merge([
      [new CylinderGeometry(radius * 0.85, radius, height, 12), at(-halfSpan, footY + height / 2, 0)],
      [new CylinderGeometry(radius * 0.85, radius, height, 12), at(halfSpan, footY + height / 2, 0)],
      [new BoxGeometry(halfSpan * 2 + radius * 5, radius * 1.3, radius * 1.0), at(0, nukiY, 0)],
      [bentBox(halfSpan * 2 + radius * 7, radius * 1.1, radius * 1.7, radius * 0.9), at(0, topY - radius * 0.9, 0)],
      [new BoxGeometry(radius * 1.0, topY - nukiY - radius * 1.4, radius * 0.8), at(0, (topY + nukiY) / 2 - radius * 0.5, 0)],
    ]);
    const ink = merge([
      [bentBox(halfSpan * 2 + radius * 10, radius * 1.25, radius * 2.3, radius * 1.6), at(0, topY + radius * 0.35, 0)],
      [new CylinderGeometry(radius * 1.3, radius * 1.3, radius * 1.6, 12), at(-halfSpan, footY + radius * 0.8, 0)],
      [new CylinderGeometry(radius * 1.3, radius * 1.3, radius * 1.6, 12), at(halfSpan, footY + radius * 0.8, 0)],
    ]);
    return {
      parts: [
        { geometry: red, material: glowing ? MAT.redGlow() : MAT.red() },
        { geometry: ink, material: MAT.ink() },
      ],
      castShadow: true,
    };
  });

/** A still garden pond: a flat disc of water ringed with stones. Top at y = 0.05. */
export const pond = (): Prop =>
  once('pond', () => {
    const water = new CylinderGeometry(6, 6, 0.1, 18);
    const stones: [BufferGeometry, Matrix4][] = [];
    for (let i = 0; i < 16; i += 1) {
      const angle = (i / 16) * Math.PI * 2;
      stones.push([
        new DodecahedronGeometry(0.7 + (i % 3) * 0.15, 0),
        at(Math.cos(angle) * 6.3, 0.15, Math.sin(angle) * 6.3, angle, [1.2, 0.55, 1]),
      ]);
    }
    return {
      parts: [
        { geometry: water, material: toon(0x3aa6d8, { emissive: 0x0a4a70, emissiveIntensity: 0.3 }) },
        { geometry: merge(stones), material: MAT.stone() },
      ],
    };
  });

/** A shimenawa rope with zig-zag shide paper, 9 units long, hung from y = 0. */
export const shimenawa = (): Prop =>
  once('shimenawa', () => {
    const rope = merge([
      [bentBox(9, 0.36, 0.36, -0.5), at(0, 0, 0)],
      [bentBox(9, 0.22, 0.22, -0.5), at(0, 0.18, 0.05)],
    ]);
    const shide: [BufferGeometry, Matrix4][] = [];
    for (const x of [-3, -1, 1, 3]) {
      const sag = -0.5 * (x / 4.5) ** 2 - 0.2;
      for (let k = 0; k < 3; k += 1) {
        shide.push([new PlaneGeometry(0.34, 0.34), at(x + (k % 2 ? 0.1 : -0.1), sag - 0.4 - k * 0.32, 0)]);
      }
    }
    return {
      parts: [
        { geometry: rope, material: MAT.straw() },
        { geometry: merge(shide), material: MAT.paper() },
      ],
    };
  });

/** A stone tōrō, 2.7 units tall, with a warm light in its firebox. */
export const stoneLantern = (): Prop =>
  once('stoneLantern', () => {
    const stone = merge([
      [new CylinderGeometry(0.55, 0.68, 0.3, 6), at(0, 0.15, 0)],
      [new CylinderGeometry(0.17, 0.22, 1.1, 8), at(0, 0.85, 0)],
      [new CylinderGeometry(0.52, 0.42, 0.22, 6), at(0, 1.5, 0)],
      [new BoxGeometry(0.1, 0.5, 0.1), at(0.24, 1.86, 0.24)],
      [new BoxGeometry(0.1, 0.5, 0.1), at(-0.24, 1.86, 0.24)],
      [new BoxGeometry(0.1, 0.5, 0.1), at(0.24, 1.86, -0.24)],
      [new BoxGeometry(0.1, 0.5, 0.1), at(-0.24, 1.86, -0.24)],
      [new CylinderGeometry(0.06, 0.8, 0.42, 6), at(0, 2.32, 0)],
      [new IcosahedronGeometry(0.14, 0), at(0, 2.62, 0)],
    ]);
    const light = new BoxGeometry(0.4, 0.44, 0.4);
    light.translate(0, 1.86, 0);
    return {
      parts: [
        { geometry: stone, material: MAT.stone() },
        { geometry: light, material: MAT.lanternLight() },
      ],
      castShadow: true,
    };
  });

/** A hanging paper chōchin. Origin is the hook, 1.4 above the lantern's centre. */
export const paperLantern = (): Prop =>
  once('paperLantern', () => {
    const body = new SphereGeometry(0.46, 12, 8);
    body.scale(1, 1.3, 1);
    body.translate(0, -1.4, 0);
    const caps = merge([
      [new CylinderGeometry(0.27, 0.27, 0.12, 10), at(0, -0.8, 0)],
      [new CylinderGeometry(0.27, 0.27, 0.12, 10), at(0, -2.0, 0)],
      [new CylinderGeometry(0.02, 0.02, 0.75, 4), at(0, -0.38, 0)],
    ]);
    return {
      parts: [
        { geometry: body, material: MAT.lanternPaper() },
        { geometry: caps, material: MAT.ink() },
      ],
    };
  });

/**
 * A nobori banner on its pole, 6.4 tall. `design` picks the atlas column.
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
        { geometry: pole, material: MAT.timber(), matrix: lift },
      ],
      castShadow: true,
    };
  });

/** A five-storey pagoda, about 30 units tall. */
export const pagoda = (): Prop =>
  once('pagoda', () => {
    const body: [BufferGeometry, Matrix4][] = [];
    const roofs: [BufferGeometry, Matrix4][] = [];
    const gold: [BufferGeometry, Matrix4][] = [];
    const stone = merge([[new BoxGeometry(10, 1.2, 10), at(0, 0.6, 0)]]);
    let y = 1.2;
    for (let i = 0; i < 5; i += 1) {
      const half = 3.1 - i * 0.32;
      const storey = 2.5 - i * 0.12;
      body.push([new BoxGeometry(half * 2, storey, half * 2), at(0, y + storey / 2, 0)]);
      y += storey;
      roofs.push([hipRoof(half + 2.1, half * 0.55, 1.0), at(0, y + 0.3, 0)]);
      y += 0.95;
    }
    gold.push([new CylinderGeometry(0.16, 0.22, 6, 6), at(0, y + 3, 0)]);
    for (let k = 0; k < 6; k += 1) {
      gold.push([new CylinderGeometry(0.55 - k * 0.04, 0.55 - k * 0.04, 0.14, 10), at(0, y + 1 + k * 0.62, 0)]);
    }
    gold.push([new IcosahedronGeometry(0.4, 0), at(0, y + 6.2, 0)]);
    return {
      parts: [
        { geometry: stone, material: MAT.stone() },
        { geometry: merge(body), material: MAT.red() },
        { geometry: merge(roofs), material: MAT.roof() },
        { geometry: merge(gold), material: MAT.gold() },
      ],
      castShadow: true,
    };
  });

/** A shrine hall: stone plinth, timber veranda, red pillars, sweeping roof. */
export const shrineHall = (): Prop =>
  once('shrineHall', () => {
    const stone = merge([
      [new BoxGeometry(15, 1.2, 11), at(0, 0.6, 0)],
      [new BoxGeometry(5, 0.4, 2), at(0, 0.2, 6.2)],
      [new BoxGeometry(5, 0.4, 1.2), at(0, 0.6, 5.6)],
    ]);
    const wood = merge([[new BoxGeometry(13.6, 0.4, 9.6), at(0, 1.4, 0)]]);
    const plaster = merge([[new BoxGeometry(11, 4.2, 7), at(0, 3.7, 0)]]);
    const red: [BufferGeometry, Matrix4][] = [];
    for (const x of [-6.2, -2.1, 2.1, 6.2]) {
      for (const z of [-4.3, 4.3]) red.push([new CylinderGeometry(0.3, 0.32, 4.6, 8), at(x, 3.9, z)]);
    }
    red.push([new BoxGeometry(13.2, 0.5, 0.5), at(0, 6.1, 4.3)]);
    red.push([new BoxGeometry(13.2, 0.5, 0.5), at(0, 6.1, -4.3)]);
    const roof = gableRoof(12.5, 5, 17);
    roof.rotateY(Math.PI / 2);
    roof.translate(0, 6.2, 0);
    const gold = merge([
      [new BoxGeometry(16, 0.5, 0.7), at(0, 11.2, 0)],
      [new BoxGeometry(0.3, 2.2, 0.3), at(-7.6, 11.9, 0, 0, 1, 0, 0.5)],
      [new BoxGeometry(0.3, 2.2, 0.3), at(-7.6, 11.9, 0, 0, 1, 0, -0.5)],
      [new BoxGeometry(0.3, 2.2, 0.3), at(7.6, 11.9, 0, 0, 1, 0, 0.5)],
      [new BoxGeometry(0.3, 2.2, 0.3), at(7.6, 11.9, 0, 0, 1, 0, -0.5)],
    ]);
    const rope = merge([[bentBox(8, 0.5, 0.5, -0.6), at(0, 5.6, 4.8)]]);
    return {
      parts: [
        { geometry: stone, material: MAT.stone() },
        { geometry: wood, material: MAT.wood() },
        { geometry: plaster, material: MAT.plaster() },
        { geometry: merge(red), material: MAT.red() },
        { geometry: roof, material: MAT.roof() },
        { geometry: gold, material: MAT.gold() },
        { geometry: rope, material: MAT.straw() },
      ],
      castShadow: true,
    };
  });

/** A small hokora wayside shrine, 2.4 units tall. */
export const smallShrine = (): Prop =>
  once('smallShrine', () => {
    const stone = merge([[new BoxGeometry(2, 0.6, 1.6), at(0, 0.3, 0)]]);
    const wood = merge([[new BoxGeometry(1.3, 1.1, 1.0), at(0, 1.15, 0)]]);
    const roof = gableRoof(2.1, 0.8, 1.7);
    roof.rotateY(Math.PI / 2);
    roof.translate(0, 1.7, 0);
    const red = merge([[new BoxGeometry(0.9, 0.5, 0.06), at(0, 1.2, 0.52)]]);
    return {
      parts: [
        { geometry: stone, material: MAT.stone() },
        { geometry: wood, material: MAT.wood() },
        { geometry: roof, material: MAT.roof() },
        { geometry: red, material: MAT.red() },
      ],
      castShadow: true,
    };
  });

/** A red drum bridge spanning 20 units along X, rising 3.2 at its crown. */
export const drumBridge = (): Prop =>
  once('drumBridge', () => {
    const deck = merge([[archBox(20, 0.5, 3.2, 3.2), at(0, 0, 0)]]);
    const red: [BufferGeometry, Matrix4][] = [
      [archBox(20, 0.22, 0.22, 3.2), at(0, 1.2, 1.5)],
      [archBox(20, 0.22, 0.22, 3.2), at(0, 1.2, -1.5)],
      [archBox(20, 0.16, 0.16, 3.2), at(0, 0.7, 1.5)],
      [archBox(20, 0.16, 0.16, 3.2), at(0, 0.7, -1.5)],
    ];
    for (let x = -9; x <= 9; x += 2.25) {
      const t = x / 10;
      const y = 3.2 * (1 - t * t);
      for (const z of [-1.5, 1.5]) red.push([new CylinderGeometry(0.13, 0.13, 1.4, 6), at(x, y + 0.65, z)]);
    }
    const gold: [BufferGeometry, Matrix4][] = [];
    for (const x of [-9, 0, 9]) {
      const t = x / 10;
      const y = 3.2 * (1 - t * t);
      for (const z of [-1.5, 1.5]) gold.push([new IcosahedronGeometry(0.2, 0), at(x, y + 1.5, z)]);
    }
    return {
      parts: [
        { geometry: deck, material: MAT.wood() },
        { geometry: merge(red), material: MAT.red() },
        { geometry: merge(gold), material: MAT.gold() },
      ],
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
 * holds trees and shrines beside the route without touching the play space.
 * Its top surface sits at y = 0.
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

/** A flat stepping stone, top at y = 0.06. */
export const steppingStone = (): Prop =>
  once('steppingStone', () => {
    const geometry = new CylinderGeometry(0.95, 1.05, 0.16, 7);
    geometry.translate(0, -0.02, 0);
    return { parts: [{ geometry, material: toon(0xc9c2b0) }] };
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
