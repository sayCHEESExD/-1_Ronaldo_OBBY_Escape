import { BANK_WALL, GORGE, GORGE_HEAD } from '@obby/shared';
import { BoxGeometry, Group, Mesh, type Texture } from 'three';
import { WORLD_COLORS } from '../config/worldVisuals.js';
import { cliffRock, grass, riverWater } from './WorldArt.js';
import { toon } from './ToonKit.js';
import type { WorldTextures } from './WorldTextures.js';

/**
 * The gorge shell: the river on the channel floor, the stratified cliff walls
 * and the grassy rims that cap them. The sky is `SkyAtmosphere`.
 *
 * Everything is a scaled instance of ONE unit box, so the entire shell is a
 * handful of draw calls. Materials are cel-shaded through the shared ramp and
 * owned by `ToonKit`; only the river's own scrolling texture lives here.
 */
export class GorgeTerrain {
  readonly root = new Group();

  private readonly boxGeometry = new BoxGeometry(1, 1, 1);
  private riverMap: Texture | null = null;
  /** Per-surface clones of the shared art, each with its own repeat. */
  private readonly clones: Texture[] = [];

  constructor(textures: WorldTextures) {
    const length = GORGE.horizonZ - GORGE.startZ;
    const centerZ = (GORGE.horizonZ + GORGE.startZ) / 2;

    this.buildWater(textures);
    this.buildWalls(textures, length, centerZ);
  }

  /** Let the river flow. Purely a texture scroll - the floor is a death zone. */
  update(delta: number): void {
    if (this.riverMap) this.riverMap.offset.y -= delta * 0.35;
  }

  dispose(): void {
    this.boxGeometry.dispose();
    this.riverMap?.dispose();
    for (const texture of this.clones) texture.dispose();
  }

  /**
   * The river running the length of the gorge.
   *
   * Opaque and flat - a scrolling foam texture is the only thing that moves.
   * It is still the death zone.
   */
  private buildWater(textures: WorldTextures): void {
    void textures;
    // The river BEGINS at the starting platform's front edge. Behind that the
    // world is solid headland, so the channel reads as running out from under
    // the start rather than passing beneath a slab floating over it.
    const length = GORGE.horizonZ - GORGE_HEAD.riverStartZ;
    const centerZ = (GORGE.horizonZ + GORGE_HEAD.riverStartZ) / 2;

    // Wider than the visible channel and thick, so it tucks under the canyon
    // slopes instead of ending in a hairline crack against them.
    const width = (GORGE.bankInnerX + 4) * 2;
    const depth = 8;

    // A private clone, so scrolling it cannot move any other surface.
    const map = riverWater().clone();
    map.needsUpdate = true;
    map.repeat.set(width / 22, length / 22);
    this.riverMap = map;

    const material = toon(0xffffff, { map, emissive: 0x0a3a60, emissiveIntensity: 0.35 });

    const water = new Mesh(this.boxGeometry, material);
    water.scale.set(width, depth, length);
    // Top face exactly at the pit floor, which is also the foot of the slopes.
    water.position.set(0, GORGE.pitFloorY - depth / 2, centerZ);
    water.receiveShadow = true;
    this.root.add(water);
  }

  /**
   * Steep tiled slopes rising out of the water, capped by a green rim.
   *
   * The SLOPES start at the gorge mouth. They used to run the whole world, and
   * a slope crosses platform height at x = 27.9 while the starting headland
   * reaches x = 33 - so the last five units of bank rose straight up through
   * the spawn grass as blue shards on both sides. Behind the mouth the
   * headland IS the terrain, and nothing else belongs there.
   *
   * The RIMS still run the full length: they sit at x >= 33, outboard of the
   * headland, so they flank the start without intersecting it.
   */
  private buildWalls(textures: WorldTextures, length: number, centerZ: number): void {
    void textures;
    const rise = BANK_WALL.rimY - BANK_WALL.footY;
    const run = BANK_WALL.rimX - BANK_WALL.footX;
    const slopeFaceLength = Math.hypot(rise, run);

    // The slab's top face runs U across the slope, so the strata are turned
    // to lie along the gorge. One texture repeat is roughly 18 units.
    const wallMap = cliffRock(true).clone();
    wallMap.needsUpdate = true;
    wallMap.repeat.set(slopeFaceLength / 18, length / 18);
    this.clones.push(wallMap);
    const wallMaterial = toon(0xffffff, { map: wallMap });

    const rimMap = grass(WORLD_COLORS.grass, WORLD_COLORS.grassDark, WORLD_COLORS.grassLight, 9).clone();
    rimMap.needsUpdate = true;
    rimMap.repeat.set(BANK_WALL.rimWidth / 14, length / 14);
    this.clones.push(rimMap);
    const rimMaterial = toon(0xffffff, { map: rimMap });

    // Thickness of the slab whose TOP face forms the visible slope.
    const slabDepth = 26;

    // Pitch of the slope, and the midpoint its top face must pass through.
    const angle = Math.atan2(rise, run);
    const midX = (BANK_WALL.footX + BANK_WALL.rimX) / 2;
    const midY = (BANK_WALL.footY + BANK_WALL.rimY) / 2;

    // Only the part of the world that actually has a river in it.
    const slopeLength = GORGE.horizonZ - GORGE_HEAD.riverStartZ;
    const slopeCenterZ = (GORGE.horizonZ + GORGE_HEAD.riverStartZ) / 2;

    for (const side of [-1, 1] as const) {
      const slope = new Mesh(this.boxGeometry, wallMaterial);
      slope.scale.set(slopeFaceLength, slabDepth, slopeLength);
      // Tilt about Z so the slab's TOP face becomes the canyon slope, rising
      // from the waterline out to the rim.
      slope.rotation.z = side * angle;
      // The slab hangs below that face, so its centre is offset along the
      // face's own normal - NOT straight down in world Y. Offsetting in Y was
      // the bug behind the seam: it slid the face sideways and down, so the
      // slope started inside the channel and its top never reached the rim,
      // leaving the green bank visibly disconnected from the blue wall.
      slope.position.set(
        side * (midX + Math.sin(angle) * (slabDepth / 2)),
        midY - Math.cos(angle) * (slabDepth / 2),
        slopeCenterZ,
      );
      slope.receiveShadow = true;
      this.root.add(slope);

      const rim = new Mesh(this.boxGeometry, rimMaterial);
      rim.scale.set(BANK_WALL.rimWidth, slabDepth, length);
      rim.position.set(
        side * (BANK_WALL.rimX + BANK_WALL.rimWidth / 2),
        BANK_WALL.rimY - slabDepth / 2,
        centerZ,
      );
      rim.receiveShadow = true;
      this.root.add(rim);
    }
  }
}
