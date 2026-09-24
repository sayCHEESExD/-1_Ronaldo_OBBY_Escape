import {
  InstancedMesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Texture,
  Vector3,
} from 'three';
import { loadIconImage } from '../config/uiIcons.js';

/** The plane's own normal - the axis a billboard rolls about. */
const FORWARD = new Vector3(0, 0, 1);

/** Cups thrown by one award. */
const PER_BURST = 8;

/**
 * Slots in the shared pool.
 *
 * Three bursts' worth, so collecting again before the last lot has faded does
 * not cut it short. Beyond that a burst silently does less rather than the
 * pool growing - a dropped cup during a flurry is invisible, an unbounded pool
 * is not.
 */
const POOL_SIZE = PER_BURST * 3;

/** Seconds a cup lives. Short: this is a flourish, not a fountain. */
const LIFETIME = 0.85;

/** World size of a cup at full scale. */
const CUP_SIZE = 0.95;

/** How far out and up a cup is thrown, and what pulls it back. */
const OUT_SPEED_MIN = 2.6;
const OUT_SPEED_MAX = 4.1;
const UP_SPEED_MIN = 4.6;
const UP_SPEED_MAX = 6.4;
const GRAVITY = 11;

/** Height above the player's feet the ring starts from. */
const START_HEIGHT = 1.1;

/** Fraction of the life spent popping up to full size. */
const POP_FRACTION = 0.18;

/** Radians per second a cup rolls as it flies, for a bit of life. */
const ROLL_SPEED = 2.4;

interface Cup {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  roll: number;
  rollSpeed: number;
  life: number;
}

/**
 * Trophies bursting outward when Wins are banked.
 *
 * ONE InstancedMesh shared by every burst, exactly like `LandingDebris`: a
 * burst claims free slots from a fixed pool and gives them back when they
 * expire, so repeated collection costs the same as the first one and nothing
 * is ever added to the scene permanently.
 *
 * The cups are BILLBOARDS carrying the same `trophy.png` the HUD uses, rather
 * than a second piece of trophy geometry - one texture, one material, one draw
 * call, and the art cannot drift from the icon it is celebrating.
 */
export class WinCups {
  readonly mesh: InstancedMesh;

  private readonly geometry: PlaneGeometry;
  private readonly material: MeshBasicMaterial;
  private readonly cups: Cup[] = [];
  private readonly dummy = new Object3D();
  private readonly spin = new Quaternion();
  private texture: Texture | null = null;
  private live = 0;
  private disposed = false;

  constructor() {
    this.geometry = new PlaneGeometry(CUP_SIZE, CUP_SIZE);
    this.material = new MeshBasicMaterial({
      transparent: true,
      // Light, not a surface: never occludes the world behind it.
      depthWrite: false,
      fog: false,
    });

    this.mesh = new InstancedMesh(this.geometry, this.material, POOL_SIZE);
    // Bursts happen wherever the player is, so a bounding volume around the
    // pool would never cull anything useful.
    this.mesh.frustumCulled = false;
    // Hidden until the art arrives, so a missing file shows nothing rather
    // than a burst of white squares.
    this.mesh.visible = false;

    for (let i = 0; i < POOL_SIZE; i += 1) {
      this.cups.push({
        x: 0, y: 0, z: 0,
        vx: 0, vy: 0, vz: 0,
        roll: 0, rollSpeed: 0, life: 0,
      });
      this.hide(i);
    }
    this.mesh.instanceMatrix.needsUpdate = true;

    void loadIconImage('trophy').then((image) => {
      if (!image || this.disposed) return;
      const texture = new Texture(image);
      texture.colorSpace = SRGBColorSpace;
      texture.needsUpdate = true;
      this.texture = texture;
      this.material.map = texture;
      this.material.needsUpdate = true;
      this.mesh.visible = true;
    });
  }

  /**
   * Throw a ring of cups around a point.
   *
   * Evenly spaced with a random offset, so two collections in the same place
   * do not produce the identical picture.
   */
  burst(x: number, y: number, z: number): void {
    const offset = Math.random() * Math.PI * 2;
    let thrown = 0;

    for (let i = 0; i < POOL_SIZE && thrown < PER_BURST; i += 1) {
      const cup = this.cups[i] as Cup;
      if (cup.life > 0) continue;

      const angle = offset + (thrown / PER_BURST) * Math.PI * 2;
      const out = OUT_SPEED_MIN + Math.random() * (OUT_SPEED_MAX - OUT_SPEED_MIN);

      cup.x = x + Math.cos(angle) * 0.35;
      cup.y = y + START_HEIGHT;
      cup.z = z + Math.sin(angle) * 0.35;
      cup.vx = Math.cos(angle) * out;
      cup.vz = Math.sin(angle) * out;
      cup.vy = UP_SPEED_MIN + Math.random() * (UP_SPEED_MAX - UP_SPEED_MIN);
      cup.roll = (Math.random() - 0.5) * 0.6;
      cup.rollSpeed = (Math.random() - 0.5) * 2 * ROLL_SPEED;
      cup.life = LIFETIME;

      thrown += 1;
      this.live += 1;
    }
  }

  /**
   * Advance every live cup. Costs nothing while the pool is empty.
   *
   * @param cameraRotation the camera's own orientation, so each cup faces it
   */
  update(delta: number, cameraRotation: Quaternion): void {
    if (this.live === 0) return;

    for (let i = 0; i < POOL_SIZE; i += 1) {
      const cup = this.cups[i] as Cup;
      if (cup.life <= 0) continue;

      cup.life -= delta;
      if (cup.life <= 0) {
        this.hide(i);
        this.live -= 1;
        continue;
      }

      cup.vy -= GRAVITY * delta;
      cup.x += cup.vx * delta;
      cup.y += cup.vy * delta;
      cup.z += cup.vz * delta;
      cup.roll += cup.rollSpeed * delta;

      const t = 1 - cup.life / LIFETIME;
      // Pop up to a slight overshoot, then ease away over the tail.
      const scale =
        t < POP_FRACTION
          ? (t / POP_FRACTION) * 1.15
          : 1.15 - 0.15 * Math.min(1, (t - POP_FRACTION) / 0.2);
      const fade = Math.min(1, cup.life / (LIFETIME * 0.35));

      this.dummy.position.set(cup.x, cup.y, cup.z);
      // Face the camera, then roll about the view axis - a flat card that
      // never turns edge-on however the player swings the camera round.
      this.dummy.quaternion.copy(cameraRotation);
      this.spin.setFromAxisAngle(FORWARD, cup.roll);
      this.dummy.quaternion.multiply(this.spin);
      this.dummy.scale.setScalar(Math.max(0, scale * fade));
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }

    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.disposed = true;
    this.geometry.dispose();
    this.material.dispose();
    this.texture?.dispose();
    this.mesh.removeFromParent();
  }

  /** Park a slot at zero scale - an instance cannot be individually hidden. */
  private hide(index: number): void {
    this.dummy.position.set(0, -10000, 0);
    this.dummy.quaternion.identity();
    this.dummy.scale.setScalar(0);
    this.dummy.updateMatrix();
    this.mesh.setMatrixAt(index, this.dummy.matrix);
  }
}
