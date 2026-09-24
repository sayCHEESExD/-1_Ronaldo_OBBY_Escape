import {
  BufferAttribute,
  CylinderGeometry,
  IcosahedronGeometry,
  Matrix4,
  Quaternion,
  SphereGeometry,
  Vector3,
  type BufferGeometry,
} from 'three';
import { WORLD_COLORS } from '../config/worldVisuals.js';
import { merge } from './WorldProps.js';
import { seededRandom, type Prop } from './PropBatch.js';
import { toon } from './ToonKit.js';

/**
 * Procedural trees: broadleaf parkland trees in several builds and tones, and
 * pines.
 *
 * Every tree is grown from a seed, so the SAME seed gives the same tree on
 * every client, and different seeds give genuinely different silhouettes -
 * not one model stamped across the map. Branch structure is real geometry;
 * the canopy is a cluster of soft blobs lit through the cel ramp, and it
 * sways in the shared wind.
 */

const UP = new Vector3(0, 1, 0);

/** A tapered cylinder from `a` to `b`. */
const limb = (a: Vector3, b: Vector3, r0: number, r1: number): [BufferGeometry, Matrix4] => {
  const direction = new Vector3().subVectors(b, a);
  const length = direction.length();
  const geometry = new CylinderGeometry(r1, r0, length, 6, 1, true);
  const matrix = new Matrix4().compose(
    new Vector3().addVectors(a, b).multiplyScalar(0.5),
    new Quaternion().setFromUnitVectors(UP, direction.normalize()),
    new Vector3(1, 1, 1),
  );
  return [geometry, matrix];
};

/**
 * A canopy blob with a brightness baked into vertex colours: lit on top,
 * shaded underneath. Neutral grey, so the SAME canopy reads as summer green,
 * deep green or autumn depending only on the material it is drawn with.
 */
const blob = (
  centre: Vector3,
  radius: number,
  squash: number,
  shade: number,
  detail = 1,
): [BufferGeometry, Matrix4] => {
  const geometry = new IcosahedronGeometry(radius, detail);
  const normal = geometry.getAttribute('normal') as BufferAttribute;
  const colors = new Float32Array(normal.count * 3);
  for (let i = 0; i < normal.count; i += 1) {
    const k = Math.min(1, shade * (0.84 + 0.2 * normal.getY(i)));
    colors[i * 3] = k;
    colors[i * 3 + 1] = k;
    colors[i * 3 + 2] = k;
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  const matrix = new Matrix4().compose(centre, new Quaternion(), new Vector3(1, squash, 1));
  return [geometry, matrix];
};

export type CanopyTone = 'leaf' | 'leafDeep' | 'leafLight' | 'autumn' | 'pine';

const CANOPY_COLORS: Record<CanopyTone, number> = {
  leaf: WORLD_COLORS.leaf,
  leafDeep: WORLD_COLORS.leafDeep,
  leafLight: WORLD_COLORS.leafLight,
  autumn: WORLD_COLORS.autumn,
  pine: WORLD_COLORS.pine,
};

export interface TreeShape {
  /** Overall height of the trunk before it splits. */
  readonly trunk: number;
  readonly branches: number;
  /** How far the crown spreads sideways. */
  readonly spread: number;
  readonly blobs: number;
  readonly blobSize: number;
}

/** Named builds. A grand old tree, a garden tree, a sapling and a wide umbrella. */
export const TREE_SHAPES = {
  grand: { trunk: 4.2, branches: 5, spread: 5.2, blobs: 14, blobSize: 2.3 },
  garden: { trunk: 3.2, branches: 4, spread: 3.6, blobs: 9, blobSize: 1.8 },
  sapling: { trunk: 2.2, branches: 3, spread: 2.2, blobs: 5, blobSize: 1.3 },
  umbrella: { trunk: 3.6, branches: 6, spread: 6.2, blobs: 12, blobSize: 1.9 },
} as const satisfies Record<string, TreeShape>;

export type TreeBuild = keyof typeof TREE_SHAPES;

const cache = new Map<string, { bark: BufferGeometry; canopy: BufferGeometry }>();

/** Grow a broadleaf tree's geometry: bark and canopy, from one seed. */
const grow = (build: TreeBuild, seed: number): { bark: BufferGeometry; canopy: BufferGeometry } => {
  const key = `${build}:${seed}`;
  const existing = cache.get(key);
  if (existing) return existing;

  const shape: TreeShape = TREE_SHAPES[build];
  const random = seededRandom(seed);
  const bark: [BufferGeometry, Matrix4][] = [];
  const canopy: [BufferGeometry, Matrix4][] = [];

  // A trunk that kinks once or twice - old parkland trees are never straight.
  const base = new Vector3(0, -0.3, 0);
  const mid = new Vector3((random() - 0.5) * 0.9, shape.trunk * 0.55, (random() - 0.5) * 0.9);
  const top = new Vector3(mid.x + (random() - 0.5) * 0.8, shape.trunk, mid.z + (random() - 0.5) * 0.8);
  const girth = 0.22 + shape.trunk * 0.07;
  bark.push(limb(base, mid, girth * 1.25, girth));
  bark.push(limb(mid, top, girth, girth * 0.75));

  for (let b = 0; b < shape.branches; b += 1) {
    const angle = (b / shape.branches) * Math.PI * 2 + random() * 0.8;
    const reach = shape.spread * (0.6 + random() * 0.4);
    const rise = shape.trunk * (0.35 + random() * 0.35);
    const elbow = new Vector3(
      top.x + Math.cos(angle) * reach * 0.5,
      top.y + rise * 0.6,
      top.z + Math.sin(angle) * reach * 0.5,
    );
    const tip = new Vector3(
      top.x + Math.cos(angle) * reach,
      top.y + rise,
      top.z + Math.sin(angle) * reach,
    );
    bark.push(limb(top, elbow, girth * 0.62, girth * 0.4));
    bark.push(limb(elbow, tip, girth * 0.4, girth * 0.18));
  }

  for (let i = 0; i < shape.blobs; i += 1) {
    const angle = random() * Math.PI * 2;
    const distance = shape.spread * Math.sqrt(random()) * 0.95;
    const centre = new Vector3(
      top.x + Math.cos(angle) * distance,
      top.y + shape.trunk * (0.45 + random() * 0.55) - distance * 0.18,
      top.z + Math.sin(angle) * distance,
    );
    const size = shape.blobSize * (0.7 + random() * 0.5);
    canopy.push(blob(centre, size, 0.72 + random() * 0.2, 0.86 + random() * 0.14));
  }
  // A crowning blob so the silhouette domes rather than flattens.
  canopy.push(blob(new Vector3(top.x, top.y + shape.trunk * 0.95, top.z), shape.blobSize * 1.15, 0.7, 1));

  const grown = { bark: merge(bark), canopy: merge(canopy) };
  cache.set(key, grown);
  return grown;
};

const props = new Map<string, Prop>();

/**
 * A broadleaf tree prop. The canopy sways from the top of the trunk up;
 * `tone` picks its green, or autumn.
 */
export const broadleaf = (build: TreeBuild, seed: number, tone: CanopyTone): Prop => {
  const key = `${build}:${seed}:${tone}`;
  const existing = props.get(key);
  if (existing) return existing;
  const grown = grow(build, seed);
  const shape = TREE_SHAPES[build];
  const prop: Prop = {
    parts: [
      { geometry: grown.bark, material: toon(WORLD_COLORS.bark) },
      {
        geometry: grown.canopy,
        material: toon(CANOPY_COLORS[tone], {
          vertexColors: true,
          sway: 0.03,
          swayBase: shape.trunk,
        }),
      },
    ],
    castShadow: true,
  };
  props.set(key, prop);
  return prop;
};

/** A pine: a leaning trunk carrying flat layers of needles. */
export const pineTree = (seed: number): Prop => {
  const key = `pine:${seed}`;
  const existing = props.get(key);
  if (existing) return existing;
  const random = seededRandom(seed);
  const bark: [BufferGeometry, Matrix4][] = [];
  const pads: [BufferGeometry, Matrix4][] = [];
  const lean = (random() - 0.5) * 1.6;
  const points = [new Vector3(0, -0.3, 0)];
  for (let i = 1; i <= 4; i += 1) {
    points.push(new Vector3(lean * i * 0.5 + (random() - 0.5) * 0.6, i * 1.6, (random() - 0.5) * 0.6));
  }
  for (let i = 0; i < points.length - 1; i += 1) {
    bark.push(limb(points[i] as Vector3, points[i + 1] as Vector3, 0.42 - i * 0.07, 0.35 - i * 0.07));
  }
  const padCount = 5 + Math.floor(random() * 3);
  for (let i = 0; i < padCount; i += 1) {
    const anchor = points[1 + (i % 4)] as Vector3;
    const angle = random() * Math.PI * 2;
    const reach = 1.2 + random() * 1.8;
    const centre = new Vector3(
      anchor.x + Math.cos(angle) * reach,
      anchor.y + 0.4 + random() * 0.6,
      anchor.z + Math.sin(angle) * reach,
    );
    bark.push(limb(anchor, centre, 0.16, 0.08));
    const pad = new SphereGeometry(1.3 + random() * 0.8, 9, 5);
    const normal = pad.getAttribute('normal') as BufferAttribute;
    const colors = new Float32Array(normal.count * 3);
    for (let v = 0; v < normal.count; v += 1) {
      const k = Math.min(1, 0.8 + 0.25 * normal.getY(v));
      colors.set([k, k, k], v * 3);
    }
    pad.setAttribute('color', new BufferAttribute(colors, 3));
    pads.push([pad, new Matrix4().compose(centre, new Quaternion(), new Vector3(1, 0.36, 1))]);
  }
  const prop: Prop = {
    parts: [
      { geometry: merge(bark), material: toon(0x4a3a30) },
      {
        geometry: merge(pads),
        material: toon(WORLD_COLORS.pine, { vertexColors: true, sway: 0.012, swayBase: 2 }),
      },
    ],
    castShadow: true,
  };
  props.set(key, prop);
  return prop;
};

export const disposeTrees = (): void => {
  const seen = new Set<BufferGeometry>();
  for (const prop of props.values()) for (const part of prop.parts) seen.add(part.geometry);
  for (const geometry of seen) geometry.dispose();
  props.clear();
  cache.clear();
};

