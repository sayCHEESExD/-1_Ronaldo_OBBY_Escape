import {
  BoxGeometry,
  Color,
  InstancedMesh,
  MeshLambertMaterial,
  Object3D,
} from 'three';

/** Chunks in the shared pool. Every landing in the world draws from this. */
const POOL_SIZE = 96;

/** Chunks thrown by one landing. */
const PER_BURST = 11;

/** Seconds a chunk lives. Short: this is an impact, not smoke. */
const LIFETIME_MIN = 0.32;
const LIFETIME_MAX = 0.55;

/** Gravity on the debris. Heavier than the player, so it settles fast. */
const GRAVITY = 34;

/** Base size of a chunk, before per-chunk variation. */
const CHUNK_SIZE = 0.16;

/** Two tones of concrete grit, picked per chunk. */
const TONES = [0x9aa6b2, 0xb9a98f] as const;

interface Chunk {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  spinX: number;
  spinY: number;
  rotX: number;
  rotY: number;
  scale: number;
  life: number;
  ttl: number;
}

/**
 * Rubble kicked up when a player lands.
 *
 * ONE InstancedMesh shared by every player in the room, not a particle system
 * per character: a burst claims free slots from the pool and gives them back
 * when they expire, so a busy server costs exactly the same as an empty one.
 *
 * Deliberately OPAQUE. A transparent particle is a sorted draw and a fill-rate
 * cost on exactly the hardware least able to afford it; small solid chunks
 * read as debris just as well and cost nothing.
 */
export class LandingDebris {
  readonly mesh: InstancedMesh;

  private readonly geometry: BoxGeometry;
  private readonly material: MeshLambertMaterial;
  private readonly chunks: Chunk[] = [];
  private readonly dummy = new Object3D();
  private readonly tint = new Color();
  private live = 0;

  constructor() {
    this.geometry = new BoxGeometry(CHUNK_SIZE, CHUNK_SIZE, CHUNK_SIZE);
    this.material = new MeshLambertMaterial({ vertexColors: false });
    this.mesh = new InstancedMesh(this.geometry, this.material, POOL_SIZE);
    // The pool is scattered across the whole map, so a bounding volume around
    // it would never cull anything useful.
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;

    for (let i = 0; i < POOL_SIZE; i += 1) {
      this.chunks.push({
        x: 0, y: 0, z: 0,
        vx: 0, vy: 0, vz: 0,
        spinX: 0, spinY: 0,
        rotX: 0, rotY: 0,
        scale: 1, life: 0, ttl: 1,
      });
      this.hide(i);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * Throw a burst of rubble outward from a landing point.
   *
   * Silently does less when the pool is busy rather than growing: a dropped
   * chunk during a crowded moment is invisible, an unbounded pool is not.
   */
  burst(x: number, y: number, z: number): void {
    let thrown = 0;
    for (let i = 0; i < POOL_SIZE && thrown < PER_BURST; i += 1) {
      const chunk = this.chunks[i] as Chunk;
      if (chunk.life > 0) continue;

      // Outward in a ring, so the debris scatters from under the feet rather
      // than fountaining straight up.
      const angle = Math.random() * Math.PI * 2;
      const speed = 2.2 + Math.random() * 3.4;

      chunk.x = x + Math.cos(angle) * 0.18;
      chunk.y = y + 0.08 + Math.random() * 0.12;
      chunk.z = z + Math.sin(angle) * 0.18;
      chunk.vx = Math.cos(angle) * speed;
      chunk.vz = Math.sin(angle) * speed;
      chunk.vy = 2.6 + Math.random() * 3.2;
      chunk.spinX = (Math.random() - 0.5) * 22;
      chunk.spinY = (Math.random() - 0.5) * 22;
      chunk.rotX = Math.random() * Math.PI;
      chunk.rotY = Math.random() * Math.PI;
      chunk.scale = 0.55 + Math.random() * 0.95;
      chunk.ttl = LIFETIME_MIN + Math.random() * (LIFETIME_MAX - LIFETIME_MIN);
      chunk.life = chunk.ttl;

      this.tint.setHex(TONES[Math.random() < 0.68 ? 0 : 1] ?? TONES[0]);
      this.mesh.setColorAt(i, this.tint);
      thrown += 1;
      this.live += 1;
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** Advance every live chunk. Costs nothing while the pool is empty. */
  update(delta: number): void {
    if (this.live === 0) return;

    for (let i = 0; i < POOL_SIZE; i += 1) {
      const chunk = this.chunks[i] as Chunk;
      if (chunk.life <= 0) continue;

      chunk.life -= delta;
      if (chunk.life <= 0) {
        this.hide(i);
        this.live -= 1;
        continue;
      }

      chunk.vy -= GRAVITY * delta;
      chunk.x += chunk.vx * delta;
      chunk.y += chunk.vy * delta;
      chunk.z += chunk.vz * delta;
      chunk.rotX += chunk.spinX * delta;
      chunk.rotY += chunk.spinY * delta;

      // Drag, so the scatter slows instead of sliding away flat.
      const drag = Math.exp(-4 * delta);
      chunk.vx *= drag;
      chunk.vz *= drag;

      // Shrink out over the last of the life, so nothing pops away.
      const fade = Math.min(1, chunk.life / (chunk.ttl * 0.45));

      this.dummy.position.set(chunk.x, chunk.y, chunk.z);
      this.dummy.rotation.set(chunk.rotX, chunk.rotY, 0);
      this.dummy.scale.setScalar(chunk.scale * fade);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }

    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.mesh.removeFromParent();
  }

  /** Park a slot at zero scale - an instance cannot be individually hidden. */
  private hide(index: number): void {
    this.dummy.position.set(0, -10000, 0);
    this.dummy.rotation.set(0, 0, 0);
    this.dummy.scale.setScalar(0);
    this.dummy.updateMatrix();
    this.mesh.setMatrixAt(index, this.dummy.matrix);
  }
}
