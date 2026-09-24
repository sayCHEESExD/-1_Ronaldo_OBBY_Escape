import { BANK_WALL, GORGE_HEAD, SPAWN_PLATFORM, SPAWN_WALLS } from '@obby/shared';
import {
  CanvasTexture,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  type BufferGeometry,
} from 'three';
import { DISPLAY_FONT, KANJI_FONT, drawBlossom } from './JapaneseArt.js';
import {
  MAT,
  banner,
  bentBox,
  boulder,
  customProp,
  merge,
  pagoda,
  paperLantern,
  shimenawa,
  shrineHall,
  smallShrine,
  spanTorii,
  steppingStone,
  stoneLantern,
  torii,
} from './JapaneseProps.js';
import { PropBatch, at, seededRandom } from './PropBatch.js';
import { bambooStand, blackPine, broadleaf } from './SakuraTrees.js';

/** The great gate over the gorge mouth: lintel height and pillar offset. */
const GATE_TOP = 21;
const GATE_HALF_SPAN = GORGE_HEAD.mouthHalfWidth + 1.6;

/**
 * The shrine grounds around the starting area.
 *
 * The first thing a player sees is a great vermilion torii framing the gorge
 * mouth with 限界突破 - "break the limit" - on its plaque, a five-storey
 * pagoda and a shrine hall rising behind the compound wall, and sakura
 * pouring over every wall. Banners, lanterns strung overhead and a
 * stepping-stone path finish it.
 *
 * Every piece is placed against a wall, outside the compound or high
 * overhead, so the plaza a player actually runs across is exactly as open as
 * it was. None of it has collision and none of it needs any: the playable
 * bounds are `WorldCollision.clampToBounds`, which this file never touches.
 */
export class SpawnDecor {
  readonly root = new Group();

  private readonly geometries: BufferGeometry[] = [];
  private readonly textures: CanvasTexture[] = [];
  private readonly materials: MeshBasicMaterial[] = [];

  constructor() {
    const batch = new PropBatch(1000, true);
    const random = seededRandom(0x5a7);

    this.buildGate(batch);
    this.buildShrineGrounds(batch, random);
    this.plantSakura(batch, random);
    this.dressCompound(batch, random);
    this.buildLanternStrings(batch);
    this.layPath(batch, random);

    batch.build(this.root);
  }

  dispose(): void {
    for (const geometry of this.geometries) geometry.dispose();
    for (const texture of this.textures) texture.dispose();
    for (const material of this.materials) material.dispose();
    this.root.removeFromParent();
  }

  /**
   * The great torii over the gorge mouth.
   *
   * Its pillars stand in the mouth walls, outside the opening, so the route
   * out of the start is exactly as wide as it always was.
   */
  private buildGate(batch: PropBatch): void {
    const z = GORGE_HEAD.riverStartZ - SPAWN_WALLS.thickness / 2;
    batch.add(spanTorii(GATE_HALF_SPAN, SPAWN_PLATFORM.topY, GATE_TOP, false), { x: 0, y: 0, z });
    batch.add(shimenawa(), {
      x: 0,
      y: GATE_TOP - 6.2,
      z: z - 0.3,
      scale: [(GATE_HALF_SPAN * 2) / 9, 1.9, 1.9],
    });

    // The plaque: 限界突破, in gold on black, hung between the two lintels.
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#1b1416';
      ctx.fillRect(0, 0, 160, 512);
      ctx.strokeStyle = '#f2c14e';
      ctx.lineWidth = 10;
      ctx.strokeRect(8, 8, 144, 496);
      ctx.lineWidth = 3;
      ctx.strokeRect(22, 22, 116, 468);
      ctx.fillStyle = '#f2c14e';
      ctx.font = `900 104px ${KANJI_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      [...'限界突破'].forEach((c, i) => ctx.fillText(c, 80, 76 + i * 118));
    }
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    this.textures.push(texture);
    const material = new MeshBasicMaterial({ map: texture, side: DoubleSide });
    this.materials.push(material);
    const geometry = new PlaneGeometry(1.25, 4.0);
    this.geometries.push(geometry);
    const plaque = new Mesh(geometry, material);
    // Between the tie beam and the lintel, facing back into the compound.
    plaque.position.set(0, GATE_TOP - 2.6, z - 1.0);
    plaque.rotation.y = Math.PI;
    this.root.add(plaque);

    // A title board on the outside of the gate, for anyone looking back.
    this.addBoard(
      '+1 SPEED BACKFLIP ESCAPE',
      '速 ・ 飛 ・ 勝',
      0,
      GATE_TOP + 3.2,
      z + 0.2,
      Math.PI,
      15,
    );
  }

  /** A pagoda, a shrine hall and wayside shrines behind the back wall. */
  private buildShrineGrounds(batch: PropBatch, random: () => number): void {
    const backZ = SPAWN_PLATFORM.centerZ - SPAWN_PLATFORM.length / 2;
    batch.add(pagoda(), { x: -8, y: 0, z: backZ - 26, rotationY: 0.2, scale: 1.3 });
    batch.add(shrineHall(), { x: 20, y: 0, z: backZ - 22, rotationY: 0, scale: 1.25 });
    batch.add(torii(), { x: 20, y: 0, z: backZ - 8, scale: 0.9 });
    batch.add(torii(), { x: 20, y: 0, z: backZ - 3.5, scale: 0.8 });
    batch.add(smallShrine(), { x: -26, y: 0, z: backZ - 12, rotationY: 0.4, scale: 1.6 });
    for (const x of [-18, 4, 14, 26]) {
      batch.add(stoneLantern(), { x, y: 0, z: backZ - 6, scale: 1.2 });
    }
    for (let i = 0; i < 5; i += 1) {
      batch.add(bambooStand(401 + (i % 2)), {
        x: -30 + i * 3.5 + random() * 2,
        y: 0,
        z: backZ - 40 - random() * 8,
        rotationY: random() * 6,
      });
    }
    for (let i = 0; i < 4; i += 1) {
      batch.add(boulder(21 + i), {
        x: -20 + i * 13 + random() * 4,
        y: 0,
        z: backZ - 16 - random() * 12,
        rotationY: random() * 6,
        scale: 1 + random() * 1.4,
      });
    }
  }

  /**
   * Sakura everywhere a player's eye lands: grand trees just outside every
   * wall so their crowns pour over it, a tree in each free front corner, and
   * groves on the rims either side.
   */
  private plantSakura(batch: PropBatch, random: () => number): void {
    const halfWidth = SPAWN_PLATFORM.width / 2;
    const backZ = SPAWN_PLATFORM.centerZ - SPAWN_PLATFORM.length / 2;
    const rim = BANK_WALL.rimY;

    const grand = (x: number, y: number, z: number, seed: number, scale = 1.25): void =>
      batch.add(broadleaf('grand', seed, seed === 202 ? 'sakuraDeep' : 'sakura'), {
        x,
        y,
        z,
        rotationY: random() * 6,
        scale,
      });

    // Crowns spilling over the left wall and the shop side.
    for (const z of [-20, -4, 12, 24]) grand(halfWidth + 5, rim, z, z > 0 ? 101 : 202, 1.35);
    for (const z of [-18, 0, 18]) grand(-(halfWidth + 5), rim, z, z === 0 ? 202 : 101, 1.35);
    // Behind the back wall, framing the pagoda.
    for (const x of [-26, 6, 32]) grand(x, 0, backZ - 12 - random() * 6, x > 0 ? 101 : 202, 1.4);
    // Inside the two free front corners, trunks tight against the walls.
    grand(SPAWN_WALLS.leftInnerX - 2.4, 0, 20.5, 101, 1.05);
    grand(-23.5, 0, 20.5, 202, 1.0);

    // Rim groves beyond the walls, both sides, back to the gorge's start.
    for (let z = -76; z < 40; z += 7 + random() * 5) {
      for (const side of [-1, 1] as const) {
        const x = side * (BANK_WALL.rimX + 9 + random() * 22);
        const roll = random();
        const prop =
          roll < 0.6
            ? broadleaf(roll < 0.25 ? 'umbrella' : 'garden', roll < 0.4 ? 101 : 202, roll < 0.5 ? 'sakura' : 'white')
            : blackPine(301 + Math.floor(random() * 3));
        batch.add(prop, { x, y: rim, z, rotationY: random() * 6, scale: 1 + random() * 0.7 });
      }
    }
  }

  /** Banners and stone lanterns along the inside of the front wall. */
  private dressCompound(batch: PropBatch, random: () => number): void {
    void random;
    const frontInner = GORGE_HEAD.riverStartZ - SPAWN_WALLS.thickness - 0.9;
    // Banners flank the gate, reading as the approach to it.
    let design = 0;
    for (const x of [15.2, 19.2, 23.2]) {
      for (const side of [-1, 1] as const) {
        batch.add(banner(design % 4), { x: side * x, y: 0, z: frontInner, rotationY: Math.PI });
        design += 1;
      }
    }
    for (const x of [17.2, 21.2]) {
      for (const side of [-1, 1] as const) {
        batch.add(stoneLantern(), { x: side * x, y: 0, z: frontInner + 0.2, scale: 1.1 });
      }
    }
    // Two lanterns guarding the gate itself, just outside the mouth.
    for (const side of [-1, 1] as const) {
      batch.add(stoneLantern(), { x: side * (GATE_HALF_SPAN + 2.6), y: 0, z: frontInner - 1.2, scale: 1.5 });
    }
    // Banners along the left wall behind the scoreboards' far end.
    for (const z of [-18, 20]) {
      batch.add(banner(2 + (z > 0 ? 1 : 0)), {
        x: SPAWN_WALLS.leftInnerX - 0.9,
        y: 0,
        z,
        rotationY: -Math.PI / 2,
      });
    }
  }

  /**
   * Festival lanterns strung across the plaza, well above head height, from
   * the left wall to the shop wall.
   */
  private buildLanternStrings(batch: PropBatch): void {
    const left = SPAWN_WALLS.leftInnerX;
    const right = -25.5;
    const span = left - right;
    const mid = (left + right) / 2;
    // High and shallow: the strings frame the sky above the plaza and never
    // cross the camera's line of sight to the gate or the machines.
    const top = SPAWN_WALLS.height + 7;
    const sag = 1.6;
    for (const z of [-6, 8]) {
      const rope = merge([[bentBox(span, 0.07, 0.07, sag), at(mid, top - sag, z)]]);
      batch.add(customProp([{ geometry: rope, material: MAT.ink() }]), { x: 0, y: 0, z: 0 });
      for (let x = right + 3.5; x < left - 2; x += 3.5) {
        const t = (x - mid) / (span / 2);
        batch.add(paperLantern(), { x, y: top - sag + sag * t * t, z, rotationY: x });
      }
    }
  }

  /** A stepping-stone path from the spawn point to the great gate. */
  private layPath(batch: PropBatch, random: () => number): void {
    const end = GORGE_HEAD.riverStartZ - SPAWN_WALLS.thickness - 0.6;
    for (let z = 3; z < end; z += 1.9) {
      batch.add(steppingStone(), {
        x: (Math.round(z) % 2 === 0 ? 0.45 : -0.45) + (random() - 0.5) * 0.3,
        y: SPAWN_PLATFORM.topY,
        z,
        rotationY: random() * 6,
        scale: [1.15 + random() * 0.3, 1, 0.95 + random() * 0.25],
      });
    }
  }

  /** A timber board with a gold frame: English title over a kanji line. */
  private addBoard(
    title: string,
    kanji: string,
    x: number,
    y: number,
    z: number,
    rotationY: number,
    width: number,
  ): void {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 220;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#3a2a22';
      ctx.strokeStyle = '#f2c14e';
      ctx.lineWidth = 12;
      ctx.beginPath();
      ctx.roundRect(8, 8, 1008, 204, 18);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = '#c8281e';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.roundRect(26, 24, 972, 172, 10);
      ctx.stroke();
      drawBlossom(ctx, 70, 110, 30, '#ff9cc0');
      drawBlossom(ctx, 954, 110, 30, '#ff9cc0');
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.font = `900 70px ${DISPLAY_FONT}`;
      ctx.lineWidth = 12;
      ctx.strokeStyle = '#1b1416';
      ctx.strokeText(title, 512, 82);
      ctx.fillStyle = '#fff4e0';
      ctx.fillText(title, 512, 82);
      ctx.font = `900 58px ${KANJI_FONT}`;
      ctx.fillStyle = '#ffd36b';
      ctx.fillText(kanji, 512, 160);
    }
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    this.textures.push(texture);
    const material = new MeshBasicMaterial({ map: texture, side: DoubleSide, transparent: true });
    this.materials.push(material);
    const geometry = new PlaneGeometry(width, width * (220 / 1024));
    this.geometries.push(geometry);
    const board = new Mesh(geometry, material);
    board.position.set(x, y, z);
    board.rotation.y = rotationY;
    this.root.add(board);

    // Two posts carrying it.
    const post = new CylinderGeometry(0.12, 0.12, 2.4, 6);
    this.geometries.push(post);
    for (const side of [-1, 1]) {
      const mesh = new Mesh(post, MAT.ink());
      mesh.position.set(x + side * width * 0.38, y - 1.4 - (width * 220) / 1024 / 2 + 1.2, z);
      this.root.add(mesh);
    }
  }
}
