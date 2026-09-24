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
import {
  AREA_DECK_THICKNESS,
  AREA_LABEL_HEIGHT,
  AREA_THEMES,
  DEFAULT_AREA_THEME,
  WORLD_COLORS,
  type AreaTheme,
} from '../config/worldVisuals.js';
import {
  DISPLAY_FONT,
  KANJI_FONT,
  cliffRock,
  drawBlossom,
  flagstones,
  grass,
  lacquer,
  woodPlanks,
} from './JapaneseArt.js';
import { toon } from './ToonKit.js';
import type { WorldTextures } from './WorldTextures.js';

/**
 * The starting area, the trophy islands, their themed decks, the collection
 * pads and the floating plaques.
 *
 * Every island shares ONE body geometry and ONE body material, so the geometry
 * rule is untouched. What varies per island is presentation only: the deck
 * laid on top - timber planks along the sakura gardens, mossy flagstones in
 * the mountains, gold-inlaid lacquer on the floating shrines - and a wooden
 * plaque carrying the island's Japanese title and English name.
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
  private readonly deckMaps = new Map<string, Texture>();
  private padLabelGeometry: PlaneGeometry | null = null;
  private areaLabelGeometry: PlaneGeometry | null = null;

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
    this.areaLabelGeometry?.dispose();
  }

  /**
   * The head of the gorge: solid ground, not a floating slab.
   *
   * The TOP of a headland that fills the canyon from rim to rim and runs down
   * past the river floor, so the start reads as the ground the gorge is cut
   * into. The river begins at its front face.
   *
   * One rock box; the shrine-garden grass is laid on separately as slabs, so
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
   */
  private buildSpawnGrass(width: number, backZ: number, length: number): void {
    // Shrine-garden grass, strewn with fallen petals.
    const map = this.repeated(
      grass(WORLD_COLORS.grass, WORLD_COLORS.grassDark, WORLD_COLORS.grassLight, 3),
      width / 12,
      length / 12,
    );
    const lawn = toon(0xffffff, { map });

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

      const slab = new Mesh(geometry, lawn);
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

    // One shared deck geometry; only its material differs per area.
    const deckGeometry = new BoxGeometry(
      PLATFORM.width,
      AREA_DECK_THICKNESS,
      PLATFORM.length,
    );
    this.geometries.push(deckGeometry);

    this.padLabelGeometry = new PlaneGeometry(5.6, 3.4);
    this.areaLabelGeometry = new PlaneGeometry(13, 4.3);

    for (const platform of TROPHY_PLATFORMS) {
      const theme = AREA_THEMES[platform.area] ?? DEFAULT_AREA_THEME;

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

      const deck = new Mesh(deckGeometry, this.deckMaterial(theme));
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
      this.addAreaLabel(platform.centerZ, theme);
    }
  }

  /** One deck material per style and tint, cached through ToonKit. */
  private deckMaterial(theme: AreaTheme): Material {
    switch (theme.deckStyle) {
      case 'planks':
        return toon(theme.deck, { map: this.deckMap('planks', woodPlanks(), 5.5) });
      case 'stone':
        return toon(theme.deck, { map: this.deckMap('stone', flagstones(), 6) });
      case 'lacquer':
        // Lacquer carries its own colour, so the gold inlay stays gold.
        return toon(0xffffff, {
          map: this.deckMap(`lacquer:${theme.deck}`, lacquer(theme.deck), 11),
          emissive: theme.deck,
          emissiveIntensity: 0.12,
        });
    }
  }

  /** A deck texture repeated every `unit` world units, shared per style. */
  private deckMap(key: string, source: Texture, unit: number): Texture {
    const existing = this.deckMaps.get(key);
    if (existing) return existing;
    const map = this.repeated(source, PLATFORM.width / unit, PLATFORM.length / unit);
    if (key === 'planks') {
      // Planks lie ACROSS the route, so the run crosses the seams.
      map.center.set(0.5, 0.5);
      map.rotation = Math.PI / 2;
    }
    this.deckMaps.set(key, map);
    return map;
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

  /** The island's plaque - kanji over its English name - high above the centre. */
  private addAreaLabel(centerZ: number, theme: AreaTheme): void {
    if (!this.areaLabelGeometry) return;
    const label = this.makeLabelMesh(this.areaLabelGeometry, drawAreaLabel(theme));
    label.position.set(PLATFORM.x, PLATFORM.topY + AREA_LABEL_HEIGHT, centerZ);
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
): void => {
  ctx.font = font;
  ctx.lineWidth = outline;
  ctx.strokeStyle = '#1b1416';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
};

/** "Return" above a red lacquer tag reading "+N Wins". */
const drawPadLabel = (value: number): HTMLCanvasElement => {
  const width = 320;
  const height = 192;
  const ctx = canvasOf(width, height);

  outlined(ctx, 'Return', width / 2 + 18, 34, `900 38px ${DISPLAY_FONT}`, '#fff4e0', 9);
  outlined(ctx, '帰', width / 2 - 86, 34, `900 38px ${KANJI_FONT}`, '#ff9cc0', 8);

  // A red lacquer tag with a gold rule, like a shrine's offering board.
  const plaqueW = 272;
  const plaqueH = 88;
  const x = (width - plaqueW) / 2;
  const y = 74;
  ctx.fillStyle = '#b3261e';
  ctx.strokeStyle = '#1b1416';
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

/**
 * A hanging wooden plaque: dark timber in a gold frame, the island's Japanese
 * title large and its English name beneath, so it stays readable.
 */
const drawAreaLabel = (theme: AreaTheme): HTMLCanvasElement => {
  const width = 512;
  const height = 170;
  const ctx = canvasOf(width, height);

  const late = theme.stage === 'late';
  ctx.fillStyle = late ? '#1b1416' : '#3a2a22';
  ctx.strokeStyle = '#f2c14e';
  ctx.lineWidth = 6;
  roundedRect(ctx, 12, 8, width - 24, height - 16, 12);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = '#c8281e';
  ctx.lineWidth = 3;
  roundedRect(ctx, 24, 18, width - 48, height - 36, 8);
  ctx.stroke();
  drawBlossom(ctx, 54, height / 2, 18, '#ff9cc0');
  drawBlossom(ctx, width - 54, height / 2, 18, '#ff9cc0');

  const kanjiSize = theme.kanji.length > 3 ? 54 : 64;
  outlined(ctx, theme.kanji, width / 2, 62, `900 ${kanjiSize}px ${KANJI_FONT}`, '#fff4e0', 8);
  outlined(ctx, theme.name.toUpperCase(), width / 2, 126, `900 32px ${DISPLAY_FONT}`, '#ffd36b', 7);
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
