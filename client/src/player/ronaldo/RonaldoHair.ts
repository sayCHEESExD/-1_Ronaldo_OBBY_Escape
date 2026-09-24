import {
  BoxGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  type Bone,
  type BufferGeometry,
  type Object3D,
} from 'three';
import { merge } from '../../world/WorldProps.js';
import { at } from '../../world/PropBatch.js';

/**
 * Ronaldo's hair: a short cap over the crown with the lifted quiff at the
 * front, as a mesh so the head has his silhouette and not just a painted
 * hairline.
 *
 * Authored around the head's CENTRE in head units - the head is a cube of
 * half-size 1 - and seated onto the Neck1 bone by `seatOnHead`, which works
 * the placement out from the bind pose. That is what lets one cap sit on both
 * Bloxity's body and the FBX fallback, whose neck bones point in different
 * directions: nothing here assumes a bone axis.
 */

let capGeometry: BufferGeometry | null = null;
const materials = new Map<string, MeshStandardMaterial>();

/** The cap, shared by every wearer. */
const hairGeometry = (): BufferGeometry => {
  capGeometry ??= merge([
    // Crown, just proud of the head's top face.
    [new BoxGeometry(2.1, 0.34, 2.12), at(0, 1.1, -0.03)],
    // The quiff: higher at the front, swept up and slightly back.
    [new BoxGeometry(1.62, 0.36, 0.9), at(0, 1.36, 0.52, 0, 1, -0.22)],
    [new BoxGeometry(1.1, 0.22, 0.6), at(0.08, 1.56, 0.62, 0, 1, -0.34)],
    // Back of the head, down to above the neck.
    [new BoxGeometry(2.1, 1.2, 0.2), at(0, 0.5, -1.03)],
    // Short sides above the ears.
    [new BoxGeometry(0.12, 0.44, 1.7), at(1.03, 0.8, -0.18)],
    [new BoxGeometry(0.12, 0.44, 1.7), at(-1.03, 0.8, -0.18)],
  ]);
  return capGeometry;
};

const hairMaterial = (color: string): MeshStandardMaterial => {
  let material = materials.get(color);
  if (!material) {
    material = new MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05 });
    materials.set(color, material);
  }
  return material;
};

/** A fresh cap node in a colour. Geometry and material are shared. */
export const createHair = (color: string): Mesh => {
  const mesh = new Mesh(hairGeometry(), hairMaterial(color));
  mesh.name = 'ronaldo-hair';
  mesh.castShadow = true;
  // Skinned-character bounds are unreliable once bones move; the cap rides
  // one, so it follows the same rule as every body mesh.
  mesh.frustumCulled = false;
  return mesh;
};

/** Recolour a cap made by `createHair`. */
export const setHairColor = (mesh: Mesh, color: string): void => {
  mesh.material = hairMaterial(color);
};

/**
 * Seat `holder` on the head, under `neck`, in the model's CURRENT pose - call
 * it while the rig is still at bind pose.
 *
 * Both bodies are the same blocky figure at the same height: 6.4 body units
 * tall with the head the top 1.6 of it, so the head's centre sits at 7/8 of
 * the height and its half-size is 1/8. The holder is placed there in the
 * model's own parent space and then expressed in the bone's local frame, so
 * the neck carries it through every animation without the cap knowing which
 * way that bone's axes run.
 *
 * @param model  the character model (its parent defines the upright frame)
 * @param height the model's standing height in its parent's units
 */
export const seatOnHead = (holder: Group, model: Object3D, neck: Bone, height: number): void => {
  const frame = model.parent ?? model;
  frame.updateMatrixWorld(true);

  const halfSize = height / 8;
  const inFrame = new Matrix4().compose(
    new Vector3(0, height * 0.875, 0),
    new Quaternion(),
    new Vector3(halfSize, halfSize, halfSize),
  );
  const toBone = new Matrix4().copy(neck.matrixWorld).invert().multiply(frame.matrixWorld).multiply(inFrame);
  toBone.decompose(holder.position, holder.quaternion, holder.scale);
  neck.add(holder);
};

/** Free the shared cap. Only for a full teardown - every wearer shares it. */
export const disposeHair = (): void => {
  capGeometry?.dispose();
  capGeometry = null;
  for (const material of materials.values()) material.dispose();
  materials.clear();
};
