import {
  SPAWN_PLATFORM,
  TREADMILL_CONSOLE_Z,
  TREADMILL_DECK_Y,
  TREADMILL_ROW,
  TREADMILL_DECKS,
  isTreadmillUnlocked,
  treadmillByTier,
  type TreadmillDeck,
  type TreadmillTier,
} from '@obby/shared';
import {
  BoxGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  RepeatWrapping,
  SRGBColorSpace,
  type Material,
} from 'three';
import {
  TREADMILL_LOCKED_COLOR,
  treadmillTheme,
  type TreadmillTheme,
} from '../config/worldVisuals.js';

/** Blend a tier colour toward the locked slate by `amount` (0..1). */
const dim = (color: number, amount: number): Color =>
  new Color(color).lerp(new Color(TREADMILL_LOCKED_COLOR), amount);

/** Belt scroll speed, in texture repeats per second, at intensity 0 and 1. */
const BELT_SPEED_MIN = 0.35;
const BELT_SPEED_MAX = 2.6;

/** Tiers at or above this intensity get a lit halo bar over the console. */
const HALO_INTENSITY = 0.45;

/** Geometry shared by every machine in the row. */
interface Parts {
  readonly deck: BoxGeometry;
  readonly rail: BoxGeometry;
  readonly roller: CylinderGeometry;
  readonly console: BoxGeometry;
  readonly halo: BoxGeometry;
  readonly label: PlaneGeometry;
}

/** Everything mutable about one treadmill, kept so it can be re-themed. */
interface Unit {
  readonly tier: TreadmillTier;
  readonly theme: TreadmillTheme;
  readonly beltTexture: CanvasTexture;
  readonly frameMaterial: MeshLambertMaterial;
  readonly glowMaterials: MeshBasicMaterial[];
  readonly beltMaterial: MeshLambertMaterial;
  readonly labelCanvas: HTMLCanvasElement;
  readonly labelTexture: CanvasTexture;
  unlocked: boolean;
}

/**
 * The treadmill array along the back wall of the starting platform.
 *
 * Display only. Which deck a player is on, and whether they may use it, is
 * decided entirely by the server from its own authoritative position; this
 * renders the row and recolours it from the replicated rebirth count.
 *
 * Every unit shares one geometry per part - deck, rail, roller, console,
 * label - so six machines cost six sets of materials rather than six
 * models. The belt texture is a single canvas cloned per tier, which gives
 * each deck an independent scroll offset for free.
 */
export class Treadmills {
  readonly root = new Group();

  private readonly units: Unit[] = [];
  private readonly geometries: (BoxGeometry | CylinderGeometry | PlaneGeometry)[] = [];
  private readonly materials: Material[] = [];
  private readonly textures: CanvasTexture[] = [];

  private time = 0;
  private lastRebirths = -1;

  constructor() {
    const beltSource = new CanvasTexture(drawBelt());
    beltSource.wrapS = RepeatWrapping;
    beltSource.wrapT = RepeatWrapping;
    this.textures.push(beltSource);

    // One geometry per PART, reused by every machine in the row.
    const parts: Parts = {
      deck: new BoxGeometry(
        TREADMILL_ROW.beltWidth,
        TREADMILL_ROW.deckHeight,
        TREADMILL_ROW.beltLength,
      ),
      rail: new BoxGeometry(0.34, TREADMILL_ROW.railHeight, TREADMILL_ROW.beltLength),
      roller: new CylinderGeometry(0.26, 0.26, TREADMILL_ROW.beltWidth, 10),
      console: new BoxGeometry(
        TREADMILL_ROW.beltWidth,
        TREADMILL_ROW.consoleHeight,
        TREADMILL_ROW.consoleDepth,
      ),
      halo: new BoxGeometry(TREADMILL_ROW.beltWidth + 0.5, 0.26, 0.26),
      label: new PlaneGeometry(TREADMILL_ROW.beltWidth + 1.2, 2.1),
    };
    this.geometries.push(
      parts.deck,
      parts.rail,
      parts.roller,
      parts.console,
      parts.halo,
      parts.label,
    );

    // One unit per PHYSICAL deck: a paired tier builds two identical machines.
    for (const deck of TREADMILL_DECKS) {
      const tier = treadmillByTier(deck.tier);
      if (tier) this.units.push(this.buildUnit(tier, deck, beltSource, parts));
    }
  }

  /** Scroll the belts. */
  update(delta: number): void {
    this.time += delta;

    for (const unit of this.units) {
      const speed =
        BELT_SPEED_MIN + (BELT_SPEED_MAX - BELT_SPEED_MIN) * unit.theme.intensity;
      // A locked machine idles; an unlocked one runs at its tier speed.
      unit.beltTexture.offset.y -= delta * (unit.unlocked ? speed : BELT_SPEED_MIN * 0.3);

    }
  }

  /**
   * Re-theme for the player's rebirth count.
   *
   * Locked machines are dimmed and their label states the requirement;
   * unlocked ones light up. The gate itself is the server's - this only
   * mirrors the same shared predicate, so the two cannot disagree.
   */
  setRebirths(rebirths: number): void {
    if (rebirths === this.lastRebirths) return;
    this.lastRebirths = rebirths;

    for (const unit of this.units) {
      const unlocked = isTreadmillUnlocked(unit.tier.tier, rebirths);
      unit.unlocked = unlocked;

      // A locked machine is DIMMED toward its tier colour, not repainted a
      // uniform grey: a player at rebirth 1 still sees distinguishable
      // machines climbing toward the Gold one, which is the whole point of
      // the ladder. Unlocking then lights the same colour up.
      unit.frameMaterial.color.set(
        unlocked ? unit.theme.accent : dim(unit.theme.accent, 0.72),
      );
      unit.frameMaterial.emissive.set(new Color(unit.theme.accent));
      unit.frameMaterial.emissiveIntensity = unit.theme.intensity * (unlocked ? 0.7 : 0.14);

      for (const material of unit.glowMaterials) {
        material.color.set(unit.theme.accent);
        material.opacity = unlocked ? 1 : 0.3;
      }
      unit.beltMaterial.color.set(
        unlocked ? unit.theme.belt : dim(unit.theme.belt, 0.45),
      );

      drawLabel(unit.labelCanvas, unit.tier, unlocked);
      unit.labelTexture.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    for (const texture of this.textures) texture.dispose();
  }

  private buildUnit(
    tier: TreadmillTier,
    placement: TreadmillDeck,
    beltSource: CanvasTexture,
    parts: Parts,
  ): Unit {
    const theme = treadmillTheme(tier.tier);
    const centreX = placement.x;
    const group = new Group();
    this.root.add(group);

    // Cloning the source texture keeps ONE canvas in memory while giving this
    // deck its own scroll offset.
    const beltTexture = beltSource.clone();
    beltTexture.needsUpdate = true;
    beltTexture.wrapS = RepeatWrapping;
    beltTexture.wrapT = RepeatWrapping;
    beltTexture.repeat.set(1, TREADMILL_ROW.beltLength / 1.4);
    this.textures.push(beltTexture);

    const beltMaterial = new MeshLambertMaterial({ map: beltTexture, color: theme.belt });
    this.materials.push(beltMaterial);

    const deck = new Mesh(parts.deck, beltMaterial);
    deck.position.set(
      centreX,
      SPAWN_PLATFORM.topY + TREADMILL_ROW.deckHeight / 2,
      TREADMILL_ROW.centerZ,
    );
    deck.receiveShadow = true;
    group.add(deck);

    const frameMaterial = new MeshLambertMaterial({ color: theme.accent });
    this.materials.push(frameMaterial);

    // Side rails, so the deck reads as a machine you step onto, not a mat.
    for (const side of [-1, 1]) {
      const rail = new Mesh(parts.rail, frameMaterial);
      rail.position.set(
        centreX + side * (TREADMILL_ROW.beltWidth / 2 + 0.17),
        TREADMILL_DECK_Y + TREADMILL_ROW.railHeight / 2,
        TREADMILL_ROW.centerZ,
      );
      rail.castShadow = true;
      group.add(rail);
    }

    // Rollers at each end of the belt.
    for (const end of [-1, 1]) {
      const roller = new Mesh(parts.roller, frameMaterial);
      roller.rotation.z = Math.PI / 2;
      roller.position.set(
        centreX,
        SPAWN_PLATFORM.topY + 0.22,
        TREADMILL_ROW.centerZ + end * (TREADMILL_ROW.beltLength / 2 - 0.1),
      );
      group.add(roller);
    }

    const consoleMesh = new Mesh(parts.console, frameMaterial);
    consoleMesh.position.set(
      centreX,
      SPAWN_PLATFORM.topY + TREADMILL_ROW.consoleHeight / 2,
      TREADMILL_CONSOLE_Z,
    );
    consoleMesh.castShadow = true;
    group.add(consoleMesh);

    const glowMaterials: MeshBasicMaterial[] = [];

    // A lit halo bar marks the machines a step above the starters.
    if (theme.intensity >= HALO_INTENSITY) {
      const haloMaterial = new MeshBasicMaterial({
        color: theme.accent,
        transparent: true,
        fog: false,
      });
      this.materials.push(haloMaterial);
      glowMaterials.push(haloMaterial);

      const halo = new Mesh(parts.halo, haloMaterial);
      halo.position.set(
        centreX,
        SPAWN_PLATFORM.topY + TREADMILL_ROW.consoleHeight + 0.2,
        TREADMILL_CONSOLE_Z,
      );
      group.add(halo);
    }


    // Floating label facing the spawn area, so it reads on approach.
    const labelCanvas = createLabelCanvas();
    drawLabel(labelCanvas, tier, false);
    const labelTexture = new CanvasTexture(labelCanvas);
    labelTexture.colorSpace = SRGBColorSpace;
    this.textures.push(labelTexture);

    const labelMaterial = new MeshBasicMaterial({
      map: labelTexture,
      transparent: true,
      side: DoubleSide,
      depthWrite: false,
      fog: false,
    });
    this.materials.push(labelMaterial);

    const label = new Mesh(parts.label, labelMaterial);
    label.position.set(
      centreX,
      SPAWN_PLATFORM.topY + TREADMILL_ROW.labelY,
      TREADMILL_CONSOLE_Z + 0.6,
    );
    group.add(label);

    return {
      tier,
      theme,
      beltTexture,
      frameMaterial,
      glowMaterials,
      beltMaterial,
      labelCanvas,
      labelTexture,
      unlocked: false,
    };
  }
}

/** Belt tread: dark rubber with lighter cross-slats. */
const drawBelt = (): HTMLCanvasElement => {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = 'rgba(0,0,0,0.42)';
  for (let y = 0; y < 64; y += 16) ctx.fillRect(0, y, 64, 9);
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  for (let y = 0; y < 64; y += 16) ctx.fillRect(0, y + 9, 64, 2);
  return canvas;
};

const createLabelCanvas = (): HTMLCanvasElement => {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 128;
  return canvas;
};

/** Multiplier and the rebirth gate - the whole state of one machine. */
const drawLabel = (
  canvas: HTMLCanvasElement,
  tier: TreadmillTier,
  unlocked: boolean,
): void => {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const w = canvas.width;
  ctx.clearRect(0, 0, w, canvas.height);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  outlined(ctx, `x${tier.multiplier} Steps`, w / 2, 36, 42, unlocked ? '#ffffff' : '#9aa4b0');
  outlined(
    ctx,
    unlocked ? tier.name : `${tier.requiredRebirth} Rebirth`,
    w / 2,
    88,
    30,
    unlocked ? '#ffe578' : '#ff8080',
  );
};

const outlined = (
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  fill: string,
): void => {
  ctx.font = `900 ${size}px "Trebuchet MS", "Segoe UI", sans-serif`;
  ctx.lineJoin = 'round';
  ctx.lineWidth = size * 0.24;
  ctx.strokeStyle = 'rgba(12,18,28,0.92)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
};
