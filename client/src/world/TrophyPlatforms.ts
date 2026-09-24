import {
  COLLECTION_ZONE,
  collectionZoneX,
  collectionZoneZ,
  PLATFORM,
  GORGE,
  GORGE_HEAD,
  TREADMILL_BAY,
  SPAWN_PLATFORM,
  TROPHY_PLATFORMS,
} from '@obby/shared';
import {
  BoxGeometry,
  CanvasTexture,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  type Material,
  type Texture,
} from 'three';
import { AREA_DECK_THICKNESS } from '../config/worldVisuals.js';
import { DISPLAY_FONT, PITCH_GRASS_REPEAT, cliffRock, drawFootball, pitchGrass } from './WorldArt.js';
import { toon } from './ToonKit.js';
import type { WorldTextures } from './WorldTextures.js';

/**
 * The starting area, the trophy islands, their grass and the reward tags over
 * the collection strips.
 *
 * Every island shares ONE body geometry, ONE body material and ONE grass
 * deck, so the geometry rule is untouched and every island is the same bright
 * pitch - the starting area wears the same grass. No sign hangs over an
 * island: the name plaques that used to hang there sat in the flight path.
 */
/** Thickness of the grass laid over the headland's rock. */
const GRASS_THICKNESS = 0.5;

export class TrophyPlatforms {
  readonly root = new Group();

  private readonly geometries: BoxGeometry[] = [];
  /** Materials created here (labels). Toon materials belong to ToonKit. */
  private readonly materials: Material[] = [];
  private readonly textures: Texture[] = [];
  /** Clones of shared art carrying this surface's own repeat. */
  private readonly clones: Texture[] = [];
  private padLabelGeometry: PlaneGeometry | null = null;

  constructor(textures: WorldTextures) {
    void textures;
    this.buildSpawnPlatform();
    this.buildTrophyPlatforms();
  }

  dispose(): void {
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    for (const texture of this.textures) texture.dispose();
    for (const texture of this.clones) texture.dispose();
    this.padLabelGeometry?.dispose();
  }

  /**
   * The head of the gorge: solid ground, not a floating slab.
   *
   * The TOP of a headland that fills the canyon from rim to rim and runs down
   * past the river floor, so the start reads as the ground the gorge is cut
   * into. The river begins at its front face.
   *
   * One rock box; the stadium-ground grass is laid on separately as slabs, so
   * the treadmill bay can own its own rectangle of floor.
   */
  private buildSpawnPlatform(): void {
    const width = GORGE_HEAD.halfWidth * 2;
    const backZ = GORGE.startZ;
    const length = GORGE_HEAD.riverStartZ - backZ;
    const height = SPAWN_PLATFORM.topY - GORGE_HEAD.baseY;

    const rockMap = this.repeated(cliffRock(), length / 18, height / 18);
    const rock = toon(0xffffff, { map: rockMap });

    const bodyGeometry = new BoxGeometry(width, height - GRASS_THICKNESS, length);
    this.geometries.push(bodyGeometry);

    const body = new Mesh(bodyGeometry, rock);
    body.position.set(
      SPAWN_PLATFORM.x,
      SPAWN_PLATFORM.topY - GRASS_THICKNESS - (height - GRASS_THICKNESS) / 2,
      backZ + length / 2,
    );
    body.receiveShadow = true;
    this.root.add(body);

    // A rock ledge stepping out just below the grass, so the headland reads as
    // cut terrain meeting the canyon rather than a box with a lawn on top.
    const ledgeGeometry = new BoxGeometry(width + 3, 1.6, length + 3);
    const ledgeMaterial = toon(0xb8ac9c, { map: rockMap });
    this.geometries.push(ledgeGeometry);

    const ledge = new Mesh(ledgeGeometry, ledgeMaterial);
    ledge.position.set(
      SPAWN_PLATFORM.x,
      SPAWN_PLATFORM.topY - GRASS_THICKNESS - 1.5,
      backZ + length / 2,
    );
    ledge.receiveShadow = true;
    this.root.add(ledge);

    this.buildSpawnGrass(width, backZ, length);
  }

  /**
   * The grass surface, cut around the treadmill bay.
   *
   * Four slabs rather than one, because the bay floor owns the rectangle in
   * the middle of them. Every visible square of the starting area therefore
   * belongs to exactly one mesh, with no two surfaces at the same height.
   *
   * The same pitch grass as the islands, pinned to WORLD coordinates: each
   * slab maps its UVs 0..1 over its own size, so a shared repeat would draw
   * its stripes at a different width on every slab and break them at the
   * seams. Each slab gets its own repeat and offset instead.
   */
  private buildSpawnGrass(width: number, backZ: number, length: number): void {
    const frontZ = backZ + length;
    const halfWidth = width / 2;
    const bay = TREADMILL_BAY;

    // [minX, maxX, minZ, maxZ] for each slab around the bay.
    const slabs: [number, number, number, number][] = [
      [-halfWidth, halfWidth, bay.maxZ, frontZ],
      [-halfWidth, halfWidth, backZ, bay.minZ],
      [-halfWidth, bay.minX, bay.minZ, bay.maxZ],
      [bay.maxX, halfWidth, bay.minZ, bay.maxZ],
    ];

    for (const [minX, maxX, minZ, maxZ] of slabs) {
      const sizeX = maxX - minX;
      const sizeZ = maxZ - minZ;
      if (sizeX <= 0.01 || sizeZ <= 0.01) continue;

      const geometry = new BoxGeometry(sizeX, GRASS_THICKNESS, sizeZ);
      this.geometries.push(geometry);

      // A box's top face runs U with +X and V AGAINST +Z, so this maps texture
      // coordinates to world X / PITCH_GRASS_REPEAT and -Z / PITCH_GRASS_REPEAT.
      const map = this.repeated(pitchGrass(), sizeX / PITCH_GRASS_REPEAT, sizeZ / PITCH_GRASS_REPEAT);
      map.offset.set(minX / PITCH_GRASS_REPEAT, -maxZ / PITCH_GRASS_REPEAT);
      const slab = new Mesh(geometry, toon(0xffffff, { map }));
      slab.position.set(
        (minX + maxX) / 2,
        SPAWN_PLATFORM.topY - GRASS_THICKNESS / 2,
        (minZ + maxZ) / 2,
      );
      slab.receiveShadow = true;
      this.root.add(slab);
    }
  }

  private buildTrophyPlatforms(): void {
    // Shared across every island. The body is SHORTENED by the deck's
    // thickness and the deck sits in the space it leaves, so the two meet at
    // one coincident hidden face instead of two tops a hundredth apart.
    const bodyHeight = PLATFORM.thickness - AREA_DECK_THICKNESS;
    const bodyGeometry = new BoxGeometry(PLATFORM.width, bodyHeight, PLATFORM.length);
    // Carved stone with moss, identical for every island.
    const bodyMaterial = toon(0xd8cfc0, { map: this.repeated(cliffRock(), 1.2, 0.4) });
    this.geometries.push(bodyGeometry);

    // One shared grass deck - geometry AND material - for every island.
    const deckGeometry = new BoxGeometry(
      PLATFORM.width,
      AREA_DECK_THICKNESS,
      PLATFORM.length,
    );
    this.geometries.push(deckGeometry);
    const deckMaterial = toon(0xffffff, {
      map: this.repeated(
        pitchGrass(),
        PLATFORM.width / PITCH_GRASS_REPEAT,
        PLATFORM.length / PITCH_GRASS_REPEAT,
      ),
    });

    this.padLabelGeometry = new PlaneGeometry(5.6, 3.4);

    for (const platform of TROPHY_PLATFORMS) {
      const body = new Mesh(bodyGeometry, bodyMaterial);
      // Identical X, Y and rotation for every island - only Z varies.
      body.position.set(
        PLATFORM.x,
        PLATFORM.topY - AREA_DECK_THICKNESS - bodyHeight / 2,
        platform.centerZ,
      );
      body.rotation.y = PLATFORM.rotationY;
      body.receiveShadow = true;
      body.castShadow = true;
      this.root.add(body);

      const deck = new Mesh(deckGeometry, deckMaterial);
      // Top face exactly at the collision surface; bottom face coincident with
      // the body's top, where it is hidden.
      deck.position.set(
        PLATFORM.x,
        PLATFORM.topY - AREA_DECK_THICKNESS / 2,
        platform.centerZ,
      );
      deck.receiveShadow = true;
      this.root.add(deck);

      const padX = collectionZoneX();
      const padZ = collectionZoneZ(platform.centerZ);
      this.addPadLabel(padX, padZ, platform.value);
    }
  }

  /** A clone of shared art with this surface's own repeat. */
  private repeated(source: Texture, x: number, y: number): Texture {
    const map = source.clone();
    map.needsUpdate = true;
    map.repeat.set(x, y);
    this.clones.push(map);
    return map;
  }

  /** The reward tag over the collection area. */
  private addPadLabel(centerX: number, centerZ: number, value: number): void {
    if (!this.padLabelGeometry) return;
    const label = this.makeLabelMesh(this.padLabelGeometry, drawPadLabel(value));
    label.position.set(centerX, PLATFORM.topY + COLLECTION_ZONE.labelY, centerZ);
    this.root.add(label);
  }

  private makeLabelMesh(geometry: PlaneGeometry, canvas: HTMLCanvasElement): Mesh {
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.needsUpdate = true;
    this.textures.push(texture);

    const material = new MeshBasicMaterial({
      map: texture,
      transparent: true,
      side: DoubleSide,
      depthWrite: false,
      fog: false,
    });
    this.materials.push(material);

    const mesh = new Mesh(geometry, material);
    mesh.rotation.y = Math.PI;
    return mesh;
  }
}

const canvasOf = (width: number, height: number): CanvasRenderingContext2D => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  return ctx;
};

/** Outlined text, drawn the same way everywhere for a consistent look. */
const outlined = (
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  font: string,
  fill: string,
  outline = 10,
  maxWidth?: number,
): void => {
  ctx.font = font;
  ctx.lineWidth = outline;
  ctx.strokeStyle = '#0b1224';
  ctx.strokeText(text, x, y, maxWidth);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y, maxWidth);
};

/** "Return" above a red tag reading "+N Wins". */
const drawPadLabel = (value: number): HTMLCanvasElement => {
  const width = 320;
  const height = 192;
  const ctx = canvasOf(width, height);

  outlined(ctx, 'Return', width / 2 + 18, 34, `900 38px ${DISPLAY_FONT}`, '#ffffff', 9);
  drawFootball(ctx, width / 2 - 88, 34, 17);

  // A red tag with a gold rule, like a scoreboard's result panel.
  const plaqueW = 272;
  const plaqueH = 88;
  const x = (width - plaqueW) / 2;
  const y = 74;
  ctx.fillStyle = '#c8102e';
  ctx.strokeStyle = '#0b1224';
  ctx.lineWidth = 6;
  roundedRect(ctx, x, y, plaqueW, plaqueH, 10);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = '#f2c14e';
  ctx.lineWidth = 3;
  roundedRect(ctx, x + 7, y + 7, plaqueW - 14, plaqueH - 14, 6);
  ctx.stroke();

  outlined(ctx, `+${value} Wins`, width / 2, y + plaqueH / 2 + 2, `900 46px ${DISPLAY_FONT}`, '#ffe08a', 8);
  return ctx.canvas;
};

const roundedRect = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void => {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
};
