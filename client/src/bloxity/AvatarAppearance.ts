import {
  AVATAR_PART_SLOTS,
  resolveBloxitySkin,
  type AvatarLook,
  type AvatarPartSlot,
  type AvatarProportions,
} from '@obby/shared';
import {
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  SkinnedMesh,
  Vector3,
  type Bone,
  type BufferGeometry,
  type Texture,
} from 'three';
import type { BoneName } from '../animation/rig/boneNames.js';
import type { PlayerCharacter } from '../player/PlayerCharacter.js';
import { playerModelLoader } from '../player/PlayerModelLoader.js';
import { logger } from '../util/logger.js';
import { PART_MESH_NAMES, loadAccessory, loadPart, loadSkin } from './BloxityAvatarAssets.js';

const SCOPE = 'BloxityAvatar';

/** Which bone an accessory slot hangs from - the SDK's headBone and spineBone. */
const HAT_BONE: BoneName = 'Neck1';
const BACK_BONE: BoneName = 'Spine2';

/** Where the SDK seats a hat on the head bone, in body units. */
const HAT_OFFSET_Y = 0.8;

/** Rest transform of one bone, captured once so shaping never compounds. */
interface BoneRest {
  readonly bone: Bone;
  readonly position: Vector3;
  readonly scale: Vector3;
}

/**
 * Dresses ONE character - local or remote - in a player's Bloxity avatar.
 *
 * On Bloxity's own body (`player.glb`, the normal case) the character is
 * assembled exactly as the Bloxity SDK's avatar renderer assembles it:
 *
 *   head / torso / arms / legs  each part mesh's geometry is the equipped
 *                               part model, or Bloxity's default part for
 *                               THAT slot only when none is equipped or its
 *                               model cannot load
 *   skin                        one atlas on this character's own material,
 *                               drawn for these meshes' UVs; the body's own
 *                               embedded default skin until it arrives
 *   hat / back                  hung from Neck1 / Spine2 where the SDK hangs
 *                               them
 *   proportions                 the SDK's own bone formulas
 *
 * Body parts, skins and accessories are shared, cached assets; everything
 * PER CHARACTER - the material, the accessory nodes, the bone shaping - is
 * this character's own, so no player can ever repaint or reshape another.
 *
 * Only bone POSITION and SCALE are written here, never rotation: rotation
 * belongs to `PlayerRig.applyPose`, which rebuilds it from the bind pose every
 * frame. That is why the procedural animation - run, jump, backflip - drives
 * a Bloxity body exactly as it drove the FBX: the body carries the same
 * twelve bone names.
 *
 * When Bloxity's body could not be loaded the character is the bundled FBX -
 * the genuine fallback. That body keeps its own texture: a Bloxity skin atlas
 * is laid out for Bloxity's meshes, and wrapping it round the FBX is what put
 * a face on a leg.
 */
export class AvatarAppearance {
  private readonly character: PlayerCharacter;
  private readonly bloxityBody: boolean;

  /** This character's own material, shared only by its own part meshes. */
  private material: MeshStandardMaterial | null = null;
  private readonly partMeshes = new Map<AvatarPartSlot, SkinnedMesh>();
  private readonly defaultGeometry = new Map<AvatarPartSlot, BufferGeometry>();
  private readonly boneNames: readonly string[];
  private readonly rests = new Map<string, BoneRest>();
  /** Bind-pose height of Neck_Offset, which the SDK's neck formula scales. */
  private neckOffsetBindY = 0;
  /** The rig's own Neck1 rest scale, for the FBX fallback's head size. */
  private readonly neckRestScale: Vector3;

  private readonly hatSlot = new Group();
  private readonly backSlot = new Group();

  /** What is applied now, per field - a look is re-applied only where it changed. */
  private skinId: string | null = null;
  private readonly partIds = new Map<AvatarPartSlot, string>();
  private hatId: string | null = null;
  private backId: string | null = null;
  private proportionsKey = '';

  /** Bumped per request, so a slow load never lands over a newer choice. */
  private readonly generation = new Map<string, number>();
  private disposed = false;

  constructor(character: PlayerCharacter) {
    this.character = character;
    const body = playerModelLoader.baseBody;
    this.boneNames = body?.boneNames ?? [];

    this.collectPartMeshes();
    this.bloxityBody = body !== null && this.partMeshes.size === AVATAR_PART_SLOTS.length;
    if (this.bloxityBody) this.ownMaterial(body?.defaultSkin ?? null);
    this.captureRests();
    this.neckRestScale = this.character.rig.getBone('Neck1')?.scale.clone() ?? new Vector3(1, 1, 1);
    this.attachSlots();
  }

  /**
   * Dress the character in a look.
   *
   * Idempotent and incremental: each field is compared with what is already
   * applied, so re-applying the same look - every state patch does - costs a
   * handful of string comparisons and loads nothing.
   */
  applyLook(look: AvatarLook): void {
    if (this.disposed) return;
    if (this.bloxityBody) {
      this.applySkin(resolveBloxitySkin(look.skin));
      for (const slot of AVATAR_PART_SLOTS) this.applyPart(slot, look.parts[slot]);
    }
    this.applyAccessory('hat', look.hat);
    this.applyAccessory('back', look.back);
    this.applyProportions(look.proportions);
  }

  /** True when this character is Bloxity's body rather than the FBX fallback. */
  get isBloxityBody(): boolean {
    return this.bloxityBody;
  }

  dispose(): void {
    this.disposed = true;
    this.hatSlot.removeFromParent();
    this.backSlot.removeFromParent();
    this.hatSlot.clear();
    this.backSlot.clear();
    // Part geometries, skins and accessory meshes are shared caches and are
    // NOT disposed with one character. Only this character's material is.
    this.material?.dispose();
    this.material = null;
  }

  // --- setup ------------------------------------------------------------

  private collectPartMeshes(): void {
    const wanted = new Map(Object.entries(PART_MESH_NAMES).map(([slot, name]) => [name.toLowerCase(), slot]));
    this.character.modelRoot.traverse((child) => {
      if (!(child instanceof SkinnedMesh)) return;
      const slot = wanted.get(child.name.toLowerCase()) as AvatarPartSlot | undefined;
      if (!slot || this.partMeshes.has(slot)) return;
      this.partMeshes.set(slot, child);
      this.defaultGeometry.set(slot, child.geometry);
    });
  }

  /** Give this character a material of its own, starting on `skin`. */
  private ownMaterial(skin: Texture | null): void {
    let material: MeshStandardMaterial | null = null;
    this.character.modelRoot.traverse((child) => {
      if (!(child instanceof Mesh)) return;
      const shared = child.material;
      if (Array.isArray(shared) || !(shared instanceof MeshStandardMaterial)) return;
      material ??= shared.clone();
      child.material = material;
    });
    // Assigned inside the traversal callback, which TypeScript cannot see.
    const owned = material as MeshStandardMaterial | null;
    this.material = owned;
    if (owned && skin) owned.map = skin;
  }

  /**
   * Record every bone's bind position and scale once.
   *
   * Everything below is written as `rest * value`, so re-applying proportions
   * never compounds and a customizer slider cannot run away.
   */
  private captureRests(): void {
    let skeleton: SkinnedMesh['skeleton'] | null = null;
    this.character.modelRoot.traverse((child) => {
      if (child instanceof SkinnedMesh) skeleton ??= child.skeleton;
    });
    const bones = (skeleton as SkinnedMesh['skeleton'] | null)?.bones ?? [];
    for (const bone of bones) {
      if (this.rests.has(bone.name)) continue;
      this.rests.set(bone.name, { bone, position: bone.position.clone(), scale: bone.scale.clone() });
    }
    const neck = bones.findIndex((bone) => bone.name === 'Neck_Offset');
    const inverse = (skeleton as SkinnedMesh['skeleton'] | null)?.boneInverses[neck];
    if (inverse) this.neckOffsetBindY = new Matrix4().copy(inverse).invert().elements[13] ?? 0;
  }

  private attachSlots(): void {
    this.character.rig.getBone(HAT_BONE)?.add(this.hatSlot);
    this.character.rig.getBone(BACK_BONE)?.add(this.backSlot);
    if (this.bloxityBody) this.hatSlot.position.set(0, HAT_OFFSET_Y, 0);
  }

  private nextGeneration(key: string): number {
    const next = (this.generation.get(key) ?? 0) + 1;
    this.generation.set(key, next);
    return next;
  }

  private isCurrent(key: string, generation: number): boolean {
    return !this.disposed && this.generation.get(key) === generation;
  }

  // --- skin -------------------------------------------------------------

  /**
   * Put a skin atlas on this character's own material.
   *
   * Until it arrives the character wears the body's embedded default skin -
   * Bloxity's own default look, never a local texture.
   */
  private applySkin(id: string): void {
    if (id === this.skinId) return;
    this.skinId = id;
    const generation = this.nextGeneration('skin');
    void loadSkin(id).then((texture) => {
      if (!this.isCurrent('skin', generation) || !texture || !this.material) return;
      this.material.map = texture;
      this.material.needsUpdate = true;
      logger.info(SCOPE, `skin ${id} applied`);
    });
  }

  // --- body parts -------------------------------------------------------

  /**
   * Fill one body-part slot.
   *
   * The equipped part's model when it loads; otherwise Bloxity's default part
   * for THIS slot only - one missing leg never costs the player their head.
   */
  private applyPart(slot: AvatarPartSlot, id: string): void {
    if (this.partIds.get(slot) === id) return;
    this.partIds.set(slot, id);
    const mesh = this.partMeshes.get(slot);
    const fallback = this.defaultGeometry.get(slot);
    if (!mesh || !fallback) return;
    const key = `part:${slot}`;
    const generation = this.nextGeneration(key);
    if (!id) {
      mesh.geometry = fallback;
      return;
    }
    void loadPart(slot, id, this.boneNames).then((geometry) => {
      if (!this.isCurrent(key, generation)) return;
      mesh.geometry = geometry ?? fallback;
      if (geometry) logger.info(SCOPE, `${slot} part ${id} applied`);
    });
  }

  // --- accessories ------------------------------------------------------

  /** Hang a hat or back item, or clear the slot when unequipped. */
  private applyAccessory(kind: 'hat' | 'back', id: string): void {
    if ((kind === 'hat' ? this.hatId : this.backId) === id) return;
    if (kind === 'hat') this.hatId = id;
    else this.backId = id;

    const slot = kind === 'hat' ? this.hatSlot : this.backSlot;
    const generation = this.nextGeneration(kind);
    slot.clear();
    if (!id) return;

    void loadAccessory(kind, id).then((object) => {
      if (!this.isCurrent(kind, generation) || !object) return;
      slot.clear();
      slot.add(object);
      logger.info(SCOPE, `${kind} ${id} applied`);
    });
  }

  // --- proportions ------------------------------------------------------

  /**
   * Shape the body.
   *
   * On Bloxity's body this is the SDK renderer's own formula for height, arm
   * length, head size and neck height. The SDK renderer does not apply
   * shoulder width, leg spacing or torso width, so those three are applied by
   * the plainest reading of their names: arms and legs spread along their
   * offset joints, the chest widened without widening what hangs from it.
   */
  private applyProportions(p: AvatarProportions): void {
    const key = Object.values(p).join(',');
    if (key === this.proportionsKey) return;
    this.proportionsKey = key;

    if (!this.bloxityBody) {
      this.applyFallbackProportions(p);
      return;
    }

    for (const rest of this.rests.values()) {
      rest.bone.position.copy(rest.position);
      rest.bone.scale.copy(rest.scale);
    }

    const h = p.height;
    const hs = p.headScale;
    // Height is a whole-body stretch on the character's own avatar node.
    this.character.avatarRoot.scale.set(1, h, 1);

    for (const rest of this.rests.values()) {
      const { bone, position: op, scale: os } = rest;
      const name = bone.name;
      if (name.startsWith('Arm')) bone.scale.y = os.y * p.armLength;
      if (name === 'Neck_Offset') {
        bone.position.y += (h - hs) * op.y;
        bone.position.y += this.neckOffsetBindY * (p.neckHeight - 1) * 0.8;
      }
      if (name === 'Neck1') {
        bone.scale.set(os.x * hs, os.y * (hs / h), os.z * hs);
      }
      if (name === 'ArmL_Offset' || name === 'ArmR_Offset') {
        bone.position.x = op.x * p.shoulderWidth;
      }
      if (name === 'LegL_Offset' || name === 'LegR_Offset') {
        bone.position.x = op.x * p.legOffsetX;
      }
    }

    // Torso width: widen the chest, then undo it on the arms and the neck so
    // only the torso itself gets wider while they ride out with its edge.
    const spine = this.rests.get('Spine2');
    if (spine) spine.bone.scale.x = spine.scale.x * p.torsoScaleX;
    const inverse = p.torsoScaleX === 0 ? 1 : 1 / p.torsoScaleX;
    for (const name of ['ArmL_Offset', 'ArmR_Offset', 'Neck_Offset']) {
      const rest = this.rests.get(name);
      if (rest) rest.bone.scale.x = rest.bone.scale.x * inverse;
    }
  }

  /**
   * Proportions on the FBX fallback body, which has no offset joints: height
   * and head size only, the two that read unambiguously on any rig.
   */
  private applyFallbackProportions(p: AvatarProportions): void {
    this.character.avatarRoot.scale.set(1, p.height, 1);
    this.character.rig.getBone('Neck1')?.scale.copy(this.neckRestScale).multiplyScalar(p.headScale);
  }
}
