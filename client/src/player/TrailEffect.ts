import { NO_TRAIL, trailBySlot, type TrailStyle } from '@obby/shared';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
} from 'three';

/** Samples kept in the ribbon. Two vertices each, so 24 is 46 triangles. */
const SAMPLES = 24;

/** Metres of travel between samples. Distance-based, so speed sets density. */
const SAMPLE_DISTANCE = 0.34;

/** Below this speed the trail stops emitting and fades out. */
const MOVING_SPEED = 1.4;

/** Half-width of the ribbon at the player, in world units. */
const RIBBON_HALF_WIDTH = 0.42;

/** Height above the player's feet the ribbon is emitted from. */
const EMIT_HEIGHT = 1.1;

/** Seconds a sample takes to fade away once emission stops. */
const FADE_SECONDS = 0.55;

/** One recorded point of the ribbon. */
interface Sample {
  x: number;
  y: number;
  z: number;
  /** Sideways offset, so the ribbon has width across the direction of travel. */
  nx: number;
  nz: number;
  /** 1 when fresh, decaying to 0. */
  life: number;
}

/**
 * The ribbon a trail leaves behind the player.
 *
 * Lives in WORLD space - it is what the player has already passed through, so
 * it cannot be parented to the character. The owner adds `root` to the scene
 * alongside the character's own root.
 *
 * Emission is DISTANCE based, not time based: a sample is laid down every
 * SAMPLE_DISTANCE travelled, so a fast player gets a long ribbon and a
 * stationary one lays down nothing at all and fades to invisible. That is what
 * keeps a trail from reading as a static object parked on the ground.
 *
 * One geometry, one material, rewritten in place each frame - no allocation
 * per sample and no per-particle objects.
 */
export class TrailEffect {
  readonly root = new Group();

  private readonly geometry = new BufferGeometry();
  private readonly material: MeshBasicMaterial;
  private readonly mesh: Mesh;

  private readonly positions = new Float32Array(SAMPLES * 2 * 3);
  private readonly colors = new Float32Array(SAMPLES * 2 * 3);
  private readonly samples: Sample[] = [];

  private slot = NO_TRAIL;
  private style: TrailStyle = 'solid';
  private readonly baseColor = new Color(0xffffff);
  private readonly scratch = new Color();

  private lastX = 0;
  private lastZ = 0;
  private seeded = false;
  private time = 0;

  constructor() {
    for (let i = 0; i < SAMPLES; i += 1) {
      this.samples.push({ x: 0, y: 0, z: 0, nx: 0, nz: 0, life: 0 });
    }

    this.geometry.setAttribute('position', new BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new BufferAttribute(this.colors, 3));
    this.geometry.setIndex(buildStripIndices());

    this.material = new MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      blending: AdditiveBlending,
      fog: false,
    });

    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.root.add(this.mesh);
  }

  /**
   * Wear a trail, or `NO_TRAIL` to remove it.
   *
   * Which slot is legal is the server's decision; this only renders whatever
   * it replicated.
   */
  setSlot(slot: number): void {
    if (slot === this.slot) return;
    this.slot = slot;

    const tier = trailBySlot(slot);
    if (!tier) {
      this.mesh.visible = false;
      this.clear();
      return;
    }

    this.style = tier.style;
    this.baseColor.setHex(tier.color);
    // The void trail is the one that must NOT glow: additive blending would
    // turn black into invisible, so it draws normally instead.
    this.material.blending = this.style === 'void' ? NormalBlending : AdditiveBlending;
    this.mesh.visible = true;
  }

  /**
   * Advance the ribbon.
   *
   * @param x,y,z  the player's world position
   * @param speed  horizontal speed, so a standing player emits nothing
   */
  update(delta: number, x: number, y: number, z: number, speed: number): void {
    if (this.slot === NO_TRAIL) return;
    this.time += delta;

    if (!this.seeded) {
      this.lastX = x;
      this.lastZ = z;
      this.seeded = true;
    }

    const dx = x - this.lastX;
    const dz = z - this.lastZ;
    const travelled = Math.hypot(dx, dz);

    if (speed > MOVING_SPEED && travelled >= SAMPLE_DISTANCE) {
      const inverse = 1 / travelled;
      // Perpendicular to the direction of travel, so the ribbon reads as a
      // band rather than a line seen edge-on.
      this.push(x, y + EMIT_HEIGHT, z, -dz * inverse, dx * inverse);
      this.lastX = x;
      this.lastZ = z;
    }

    const decay = delta / FADE_SECONDS;
    let alive = 0;
    for (const sample of this.samples) {
      if (sample.life <= 0) continue;
      sample.life -= decay;
      if (sample.life > 0) alive += 1;
    }

    this.mesh.visible = alive > 1;
    if (this.mesh.visible) this.writeGeometry();
  }

  /** Drop the whole ribbon, e.g. after a respawn teleport. */
  clear(): void {
    for (const sample of this.samples) sample.life = 0;
    this.seeded = false;
    this.mesh.visible = false;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }

  /** Shift the ring buffer down and write the newest sample at the head. */
  private push(x: number, y: number, z: number, nx: number, nz: number): void {
    for (let i = this.samples.length - 1; i > 0; i -= 1) {
      const to = this.samples[i] as Sample;
      const from = this.samples[i - 1] as Sample;
      to.x = from.x;
      to.y = from.y;
      to.z = from.z;
      to.nx = from.nx;
      to.nz = from.nz;
      to.life = from.life;
    }
    const head = this.samples[0] as Sample;
    head.x = x;
    head.y = y;
    head.z = z;
    head.nx = nx;
    head.nz = nz;
    head.life = 1;
  }

  private writeGeometry(): void {
    for (let i = 0; i < this.samples.length; i += 1) {
      const sample = this.samples[i] as Sample;
      const life = Math.max(0, sample.life);
      // The ribbon narrows and dims toward its tail.
      const width = RIBBON_HALF_WIDTH * life;
      const base = i * 6;

      this.positions[base] = sample.x + sample.nx * width;
      this.positions[base + 1] = sample.y;
      this.positions[base + 2] = sample.z + sample.nz * width;
      this.positions[base + 3] = sample.x - sample.nx * width;
      this.positions[base + 4] = sample.y;
      this.positions[base + 5] = sample.z - sample.nz * width;

      this.tint(i, life);
      this.colors[base] = this.scratch.r;
      this.colors[base + 1] = this.scratch.g;
      this.colors[base + 2] = this.scratch.b;
      this.colors[base + 3] = this.scratch.r;
      this.colors[base + 4] = this.scratch.g;
      this.colors[base + 5] = this.scratch.b;
    }

    (this.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('color') as BufferAttribute).needsUpdate = true;
  }

  /** Per-sample colour, which is where each style's identity lives. */
  private tint(index: number, life: number): void {
    switch (this.style) {
      case 'rainbow':
        // Hue runs along the ribbon and drifts, so it reads as flowing.
        this.scratch.setHSL(((index / SAMPLES) * 0.8 + this.time * 0.35) % 1, 0.95, 0.55);
        break;
      case 'void':
        // Near black, with a bright fleck every few samples for contrast.
        this.scratch.setHex(index % 5 === 0 ? 0x8f7bff : 0x0a0b10);
        break;
      case 'lunar':
        this.scratch.copy(this.baseColor).offsetHSL(0, 0, Math.sin(this.time * 2 + index) * 0.08);
        break;
      case 'cosmic':
        this.scratch.setHSL(
          (0.72 + Math.sin(this.time * 1.6 + index * 0.35) * 0.09 + 1) % 1,
          0.9,
          0.6,
        );
        break;
      default:
        this.scratch.copy(this.baseColor);
        break;
    }
    // Fading is done in the vertex colour because the material is shared by
    // every sample - one material, one draw call.
    this.scratch.multiplyScalar(this.style === 'void' ? 1 : life);
  }
}

/** Two triangles per pair of samples, forming a strip. */
const buildStripIndices = (): number[] => {
  const indices: number[] = [];
  for (let i = 0; i < SAMPLES - 1; i += 1) {
    const a = i * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  return indices;
};
