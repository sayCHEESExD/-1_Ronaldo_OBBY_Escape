import {
  Box3,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  NearestFilter,
  SkinnedMesh,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
  type BufferAttribute,
  type BufferGeometry,
  type Object3D,
  type Texture,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import type { AvatarPartSlot } from '@obby/shared';
import { logger } from '../util/logger.js';
import { avatarUrls } from './bloxityConfig.js';

const SCOPE = 'BloxityAvatarAssets';

/**
 * Bloxity's avatar ASSETS, fetched from its CDN and cached once per asset.
 *
 * Everything here mirrors how the Bloxity SDK's own avatar renderer builds a
 * character (`createAvatarPreview` in legion-sdk.js), because that renderer is
 * the ground truth for what a Bloxity avatar looks like:
 *
 *   - the body is `/avatars/player.glb`: one skeleton, six skinned part meshes
 *     (`default_head`, `default_torso`, `default_arm_L/R`, `default_leg_L/R`)
 *   - a skin is ONE texture atlas drawn for that model's UVs, applied to every
 *     part mesh - NOT to this game's `player.fbx`, whose UVs are different
 *   - a body part is a skinned GLB authored in the same bind space, swapped in
 *     as the matching mesh's geometry with its joint indices remapped BY NAME
 *     onto the body's skeleton
 *
 * No SDK access at all - these are plain CDN files, so nothing here needs the
 * SDK to be present. Every cache holds promises, so concurrent requests for
 * the same asset share one download, and a failure is remembered as null so
 * a missing file is requested once.
 */

/** Which mesh in player.glb each part slot replaces - the SDK's PART_MESH_NAMES. */
export const PART_MESH_NAMES: Readonly<Record<AvatarPartSlot, string>> = {
  head: 'default_head',
  torso: 'default_torso',
  armL: 'default_arm_L',
  armR: 'default_arm_R',
  legL: 'default_leg_L',
  legR: 'default_leg_R',
};

/** The base body, normalised and ready to clone. */
export interface BloxityBaseBody {
  /** Feet at y = 0, facing +Z, scaled to the requested world height. */
  readonly prototype: Group;
  /** Bone names of the body's skeleton, in skin-index order. */
  readonly boneNames: readonly string[];
  /** The skin atlas embedded in player.glb: Bloxity's default look. */
  readonly defaultSkin: Texture | null;
}

let basePromise: Promise<BloxityBaseBody | null> | null = null;

/**
 * Load Bloxity's base avatar body once.
 *
 * @param worldHeight the height the character must stand at, so the Bloxity
 *                    body keeps exactly the size the game (and its camera and
 *                    collision) already expects
 */
export const loadBaseBody = (worldHeight: number): Promise<BloxityBaseBody | null> => {
  basePromise ??= new GLTFLoader()
    .loadAsync(avatarUrls.baseBody())
    .then((gltf) => {
      const scene = gltf.scene;
      scene.updateMatrixWorld(true);
      const box = new Box3().setFromObject(scene);
      const size = box.getSize(new Vector3());
      const scale = size.y > 0 ? worldHeight / size.y : 1;

      let boneNames: string[] = [];
      let defaultSkin: Texture | null = null;
      const material = new MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.85,
        metalness: 0,
        side: DoubleSide,
      });

      scene.traverse((child) => {
        if (!(child instanceof Mesh)) return;
        const source = child.material as MeshStandardMaterial;
        if (!defaultSkin && source.map) {
          defaultSkin = prepareSkin(source.map);
        }
        source.dispose();
        // One material for the prototype; each character clones its own the
        // first time it changes skin, so no player can repaint another.
        child.material = material;
        child.castShadow = true;
        child.receiveShadow = true;
        // Skinned bounds are unreliable once bones move; culling them makes
        // limbs vanish mid-animation, exactly as with the FBX.
        child.frustumCulled = false;
        if (child instanceof SkinnedMesh && boneNames.length === 0) {
          boneNames = child.skeleton.bones.map((bone) => bone.name);
        }
      });
      material.map = defaultSkin;

      const prototype = new Group();
      prototype.name = 'bloxity-avatar';
      scene.scale.setScalar(scale);
      scene.position.y = -box.min.y * scale;
      prototype.add(scene);
      prototype.updateMatrixWorld(true);

      logger.info(
        SCOPE,
        `base body loaded: ${boneNames.length} bones, scaled ${scale.toFixed(3)} to ${worldHeight} units`,
      );
      return { prototype, boneNames, defaultSkin } satisfies BloxityBaseBody;
    })
    .catch((error: unknown) => {
      logger.warn(SCOPE, 'base body unavailable - characters use the bundled player.fbx', error);
      return null;
    });
  return basePromise;
};

/** Skin textures as the SDK loads them: GLB UV convention, crisp pixels. */
const prepareSkin = (texture: Texture): Texture => {
  texture.flipY = false;
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
};

const skinCache = new Map<string, Promise<Texture | null>>();

/**
 * A skin atlas by id, resolved exactly as the SDK resolves it.
 *
 * The SDK builds `/avatars/skins/{id}.png`. The one catalog item whose file is
 * not named after its id is the built-in Default Skin, whose `assetPaths`
 * texture is `skins/0.png` - so an id with no file falls back to skin 0,
 * which is Bloxity's default look, never to a local texture.
 */
export const loadSkin = (id: string): Promise<Texture | null> => {
  let pending = skinCache.get(id);
  if (!pending) {
    pending = loadTexture(avatarUrls.skinTexture(id), false).then(async (texture) => {
      if (texture) return prepareSkin(texture);
      if (id === '0') return null;
      logger.info(SCOPE, `skin ${id} has no id-named file - using Bloxity's default skin 0`);
      return loadSkin('0');
    });
    skinCache.set(id, pending);
  }
  return pending;
};

const partCache = new Map<string, Promise<BufferGeometry | null>>();

/**
 * A body-part model's geometry, re-indexed onto the base body's skeleton.
 *
 * Part GLBs carry their OWN joint list (a torso lists 17 joints where the
 * body has 22), so joint index 5 in a part is not joint 5 on the body. Each
 * index is remapped by BONE NAME - the SDK's `swapBodyPart` does exactly
 * this - and the result is cached per part, since every character cloned
 * from the same body shares its skeleton order.
 */
export const loadPart = (
  slot: AvatarPartSlot,
  id: string,
  bodyBoneNames: readonly string[],
): Promise<BufferGeometry | null> => {
  const key = `${slot}:${id}`;
  let pending = partCache.get(key);
  if (!pending) {
    pending = new GLTFLoader()
      .loadAsync(avatarUrls.partMesh(slot, id))
      .then((gltf) => {
        let skinned: SkinnedMesh | null = null;
        let plain: Mesh | null = null;
        gltf.scene.traverse((child) => {
          if (child instanceof SkinnedMesh) skinned ??= child;
          else if (child instanceof Mesh) plain ??= child;
        });
        if (!skinned) {
          // A static part cannot follow the bones; the SDK uses it as-is.
          return (plain as Mesh | null)?.geometry ?? null;
        }
        const part = skinned as SkinnedMesh;
        const geometry = part.geometry.clone();
        const nameToIndex = new Map(bodyBoneNames.map((name, i) => [name, i]));
        const remap = part.skeleton.bones.map((bone) => nameToIndex.get(bone.name));
        const skinIndex = geometry.getAttribute('skinIndex') as BufferAttribute | undefined;
        if (skinIndex) {
          const values = skinIndex.array;
          for (let i = 0; i < values.length; i += 1) {
            const mapped = remap[values[i] as number];
            if (mapped !== undefined) values[i] = mapped;
          }
          skinIndex.needsUpdate = true;
        }
        return geometry;
      })
      .catch(() => {
        logger.warn(SCOPE, `part ${slot} ${id} unavailable - keeping Bloxity's default ${slot}`);
        return null;
      });
    partCache.set(key, pending);
  }
  return pending;
};

const accessoryCache = new Map<string, Promise<Object3D | null>>();

/**
 * A hat or back item, loaded once and CLONED per wearer.
 *
 * Textures load with three's default `flipY`, exactly as the SDK loads them -
 * OBJ UVs are bottom-up. Forcing `flipY = false` here, as this game used to,
 * mirrors every accessory texture vertically.
 */
export const loadAccessory = async (kind: 'hat' | 'back', id: string): Promise<Object3D | null> => {
  const key = `${kind}:${id}`;
  let pending = accessoryCache.get(key);
  if (!pending) {
    pending = (async () => {
      try {
        const object = await new OBJLoader().loadAsync(
          kind === 'hat' ? avatarUrls.hatMesh(id) : avatarUrls.backMesh(id),
        );
        const texture = await loadTexture(
          kind === 'hat' ? avatarUrls.hatTexture(id) : avatarUrls.backTexture(id),
          true,
        );
        if (texture) {
          texture.colorSpace = SRGBColorSpace;
          texture.magFilter = NearestFilter;
          texture.minFilter = NearestFilter;
        }
        const material = new MeshStandardMaterial({ map: texture, roughness: 0.85, metalness: 0 });
        object.traverse((child) => {
          if (!(child instanceof Mesh)) return;
          child.material = material;
          child.castShadow = true;
          child.frustumCulled = false;
        });
        return object;
      } catch {
        logger.warn(SCOPE, `${kind} ${id} unavailable`);
        return null;
      }
    })();
    accessoryCache.set(key, pending);
  }
  const prototype = await pending;
  // Geometry and material are shared read-only; each wearer gets its own node.
  return prototype ? prototype.clone(true) : null;
};

const loadTexture = (url: string, flipY: boolean): Promise<Texture | null> =>
  new Promise((resolve) => {
    new TextureLoader().load(
      url,
      (texture) => {
        texture.flipY = flipY;
        texture.needsUpdate = true;
        resolve(texture);
      },
      undefined,
      () => resolve(null),
    );
  });
