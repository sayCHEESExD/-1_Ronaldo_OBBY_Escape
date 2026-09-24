import {
  Euler,
  Group,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type Material,
} from 'three';

/** One piece of a prop: a geometry drawn with a material at a local offset. */
export interface PropPart {
  readonly geometry: BufferGeometry;
  readonly material: Material;
  /** Placement of the part within the prop. Identity when omitted. */
  readonly matrix?: Matrix4;
}

/** A prop is just its parts. Build it once; place it any number of times. */
export interface Prop {
  readonly parts: readonly PropPart[];
  /** Cast shadows (only meaningful near spawn, where the shadow camera is). */
  readonly castShadow?: boolean;
}

/** Placement of one prop instance. */
export interface Placement {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly rotationY?: number;
  /** Uniform scale, or [x, y, z]. */
  readonly scale?: number | readonly [number, number, number];
  /** Optional tilt, for leaning trees and fallen rocks. */
  readonly tiltX?: number;
  readonly tiltZ?: number;
}

interface Bucket {
  readonly geometry: BufferGeometry;
  readonly material: Material;
  readonly castShadow: boolean;
  readonly matrices: Matrix4[];
}

/**
 * Collects prop placements and turns them into instanced draws.
 *
 * Every (geometry, material) pair becomes ONE InstancedMesh per chunk of the
 * route, so a thousand lamp posts cost a few draws. Chunking along Z is what
 * lets the camera frustum drop the far scenery: a single InstancedMesh
 * spanning a 70 km route has a bounding sphere nothing can ever be outside of.
 */
export class PropBatch {
  private readonly buckets = new Map<string, Bucket>();
  private readonly position = new Vector3();
  private readonly quaternion = new Quaternion();
  private readonly euler = new Euler();
  private readonly scale = new Vector3();
  private readonly placement = new Matrix4();

  /**
   * @param chunkLength Z length of one culling chunk, in world units.
   * @param shadows     let props that ask for it cast shadows. Only worth it
   *                    near spawn, where the shadow camera actually looks.
   */
  constructor(
    private readonly chunkLength = 700,
    private readonly shadows = false,
  ) {}

  add(prop: Prop, at: Placement): void {
    this.position.set(at.x, at.y, at.z);
    this.euler.set(at.tiltX ?? 0, at.rotationY ?? 0, at.tiltZ ?? 0, 'YXZ');
    this.quaternion.setFromEuler(this.euler);
    const s = at.scale ?? 1;
    if (typeof s === 'number') this.scale.setScalar(s);
    else this.scale.set(s[0], s[1], s[2]);
    this.placement.compose(this.position, this.quaternion, this.scale);

    const chunk = Math.floor(at.z / this.chunkLength);
    for (const part of prop.parts) {
      const key = `${chunk}|${part.geometry.uuid}|${part.material.uuid}`;
      let bucket = this.buckets.get(key);
      if (!bucket) {
        bucket = {
          geometry: part.geometry,
          material: part.material,
          castShadow: this.shadows && (prop.castShadow ?? false),
          matrices: [],
        };
        this.buckets.set(key, bucket);
      }
      const matrix = this.placement.clone();
      if (part.matrix) matrix.multiply(part.matrix);
      bucket.matrices.push(matrix);
    }
  }

  /** Emit every bucket as an InstancedMesh under `root`. */
  build(root: Group): void {
    for (const bucket of this.buckets.values()) {
      const mesh = new InstancedMesh(bucket.geometry, bucket.material, bucket.matrices.length);
      bucket.matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.castShadow = bucket.castShadow;
      mesh.receiveShadow = bucket.castShadow;
      root.add(mesh);
    }
    this.buckets.clear();
  }
}

/** Shorthand for a part offset. */
export const at = (
  x: number,
  y: number,
  z: number,
  rotationY = 0,
  scale: number | readonly [number, number, number] = 1,
  rotationX = 0,
  rotationZ = 0,
): Matrix4 => {
  const s = typeof scale === 'number' ? new Vector3(scale, scale, scale) : new Vector3(...scale);
  return new Matrix4().compose(
    new Vector3(x, y, z),
    new Quaternion().setFromEuler(new Euler(rotationX, rotationY, rotationZ, 'YXZ')),
    s,
  );
};

/** Small deterministic PRNG - identical output on every client. */
export const seededRandom = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
