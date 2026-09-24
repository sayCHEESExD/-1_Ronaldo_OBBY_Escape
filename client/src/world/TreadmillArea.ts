import {
  SPAWN_PLATFORM,
  TREADMILL_BAY,
  TREADMILL_CONSOLE_Z,
  TREADMILL_ROW,
  TREADMILL_DECKS,
  type TreadmillDeck,
} from '@obby/shared';
import {
  BoxGeometry,
  CanvasTexture,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  type BufferGeometry,
  type Material,
  type Texture,
} from 'three';
import { WORLD_COLORS } from '../config/worldVisuals.js';
import { turf } from './WorldArt.js';
import { MAT, hangingLamp } from './WorldProps.js';
import { toon } from './ToonKit.js';
import {
  SIGN_FRAME_MARGIN,
  SIGN_GLOW_STANDOFF,
  createSignFrameMaterial,
  createSignGlow,
  drawSign,
} from './SignPanel.js';

/** Height of the kerb that frames the floor on three sides. */
const KERB_HEIGHT = 0.55;
const KERB_THICKNESS = 0.5;

/** Banner geometry, above the machines and in FRONT of the back wall. */
const BANNER_WIDTH = 26;
const BANNER_HEIGHT = 5;
const BANNER_Y = 9.4;

/**
 * How far in front of the console row the banner hangs.
 *
 * It has to clear the back wall's COPING, which oversails the wall by a
 * quarter on each side and sits at exactly the height the banner spans - that
 * overhang was cutting a grey bar straight across the sign.
 */
const BANNER_STANDOFF = 0.6;

/** Height of the goalpost colonnade's crossbar over the front of the row. */
const COLONNADE_TOP = 7.8;

/**
 * The training ground the treadmills stand in.
 *
 * Purely structural: an inlaid training-turf floor, a concrete kerb framing it
 * on three sides, a colonnade of white goalposts across the front with
 * stadium lamps between them, and the "Train Speed" board over the row. The
 * machines
 * themselves, their tiers, colours and effects are `Treadmills` and are not
 * touched here.
 *
 * The floor is INLAID - its top sits exactly at platform level rather than
 * raised - so the area reads as a dedicated bay without adding a step the
 * movement simulation would have to know about. The machines keep their own
 * 0.2 deck step, which is what the player actually walks onto.
 */
export class TreadmillArea {
  readonly root = new Group();

  private readonly geometries: BufferGeometry[] = [];
  private readonly materials: Material[] = [];
  private texture: CanvasTexture | null = null;
  private glowTexture: CanvasTexture | null = null;
  private floorTexture: Texture | null = null;

  constructor() {
    // The footprint is shared config, so the grass around it is cut from the
    // exact same rectangle and neither surface overlaps the other.
    const frontZ = TREADMILL_BAY.maxZ;
    const backZ = TREADMILL_BAY.minZ;
    const centreX = (TREADMILL_BAY.minX + TREADMILL_BAY.maxX) / 2;
    const width = TREADMILL_BAY.maxX - TREADMILL_BAY.minX;
    const depth = frontZ - backZ;
    const centreZ = (frontZ + backZ) / 2;

    this.buildFloor(centreX, centreZ, width, depth);
    this.buildKerb(centreX, centreZ, width, depth);
    this.buildDividers(frontZ, backZ);
    this.buildBanner(centreX);
  }

  dispose(): void {
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.texture?.dispose();
    this.glowTexture?.dispose();
    this.floorTexture?.dispose();
  }

  /** A training-turf floor inlaid into the spawn grass. Top face at platform level. */
  private buildFloor(x: number, z: number, width: number, depth: number): void {
    const thickness = 0.6;
    const geometry = new BoxGeometry(width, thickness, depth);
    const map = turf().clone();
    map.needsUpdate = true;
    // One lane of turf is 4.8 wide by 9.6 long, touchlines down its sides.
    map.repeat.set(width / 4.8, depth / 9.6);
    this.floorTexture = map;
    const material = toon(0xffffff, { map });
    this.geometries.push(geometry);

    const floor = new Mesh(geometry, material);
    // TOP exactly at platform level - no step, no collision change, and no
    // second surface at the same height now the grass is cut around it.
    floor.position.set(x, SPAWN_PLATFORM.topY - thickness / 2, z);
    floor.receiveShadow = true;
    this.root.add(floor);
  }

  /**
   * A low kerb along the back and both ends.
   *
   * The front is deliberately left open - that is the side players walk in
   * from, and a lip there would be a step into the bay.
   */
  private buildKerb(x: number, z: number, width: number, depth: number): void {
    const material = toon(WORLD_COLORS.concrete);

    const sideGeometry = new BoxGeometry(KERB_THICKNESS, KERB_HEIGHT, depth);
    const backGeometry = new BoxGeometry(width, KERB_HEIGHT, KERB_THICKNESS);
    this.geometries.push(sideGeometry, backGeometry);

    const y = SPAWN_PLATFORM.topY + KERB_HEIGHT / 2;

    for (const side of [-1, 1] as const) {
      const kerb = new Mesh(sideGeometry, material);
      kerb.position.set(x + (side * width) / 2, y, z);
      kerb.castShadow = true;
      this.root.add(kerb);
    }

    const back = new Mesh(backGeometry, material);
    back.position.set(x, y, z - depth / 2);
    back.castShadow = true;
    this.root.add(back);
  }

  /**
   * A post between neighbouring machines, so the row reads as bays.
   *
   * The FRONT posts are white goalposts carrying one long crossbar across
   * the row - a colonnade the player walks under into training - with a
   * stadium lamp hung in each bay. The back posts stay short concrete. Same
   * footprint as the old dividers; like them, purely visual.
   */
  private buildDividers(frontZ: number, backZ: number): void {
    const back = new BoxGeometry(0.45, 2.1, 0.45);
    const pillar = new CylinderGeometry(0.26, 0.26, COLONNADE_TOP, 10);
    const cap = new CylinderGeometry(0.4, 0.4, 0.4, 10);
    this.geometries.push(back, pillar, cap);
    const concrete = toon(WORLD_COLORS.concrete);

    // A post at each end of the row and between every pair of neighbouring
    // decks - so a pair shares a bay divider, and the wider gap between tiers
    // is open floor with its post in the middle of it.
    const half = TREADMILL_ROW.spacingX / 2;
    const xs: number[] = [(TREADMILL_DECKS[0] as TreadmillDeck).x - half];
    for (let i = 0; i < TREADMILL_DECKS.length - 1; i += 1) {
      xs.push(((TREADMILL_DECKS[i] as TreadmillDeck).x + (TREADMILL_DECKS[i + 1] as TreadmillDeck).x) / 2);
    }
    xs.push((TREADMILL_DECKS[TREADMILL_DECKS.length - 1] as TreadmillDeck).x + half);

    const front = frontZ - 0.6;
    for (const x of xs) {
      const post = new Mesh(back, concrete);
      post.position.set(x, SPAWN_PLATFORM.topY + 1.05, backZ + 0.6);
      post.castShadow = true;
      this.root.add(post);

      const column = new Mesh(pillar, MAT.white());
      column.position.set(x, SPAWN_PLATFORM.topY + COLONNADE_TOP / 2, front);
      column.castShadow = true;
      this.root.add(column);
      const foot = new Mesh(cap, MAT.navy());
      foot.position.set(x, SPAWN_PLATFORM.topY + 0.2, front);
      this.root.add(foot);
    }

    // One crossbar over the whole row, with a navy rail under it to hang
    // the lamps from.
    const first = xs[0] ?? 0;
    const last = xs[xs.length - 1] ?? 0;
    const span = last - first;
    const mid = (first + last) / 2;
    const rail = new BoxGeometry(span + 1.2, 0.3, 0.3);
    const crossbar = new CylinderGeometry(0.3, 0.3, span + 1.6, 10);
    crossbar.rotateZ(Math.PI / 2);
    this.geometries.push(rail, crossbar);
    const tie = new Mesh(rail, MAT.navy());
    tie.position.set(mid, SPAWN_PLATFORM.topY + COLONNADE_TOP - 0.9, front);
    this.root.add(tie);
    const top = new Mesh(crossbar, MAT.white());
    top.position.set(mid, SPAWN_PLATFORM.topY + COLONNADE_TOP + 0.1, front);
    top.castShadow = true;
    this.root.add(top);

    // A stadium lamp in every bay, hung from the rail.
    const lamp = hangingLamp();
    for (let i = 0; i < xs.length - 1; i += 1) {
      const x = ((xs[i] as number) + (xs[i + 1] as number)) / 2;
      for (const part of lamp.parts) {
        const mesh = new Mesh(part.geometry, part.material);
        // Hung high enough that every lamp clears the machine labels.
        mesh.position.set(x, SPAWN_PLATFORM.topY + COLONNADE_TOP - 0.9, front);
        mesh.scale.setScalar(0.8);
        this.root.add(mesh);
      }
    }
  }

  /** The "Train Speed" banner over the row, as in the reference. */
  private buildBanner(x: number): void {
    const frameGeometry = new BoxGeometry(
      BANNER_WIDTH + SIGN_FRAME_MARGIN,
      BANNER_HEIGHT + SIGN_FRAME_MARGIN,
      0.4,
    );
    const frameMaterial = createSignFrameMaterial();
    this.geometries.push(frameGeometry);
    this.materials.push(frameMaterial);

    const frameY = SPAWN_PLATFORM.topY + BANNER_Y;
    const frameZ = TREADMILL_CONSOLE_Z + BANNER_STANDOFF;
    const frame = new Mesh(frameGeometry, frameMaterial);
    frame.position.set(x, frameY, frameZ);
    this.root.add(frame);

    // Behind the frame, in the standoff gap the banner already keeps clear of
    // the back wall's coping - so the halo lands on the wall rather than
    // inside it.
    const glow = createSignGlow(
      BANNER_WIDTH + SIGN_FRAME_MARGIN,
      BANNER_HEIGHT + SIGN_FRAME_MARGIN,
    );
    glow.mesh.position.set(x, frameY, frameZ - SIGN_GLOW_STANDOFF);
    this.root.add(glow.mesh);
    this.geometries.push(glow.geometry);
    this.materials.push(glow.material);
    this.glowTexture = glow.texture;

    // A football in the seal; the words stay the readable part.
    const texture = new CanvasTexture(drawSign('Train Speed', { seal: 'ball' }));
    texture.colorSpace = SRGBColorSpace;
    this.texture = texture;

    const panelGeometry = new PlaneGeometry(BANNER_WIDTH, BANNER_HEIGHT);
    const panelMaterial = new MeshBasicMaterial({
      map: texture,
      transparent: true,
      side: DoubleSide,
      depthWrite: false,
      fog: false,
    });
    this.geometries.push(panelGeometry);
    this.materials.push(panelMaterial);

    const panel = new Mesh(panelGeometry, panelMaterial);
    // Faces +Z, into the spawn area, so it reads on approach.
    panel.position.set(x, SPAWN_PLATFORM.topY + BANNER_Y, TREADMILL_CONSOLE_Z + BANNER_STANDOFF + 0.25);
    this.root.add(panel);
  }
}

