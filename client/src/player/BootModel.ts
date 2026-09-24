import { bootBySlot, STARTER_BOOT } from '@obby/shared';
import {
  Group,
  Mesh,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
  type Bone,
  type BufferGeometry,
} from 'three';
import { createSneakerGeometry } from '../rendering/SneakerGeometry.js';

/**
 * Sneaker size in WORLD units, on a character 3.2 units tall.
 *
 * Must be clearly LARGER than the character's own leg box (roughly 0.7 wide at
 * the ankle) or the shoe's upper renders inside the leg and only the sole
 * peeks out.
 */
const BOOT_SIZE = { width: 1.06, height: 0.78, depth: 1.42 } as const;

/**
 * Where the sneaker's SOLE sits relative to its leg bone, in WORLD units at
 * bind pose. The lower leg bone is at y = 0.6 with the feet on the ground, so
 * the sole drops to floor level and the shoe pokes slightly forward.
 */
const BOOT_OFFSET = new Vector3(0, -0.62, 0.16);

/**
 * The sneakers worn on a character's feet.
 *
 * Parented to the two lower leg bones, so they follow the procedural animation
 * for free - including through backflips - without the animator knowing they
 * exist. Purely cosmetic: which boot is worn is decided by the server.
 *
 * The rig makes naive local offsets useless: the leg bone's local +Y points
 * DOWN in world space, its +Z maps to world +X, and the FBX bakes a 0.5 world
 * scale onto every bone. So the placement is derived from the bind pose - the
 * desired world offset is rotated into bone space and divided by that scale,
 * and the shoe is counter-rotated so it stays square to the character.
 */
export class BootModel {
  private readonly upperGeometry: BufferGeometry;
  private readonly soleGeometry: BufferGeometry;
  private readonly upperMaterial: MeshLambertMaterial;
  private readonly soleMaterial: MeshLambertMaterial;
  private readonly roots: Group[] = [];

  private slot = -1;

  /**
   * @param legBones the LegL2 / LegR2 bones; missing bones are skipped
   */
  constructor(legBones: readonly (Bone | null)[]) {
    const sneaker = createSneakerGeometry();
    this.upperGeometry = sneaker.upper;
    this.soleGeometry = sneaker.sole;

    this.upperMaterial = new MeshLambertMaterial({ color: STARTER_BOOT.color });
    this.soleMaterial = new MeshLambertMaterial({ color: 0xf2f5f7 });

    const boneWorld = new Quaternion();
    const boneScale = new Vector3();

    for (const bone of legBones) {
      if (!bone) continue;

      bone.updateWorldMatrix(true, false);
      bone.getWorldQuaternion(boneWorld);
      bone.getWorldScale(boneScale);

      const scale = boneScale.x || 1;
      const inverse = boneWorld.clone().invert();

      // One holder carrying both halves, so placement is written once.
      const holder = new Group();
      holder.position.copy(BOOT_OFFSET).applyQuaternion(inverse).divideScalar(scale);
      holder.quaternion.copy(inverse);
      holder.scale.setScalar(1 / scale);

      const upper = new Mesh(this.upperGeometry, this.upperMaterial);
      const sole = new Mesh(this.soleGeometry, this.soleMaterial);
      for (const mesh of [upper, sole]) {
        mesh.scale.set(BOOT_SIZE.width, BOOT_SIZE.height, BOOT_SIZE.depth);
        mesh.castShadow = true;
        mesh.frustumCulled = false;
        holder.add(mesh);
      }

      bone.add(holder);
      this.roots.push(holder);
    }

    this.setSlot(STARTER_BOOT.slot);
  }

  /** Recolour to the given boot tier. No-op if already showing it. */
  setSlot(slot: number): void {
    if (slot === this.slot) return;
    const tier = bootBySlot(slot) ?? STARTER_BOOT;
    this.slot = tier.slot;
    this.upperMaterial.color.set(tier.color);
  }

  dispose(): void {
    for (const root of this.roots) root.removeFromParent();
    this.roots.length = 0;
    this.upperGeometry.dispose();
    this.soleGeometry.dispose();
    this.upperMaterial.dispose();
    this.soleMaterial.dispose();
  }
}
