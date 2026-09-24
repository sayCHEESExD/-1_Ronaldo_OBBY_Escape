import {
  BOOT_SHOP,
  BOOT_TIERS,
  SPAWN_PLATFORM,
  canAffordBoot,
  formatSpeed,
  isBootOwned,
  type BootTier,
} from '@obby/shared';
import {
  BoxGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  type Material,
} from 'three';
import type { PoseDefinition } from '../animation/PoseBuffer.js';
import { SIUUU_ANIM } from '../config/animationConfig.js';
import { ronaldoKit } from '../config/ronaldoKits.js';
import { WORLD_COLORS } from '../config/worldVisuals.js';
import { createRonaldoFigure, type RonaldoFigure } from '../player/ronaldo/RonaldoFigure.js';
import {
  SIGN_FRAME_MARGIN,
  SIGN_GLOW_STANDOFF,
  createSignFrameMaterial,
  createSignGlow,
  drawSign,
} from './SignPanel.js';
import { DISPLAY_FONT } from './WorldArt.js';

/** Sign canvas. The mesh is sized to this aspect so the text is not stretched. */
const SIGN_WIDTH = 1024;
const SIGN_HEIGHT = 220;

/** Structure, matched to the treadmill bay's kerb and the spawn wall coping. */
const SHOP_STRUCTURE_COLOR = 0x2c3a5a;
const SHOP_COPING_COLOR = 0xf4f6fb;
const SHOP_WALL_HEIGHT = 8;
const SHOP_WALL_THICKNESS = 1.6;

/** Pedestal label canvas and the plane it is drawn on. */
const LABEL_CANVAS = { width: 384, height: 240 } as const;
/** Narrower than the pedestal spacing, so neighbouring names never touch. */
const LABEL_SIZE = { width: 4.6, height: 2.875 } as const;
/** Label centre above the platform - clear of a figure's head. */
const LABEL_Y = 5.45;

/**
 * Figures stand at the BACK of their pad, towards the wall, so a player can
 * step onto the front of it - where the purchase happens - without standing
 * inside the model.
 */
const FIGURE_SETBACK = 0.8;
/** Pad top, which is where a figure's feet go. */
const PAD_TOP = 0.4;

/** Pad colours: waiting, affordable (the invitation), owned, and equipped. */
const PAD_IDLE = 0xc8281e;
const PAD_AFFORDABLE = 0x22d3ee;
const PAD_OWNED = 0x3a4766;
const PAD_EQUIPPED = 0xf2c14e;

/**
 * A relaxed free-kick stance: feet planted wide, arms loose, chest up - the
 * moment before the run-up. Alternates along the row with the SIU stance so
 * the line of figures reads as a gallery rather than one model stamped nine
 * times.
 */
const FREE_KICK_STANCE: PoseDefinition = {
  Spine1: { x: -0.1 },
  Neck1: { x: -0.06 },
  ArmL1: { x: 0.08, z: 0.3 },
  ArmR1: { x: 0.08, z: -0.3 },
  ArmL2: { x: 0.18 },
  ArmR2: { x: 0.18 },
  LegL1: { z: 0.26 },
  LegR1: { z: -0.26 },
  LegL2: { x: 0.06 },
  LegR2: { x: 0.06 },
};

/** One pedestal's label, kept so it can be redrawn as Wins change. */
interface PedestalLabel {
  readonly tier: BootTier;
  readonly texture: CanvasTexture;
  readonly canvas: HTMLCanvasElement;
}

/** One pedestal: its pad, the node its figure stands on, and the figure. */
interface Pedestal {
  readonly tier: BootTier;
  readonly padMaterial: MeshLambertMaterial;
  readonly stand: Group;
  figure: RonaldoFigure | null;
}

/**
 * The Win Shop: a row of Ronaldo figures on pedestals along the right-hand
 * side of the starting area, one per tier, with a lit sign behind them.
 *
 * Each figure is the very character a player becomes by buying that tier -
 * the same body, painted atlas and hair. A player walks onto the pedestal
 * holding enough Wins, the server takes the Wins, and they are that Ronaldo.
 *
 * Display only. What is owned and equipped is decided by the server; this
 * redraws the labels and pad highlights to match. The figures need the
 * character body, which loads after the world is built, so they arrive
 * through `populateFigures`.
 */
export class BootShop {
  readonly root = new Group();

  private readonly geometries: (BoxGeometry | PlaneGeometry)[] = [];
  private readonly materials: Material[] = [];
  private readonly labels: PedestalLabel[] = [];
  private readonly pedestals: Pedestal[] = [];

  private signTexture: CanvasTexture | null = null;
  private glowTexture: CanvasTexture | null = null;
  private time = 0;

  private lastWins = -1;
  private lastOwned = -1;
  private lastEquipped = -1;

  constructor() {
    this.buildBackdrop();
    this.buildSign();
    this.buildPedestals();
  }

  /**
   * Stand a Ronaldo on every pedestal. Call once the player model has loaded -
   * each figure is cloned from the same body every character uses.
   */
  populateFigures(): void {
    this.pedestals.forEach((pedestal, index) => {
      if (pedestal.figure) return;
      const figure = createRonaldoFigure(pedestal.tier.slot);
      figure.pose(index % 2 === 0 ? SIUUU_ANIM.stancePose : FREE_KICK_STANCE);
      pedestal.stand.add(figure.root);
      pedestal.figure = figure;
    });
  }

  /** Let the figures turn a touch, so they read as characters, not statues. */
  update(delta: number): void {
    this.time += delta;
    for (const pedestal of this.pedestals) {
      const figure = pedestal.figure;
      if (!figure) continue;
      figure.root.rotation.y = Math.sin(this.time * 0.6 + pedestal.tier.slot) * 0.22;
    }
  }

  /** Redraw for the player's Wins, owned tiers and equipped slot. */
  setState(wins: number, ownedMask: number, equippedSlot: number): void {
    if (
      wins === this.lastWins &&
      ownedMask === this.lastOwned &&
      equippedSlot === this.lastEquipped
    ) {
      return;
    }
    this.lastWins = wins;
    this.lastOwned = ownedMask;
    this.lastEquipped = equippedSlot;

    for (const label of this.labels) {
      drawPedestalLabel(label.canvas, label.tier, wins, ownedMask, equippedSlot);
      label.texture.needsUpdate = true;
    }

    for (const pedestal of this.pedestals) {
      const { tier, padMaterial } = pedestal;
      const owned = isBootOwned(ownedMask, tier.slot);
      const affordable = canAffordBoot(tier, wins);
      const equipped = equippedSlot === tier.slot;

      // The pad says what walking onto it would do: gold for the Ronaldo you
      // are, cyan and glowing for one you can become right now, slate for one
      // already bought, red for one still out of reach.
      const color = equipped
        ? PAD_EQUIPPED
        : owned
          ? PAD_OWNED
          : affordable
            ? PAD_AFFORDABLE
            : PAD_IDLE;
      padMaterial.color.setHex(color);
      const glowing = equipped || (affordable && !owned);
      padMaterial.emissive.set(glowing ? new Color(color) : new Color(0x000000));
      padMaterial.emissiveIntensity = glowing ? 0.45 : 0;
    }
  }

  dispose(): void {
    for (const pedestal of this.pedestals) pedestal.figure?.dispose();
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    for (const label of this.labels) label.texture.dispose();
    this.signTexture?.dispose();
    this.glowTexture?.dispose();
  }

  /**
   * The shop's structure, in the same language as the treadmill bay: a wall
   * the height of the spawn walls, capped with the same coping course and
   * ended with the same posts. It also closes the RIGHT side of the starting
   * area - the left and back are walled separately in SpawnArea.
   */
  private buildBackdrop(): void {
    const rowLength = (BOOT_TIERS.length - 1) * BOOT_SHOP.spacingZ;
    const centerZ = BOOT_SHOP.firstZ + rowLength / 2;
    const length = rowLength + 8;
    const height = SHOP_WALL_HEIGHT;

    const geometry = new BoxGeometry(SHOP_WALL_THICKNESS, height, length);
    const material = new MeshLambertMaterial({ color: SHOP_STRUCTURE_COLOR });
    this.geometries.push(geometry);
    this.materials.push(material);

    const wall = new Mesh(geometry, material);
    wall.position.set(BOOT_SHOP.wallX, SPAWN_PLATFORM.topY + height / 2, centerZ);
    wall.receiveShadow = true;
    wall.castShadow = true;
    this.root.add(wall);

    // Coping course, matching the spawn walls.
    const capGeometry = new BoxGeometry(SHOP_WALL_THICKNESS + 0.5, 0.55, length + 0.5);
    const capMaterial = new MeshLambertMaterial({ color: SHOP_COPING_COLOR });
    this.geometries.push(capGeometry);
    this.materials.push(capMaterial);

    const cap = new Mesh(capGeometry, capMaterial);
    cap.position.set(BOOT_SHOP.wallX, SPAWN_PLATFORM.topY + height + 0.275, centerZ);
    this.root.add(cap);

    // End posts, matching the bay's divider posts.
    const postGeometry = new BoxGeometry(
      SHOP_WALL_THICKNESS + 1,
      height + 1.2,
      SHOP_WALL_THICKNESS + 1,
    );
    this.geometries.push(postGeometry);
    for (const end of [-1, 1] as const) {
      const post = new Mesh(postGeometry, capMaterial);
      post.position.set(
        BOOT_SHOP.wallX,
        SPAWN_PLATFORM.topY + (height + 1.2) / 2,
        centerZ + (end * length) / 2,
      );
      post.castShadow = true;
      this.root.add(post);
    }

    // A divider between neighbouring pedestals, as in the treadmill bay.
    const dividerGeometry = new BoxGeometry(0.45, 2.1, 0.45);
    this.geometries.push(dividerGeometry);
    for (let i = 0; i <= BOOT_TIERS.length; i += 1) {
      const z = BOOT_SHOP.firstZ + (i - 0.5) * BOOT_SHOP.spacingZ;
      const divider = new Mesh(dividerGeometry, capMaterial);
      divider.position.set(BOOT_SHOP.x + 1.9, SPAWN_PLATFORM.topY + 1.05, z);
      divider.castShadow = true;
      this.root.add(divider);
    }
  }

  /** The "Win Shop" sign, in the same treatment as the Train Speed banner. */
  private buildSign(): void {
    const rowLength = (BOOT_TIERS.length - 1) * BOOT_SHOP.spacingZ;
    const centerZ = BOOT_SHOP.firstZ + rowLength / 2;

    const panelLength = rowLength * 0.82;
    const panelHeight = panelLength * (SIGN_HEIGHT / SIGN_WIDTH);
    const y = SPAWN_PLATFORM.topY + BOOT_SHOP.signY;

    // Frame: a slab a little larger than the panel, matching the banner's.
    const frameGeometry = new BoxGeometry(
      0.4,
      panelHeight + SIGN_FRAME_MARGIN,
      panelLength + SIGN_FRAME_MARGIN,
    );
    const frameMaterial = createSignFrameMaterial();
    this.geometries.push(frameGeometry);
    this.materials.push(frameMaterial);

    const frameX = BOOT_SHOP.wallX + 1.05;
    const frame = new Mesh(frameGeometry, frameMaterial);
    frame.position.set(frameX, y, centerZ);
    this.root.add(frame);

    // The halo sits BEHIND the frame, between it and the wall, so the frame
    // masks the middle and only the bleed around its edges shows.
    const glow = createSignGlow(
      panelLength + SIGN_FRAME_MARGIN,
      panelHeight + SIGN_FRAME_MARGIN,
    );
    glow.mesh.position.set(frameX - SIGN_GLOW_STANDOFF, y, centerZ);
    // Face +X, into the walkable side, exactly like the panel below.
    glow.mesh.rotation.y = Math.PI / 2;
    this.root.add(glow.mesh);
    this.geometries.push(glow.geometry);
    this.materials.push(glow.material);
    this.glowTexture = glow.texture;

    const texture = new CanvasTexture(
      drawSign('Win Shop', { seal: 'cup', width: SIGN_WIDTH, height: SIGN_HEIGHT }),
    );
    texture.colorSpace = SRGBColorSpace;
    // The sign never changes, so it is not registered for redraws - but its
    // texture still needs disposing.
    this.signTexture = texture;

    const panelGeometry = new PlaneGeometry(panelLength, panelHeight);
    this.geometries.push(panelGeometry);

    const panelMaterial = new MeshBasicMaterial({
      map: texture,
      transparent: true,
      side: DoubleSide,
      depthWrite: false,
      fog: false,
    });
    this.materials.push(panelMaterial);

    const panel = new Mesh(panelGeometry, panelMaterial);
    panel.position.set(BOOT_SHOP.wallX + 1.3, y, centerZ);
    // Face +X, into the walkable side of the platform.
    panel.rotation.y = Math.PI / 2;
    this.root.add(panel);
  }

  private buildPedestals(): void {
    const padGeometry = new BoxGeometry(3.6, PAD_TOP, 3.6);
    const labelGeometry = new PlaneGeometry(LABEL_SIZE.width, LABEL_SIZE.height);
    this.geometries.push(padGeometry, labelGeometry);

    BOOT_TIERS.forEach((tier) => {
      const z = BOOT_SHOP.firstZ + (tier.slot - 1) * BOOT_SHOP.spacingZ;

      // Each pad its own material, so one can glow without lighting the row.
      const padMaterial = new MeshLambertMaterial({ color: WORLD_COLORS.collectionPad });
      this.materials.push(padMaterial);
      const pad = new Mesh(padGeometry, padMaterial);
      pad.position.set(BOOT_SHOP.x, SPAWN_PLATFORM.topY + PAD_TOP / 2, z);
      pad.receiveShadow = true;
      this.root.add(pad);

      // Where the figure will stand, facing +X - out into the plaza.
      const stand = new Group();
      stand.position.set(BOOT_SHOP.x - FIGURE_SETBACK, SPAWN_PLATFORM.topY + PAD_TOP, z);
      stand.rotation.y = Math.PI / 2;
      this.root.add(stand);
      this.pedestals.push({ tier, padMaterial, stand, figure: null });

      const canvas = drawPedestalLabel(createLabelCanvas(), tier, 0, 1, 1);
      const texture = new CanvasTexture(canvas);
      texture.colorSpace = SRGBColorSpace;
      const labelMaterial = new MeshBasicMaterial({
        map: texture,
        transparent: true,
        side: DoubleSide,
        depthWrite: false,
        fog: false,
      });
      this.materials.push(labelMaterial);

      const label = new Mesh(labelGeometry, labelMaterial);
      label.position.set(BOOT_SHOP.x - 0.3, SPAWN_PLATFORM.topY + LABEL_Y, z);
      label.rotation.y = Math.PI / 2;
      this.root.add(label);

      this.labels.push({ tier, texture, canvas });
    });
  }
}

const createLabelCanvas = (): HTMLCanvasElement => {
  const canvas = document.createElement('canvas');
  canvas.width = LABEL_CANVAS.width;
  canvas.height = LABEL_CANVAS.height;
  return canvas;
};

const outlined = (
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  font: string,
  fill: string,
  outline = 9,
): void => {
  ctx.font = font;
  ctx.lineJoin = 'round';
  ctx.lineWidth = outline;
  ctx.strokeStyle = '#121b28';
  ctx.strokeText(text, x, y, LABEL_CANVAS.width - 16);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y, LABEL_CANVAS.width - 16);
};

/**
 * The Ronaldo's name and era, "+N/Step", then EQUIPPED / OWNED / a buy
 * prompt / the Wins still required.
 */
const drawPedestalLabel = (
  canvas: HTMLCanvasElement,
  tier: BootTier,
  wins: number,
  ownedMask: number,
  equippedSlot: number,
): HTMLCanvasElement => {
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const w = canvas.width;
  ctx.clearRect(0, 0, w, canvas.height);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const kit = ronaldoKit(tier.slot);
  outlined(ctx, tier.name, w / 2, 24, `900 30px ${DISPLAY_FONT}`, '#ffd84a', 8);
  outlined(ctx, kit.era.toUpperCase(), w / 2, 56, `900 20px ${DISPLAY_FONT}`, '#c9d6ff', 6);

  const owned = isBootOwned(ownedMask, tier.slot);
  outlined(ctx, `+${tier.speedPerStep}/Step`, w / 2, 104, `900 50px ${DISPLAY_FONT}`, '#ffffff');

  if (equippedSlot === tier.slot) {
    outlined(ctx, 'EQUIPPED', w / 2, 170, `900 42px ${DISPLAY_FONT}`, '#5dff7a');
  } else if (owned) {
    outlined(ctx, 'OWNED', w / 2, 170, `900 42px ${DISPLAY_FONT}`, '#ffd75e');
  } else if (canAffordBoot(tier, wins)) {
    // Affordable but not bought - tell the player the price and to stand on it.
    outlined(
      ctx,
      `WALK OVER: ${formatSpeed(tier.winsRequired)}`,
      w / 2,
      162,
      `900 32px ${DISPLAY_FONT}`,
      '#7dffa8',
    );
    outlined(ctx, 'WINS', w / 2, 204, `900 32px ${DISPLAY_FONT}`, '#c8ffd9', 7);
  } else {
    outlined(
      ctx,
      `${formatSpeed(tier.winsRequired)} Wins`,
      w / 2,
      160,
      `900 38px ${DISPLAY_FONT}`,
      '#ff8f8f',
    );
    outlined(ctx, 'Required', w / 2, 204, `900 30px ${DISPLAY_FONT}`, '#ffbcbc', 7);
  }
  return canvas;
};
