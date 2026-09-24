import {
  Group,
  Mesh,
  MeshStandardMaterial,
  type Material,
  type Object3D,
} from 'three';
import { PoseBuffer, type PoseDefinition } from '../../animation/PoseBuffer.js';
import { PlayerRig } from '../../animation/rig/PlayerRig.js';
import { ronaldoKit } from '../../config/ronaldoKits.js';
import { playerModelLoader } from '../PlayerModelLoader.js';
import { createHair, seatOnHead } from './RonaldoHair.js';
import { ronaldoSkin } from './RonaldoSkin.js';

/**
 * A Ronaldo that is scenery rather than a player: the display models on the
 * Win Shop pedestals, and the statue at spawn.
 *
 * Built from exactly what a player becomes - the same body the loader hands
 * every character, the same painted atlas, the same hair cap - so the model a
 * player walks up to IS the character they turn into. It is posed once and
 * never animated by the player animator; it has no gameplay presence at all.
 */
export interface RonaldoFigure {
  /** Place and turn this. Feet at y = 0, facing +Z before any rotation. */
  readonly root: Group;
  /** Re-pose the figure. Rebuilt from the bind pose, so it never drifts. */
  pose(definition: PoseDefinition): void;
  dispose(): void;
}

export interface FigureOptions {
  /**
   * Draw the whole figure in one material instead of the kit - a statue.
   * The caller owns it.
   */
  readonly material?: Material;
}

/**
 * Build a figure for a tier slot. Call only once the player model has loaded -
 * it clones the same body every character uses.
 */
export const createRonaldoFigure = (slot: number, options: FigureOptions = {}): RonaldoFigure => {
  const kit = ronaldoKit(slot);
  const bloxityBody = playerModelLoader.baseBody !== null;
  const root = new Group();
  root.name = `ronaldo-figure-${kit.slot}`;

  const model = playerModelLoader.createInstance();
  root.add(model);

  // Bind while at rest; the hair is seated from the same rest pose below,
  // and only then is the figure posed.
  const rig = new PlayerRig(model, model);

  let owned: MeshStandardMaterial | null = null;
  const material =
    options.material ??
    (owned = new MeshStandardMaterial({
      map: ronaldoSkin(kit.slot, bloxityBody),
      roughness: 0.8,
      metalness: 0,
      emissive: kit.glow > 0 ? 0xffffff : 0x000000,
      emissiveMap: kit.glow > 0 ? ronaldoSkin(kit.slot, bloxityBody) : null,
      emissiveIntensity: kit.glow,
    }));

  // Paint the body BEFORE the hair is seated - the cap hangs inside the
  // model, and this pass would otherwise paint it with the kit atlas too.
  model.traverse((child: Object3D) => {
    if (!(child instanceof Mesh)) return;
    child.material = material;
    child.castShadow = true;
    child.frustumCulled = false;
  });

  const hairHolder = new Group();
  const neck = rig.getBone('Neck1');
  const height = playerModelLoader.getReport()?.heightWorldUnits ?? 3.2;
  if (neck) seatOnHead(hairHolder, model, neck, height);
  const hair = createHair(kit.hair);
  if (options.material) hair.material = options.material;
  hairHolder.add(hair);

  const buffer = new PoseBuffer();
  return {
    root,
    pose(definition: PoseDefinition): void {
      buffer.applyDefinition(definition);
      rig.applyPose(buffer);
    },
    dispose(): void {
      root.removeFromParent();
      // The atlas and the hair cap are shared caches; only this figure's own
      // material is freed.
      owned?.dispose();
    },
  };
};
