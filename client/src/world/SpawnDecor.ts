import { BANK_WALL, GORGE_HEAD, SPAWN_PLATFORM, SPAWN_WALLS } from '@obby/shared';
import {
  BoxGeometry,
  CanvasTexture,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  RingGeometry,
  SRGBColorSpace,
  type BufferGeometry,
  type Material,
} from 'three';
import { SIUUU_ANIM } from '../config/animationConfig.js';
import { createRonaldoFigure, type RonaldoFigure } from '../player/ronaldo/RonaldoFigure.js';
import { DISPLAY_FONT, drawFootball, drawStar } from './WorldArt.js';
import {
  MAT,
  banner,
  boulder,
  bunting,
  cornerFlag,
  floodlight,
  football,
  grandstand,
  lampPost,
  spanGoal,
  trophyCup,
} from './WorldProps.js';
import { PropBatch, seededRandom, type Prop } from './PropBatch.js';
import { broadleaf, pineTree } from './Trees.js';

/** The giant goal over the gorge mouth: crossbar height and post offset. */
const GATE_TOP = 21;
const GATE_HALF_SPAN = GORGE_HEAD.mouthHalfWidth + 1.6;
/** How far the goal's net runs back, out over the river. */
const GATE_NET_DEPTH = 7;

/** The golden statue behind the back wall: where it stands and how big. */
const STATUE = { x: -21, zBehindWall: 12, scale: 4.6, plinthHeight: 3 } as const;

/**
 * The stadium around the starting area.
 *
 * The first thing a player sees is a giant goal framing the gorge mouth - the
 * route runs out through it, its net stretched back over the river - with
 * SIUUU! on the scoreboard hung from its crossbar. Behind the back wall a
 * packed grandstand, floodlight towers, a giant trophy and a golden statue of
 * Ronaldo mid-celebration; bunting in club colours strung over the plaza,
 * supporters' flags along the walls and a centre circle painted round the
 * spawn spot.
 *
 * Every piece is placed against a wall, outside the walls or high overhead,
 * so the plaza a player actually runs across is exactly as open as it was.
 * None of it has collision and none of it needs any: the playable bounds are
 * `WorldCollision.clampToBounds`, which this file never touches.
 */
export class SpawnDecor {
  readonly root = new Group();

  private readonly geometries: BufferGeometry[] = [];
  private readonly textures: CanvasTexture[] = [];
  private readonly materials: Material[] = [];
  private statue: RonaldoFigure | null = null;

  constructor() {
    const batch = new PropBatch(1000, true);
    const random = seededRandom(0x5a7);

    this.buildGate(batch);
    this.buildStadium(batch, random);
    this.plantTrees(batch, random);
    this.dressWalls(batch);
    this.buildBunting(batch);
    this.paintPitch();

    batch.build(this.root);
  }

  /**
   * Raise the golden statue. Call once the player model has loaded - it is
   * the very body every player becomes, cast in gold.
   */
  populateStatue(): void {
    if (this.statue) return;
    const gold = new MeshStandardMaterial({
      color: 0xf2c14e,
      metalness: 0.35,
      roughness: 0.38,
      emissive: 0x4a3000,
      emissiveIntensity: 0.35,
    });
    this.materials.push(gold);
    const statue = createRonaldoFigure(9, { material: gold });
    statue.pose(SIUUU_ANIM.stancePose);
    const backZ = SPAWN_PLATFORM.centerZ - SPAWN_PLATFORM.length / 2;
    statue.root.position.set(STATUE.x, SPAWN_PLATFORM.topY + STATUE.plinthHeight, backZ - STATUE.zBehindWall);
    statue.root.scale.setScalar(STATUE.scale);
    this.root.add(statue.root);
    this.statue = statue;
  }

  dispose(): void {
    this.statue?.dispose();
    for (const geometry of this.geometries) geometry.dispose();
    for (const texture of this.textures) texture.dispose();
    for (const material of this.materials) material.dispose();
    this.root.removeFromParent();
  }

  /**
   * The giant goal over the gorge mouth.
   *
   * Its posts stand in the mouth walls, outside the opening, so the route out
   * of the start is exactly as wide as it always was. The net runs back over
   * the river, where nobody runs.
   */
  private buildGate(batch: PropBatch): void {
    const z = GORGE_HEAD.riverStartZ - SPAWN_WALLS.thickness / 2;
    // Turned half round so its net, built along -Z, runs out over the river.
    batch.add(spanGoal(GATE_HALF_SPAN, SPAWN_PLATFORM.topY, GATE_TOP, GATE_NET_DEPTH), {
      x: 0,
      y: 0,
      z,
      rotationY: Math.PI,
    });

    // The scoreboard hung under the crossbar, facing back into the plaza.
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#0b0e16';
      ctx.fillRect(0, 0, 1024, 256);
      ctx.strokeStyle = '#f2c14e';
      ctx.lineWidth = 12;
      ctx.strokeRect(8, 8, 1008, 240);
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      for (let x = 24; x < 1000; x += 12) for (let y = 24; y < 232; y += 12) ctx.fillRect(x, y, 4, 4);
      drawFootball(ctx, 96, 128, 58);
      drawFootball(ctx, 928, 128, 58);
      ctx.font = `900 150px ${DISPLAY_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 16;
      ctx.strokeStyle = '#c8102e';
      ctx.strokeText('SIUUU!', 512, 134);
      ctx.fillStyle = '#ffd84a';
      ctx.fillText('SIUUU!', 512, 134);
    }
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    this.textures.push(texture);
    const material = new MeshBasicMaterial({ map: texture, side: DoubleSide });
    this.materials.push(material);
    const geometry = new PlaneGeometry(13, 13 / 4);
    this.geometries.push(geometry);
    const board = new Mesh(geometry, material);
    board.position.set(0, GATE_TOP - 2.8, z - 0.9);
    board.rotation.y = Math.PI;
    this.root.add(board);

    // Two cables from the crossbar to the board.
    const cable = new CylinderGeometry(0.05, 0.05, 1.3, 4);
    this.geometries.push(cable);
    for (const side of [-1, 1]) {
      const mesh = new Mesh(cable, MAT.ink());
      mesh.position.set(side * 5, GATE_TOP - 0.75, z - 0.9);
      this.root.add(mesh);
    }

    // The title across the crossbar, for anyone looking back from the route.
    this.addBoard('+1 RONALDO OBBY ESCAPE', 'SIUUU!', 0, GATE_TOP + 3.2, z + 0.2, Math.PI, 15);
  }

  /** A grandstand, floodlights, a giant trophy and footballs behind the back wall. */
  private buildStadium(batch: PropBatch, random: () => number): void {
    const backZ = SPAWN_PLATFORM.centerZ - SPAWN_PLATFORM.length / 2;
    const halfWidth = SPAWN_PLATFORM.width / 2;

    batch.add(grandstand(), { x: 12, y: 0, z: backZ - 6 });
    // The statue's plinth; the statue itself arrives with the body.
    batch.add(this.statuePlinth(), { x: STATUE.x, y: 0, z: backZ - STATUE.zBehindWall });
    batch.add(trophyCup(), { x: -33, y: 0, z: backZ - 22, rotationY: 0.3, scale: 1.3 });
    batch.add(football(), { x: -31, y: 0, z: backZ - 5, rotationY: 0.7, scale: 2.2 });
    batch.add(football(), { x: -34, y: 0, z: backZ - 10, rotationY: 2.1, scale: 1.4 });

    // Floodlights over the four corners of the ground, lamps turned inward.
    for (const side of [-1, 1] as const) {
      batch.add(floodlight(), { x: side * (halfWidth + 4), y: 0, z: backZ - 4, rotationY: side * -0.6 });
      batch.add(floodlight(), {
        x: side * (halfWidth + 4),
        y: BANK_WALL.rimY,
        z: GORGE_HEAD.riverStartZ + 4,
        rotationY: Math.PI + side * 0.6,
      });
    }

    for (let i = 0; i < 4; i += 1) {
      batch.add(boulder(21 + i), {
        x: -34 + i * 5 + random() * 3,
        y: 0,
        z: backZ - 28 - random() * 8,
        rotationY: random() * 6,
        scale: 1 + random() * 1.4,
      });
    }
  }

  /** A navy plinth with a CR7 plaque on its face, carrying the statue. */
  private statuePlinth(): Prop {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#14203a';
      ctx.fillRect(0, 0, 512, 256);
      ctx.strokeStyle = '#f2c14e';
      ctx.lineWidth = 10;
      ctx.strokeRect(14, 14, 484, 228);
      ctx.font = `900 132px ${DISPLAY_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#f2c14e';
      ctx.fillText('CR7', 256, 120);
      for (const x of [150, 206, 256, 306, 362]) drawStar(ctx, x, 212, 14, '#f2c14e');
    }
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    this.textures.push(texture);
    const face = new MeshBasicMaterial({ map: texture });
    this.materials.push(face);

    const block = new BoxGeometry(7, STATUE.plinthHeight, 7);
    block.translate(0, STATUE.plinthHeight / 2, 0);
    const plaque = new PlaneGeometry(5, 2.5);
    plaque.translate(0, STATUE.plinthHeight / 2, 3.52);
    this.geometries.push(block, plaque);
    return {
      parts: [
        { geometry: block, material: MAT.navy() },
        { geometry: plaque, material: face },
      ],
      castShadow: true,
    };
  }

  /**
   * Trees everywhere a player's eye lands: grand ones just outside every
   * wall so their crowns rise over it, one in each free front corner, and
   * groves on the rims either side.
   */
  private plantTrees(batch: PropBatch, random: () => number): void {
    const halfWidth = SPAWN_PLATFORM.width / 2;
    const backZ = SPAWN_PLATFORM.centerZ - SPAWN_PLATFORM.length / 2;
    const rim = BANK_WALL.rimY;

    const grand = (x: number, y: number, z: number, seed: number, scale = 1.25): void =>
      batch.add(broadleaf('grand', seed, seed === 202 ? 'leafDeep' : 'leaf'), {
        x,
        y,
        z,
        rotationY: random() * 6,
        scale,
      });

    // Crowns rising over the left wall and the shop side.
    for (const z of [-20, -4, 12, 24]) grand(halfWidth + 5, rim, z, z > 0 ? 101 : 202, 1.35);
    for (const z of [-18, 0, 18]) grand(-(halfWidth + 5), rim, z, z === 0 ? 202 : 101, 1.35);
    // Behind the stands.
    for (const x of [-34, 36]) grand(x, 0, backZ - 16 - random() * 6, x > 0 ? 101 : 202, 1.4);
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
            ? broadleaf(roll < 0.25 ? 'umbrella' : 'garden', roll < 0.4 ? 101 : 202, roll < 0.5 ? 'leaf' : 'leafLight')
            : pineTree(301 + Math.floor(random() * 3));
        batch.add(prop, { x, y: rim, z, rotationY: random() * 6, scale: 1 + random() * 0.7 });
      }
    }
  }

  /** Supporters' flags and pitch-side lamps along the inside of the walls. */
  private dressWalls(batch: PropBatch): void {
    const frontInner = GORGE_HEAD.riverStartZ - SPAWN_WALLS.thickness - 0.9;
    // Flags flank the goal, reading as the approach to it.
    let design = 0;
    for (const x of [15.2, 19.2, 23.2]) {
      for (const side of [-1, 1] as const) {
        batch.add(banner(design % 4), { x: side * x, y: 0, z: frontInner, rotationY: Math.PI });
        design += 1;
      }
    }
    for (const x of [17.2, 21.2]) {
      for (const side of [-1, 1] as const) {
        batch.add(lampPost(), { x: side * x, y: 0, z: frontInner + 0.2, rotationY: Math.PI, scale: 1.1 });
      }
    }
    // Corner flags either side of the goal mouth, as at every corner of a pitch.
    for (const side of [-1, 1] as const) {
      batch.add(cornerFlag(), { x: side * (GATE_HALF_SPAN + 2.6), y: 0, z: frontInner - 1.2, scale: 1.3 });
    }
    // Flags along the left wall behind the scoreboards' far end.
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
   * Bunting in club colours strung across the plaza, well above head
   * height, from the left wall to the shop wall.
   */
  private buildBunting(batch: PropBatch): void {
    const left = SPAWN_WALLS.leftInnerX;
    const right = -25.5;
    const span = left - right;
    const mid = (left + right) / 2;
    // High and shallow: the strings frame the sky above the plaza and never
    // cross the camera's line of sight to the goal or the machines.
    const top = SPAWN_WALLS.height + 7;
    const sag = 1.6;
    for (const z of [-6, 8]) batch.add(bunting(span, sag), { x: mid, y: top, z });
  }

  /**
   * A centre circle painted round the spawn spot and a line out to the goal -
   * the plaza reads as the pitch the whole route kicks off from.
   *
   * Paint, not geometry: flat, a hair above the grass and drawn with a depth
   * offset so the two never fight for the same pixels.
   */
  private paintPitch(): void {
    const paint = new MeshBasicMaterial({
      color: 0xf4f6fb,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    });
    this.materials.push(paint);
    const y = SPAWN_PLATFORM.topY + 0.01;

    const ring = new RingGeometry(5.5, 5.9, 64);
    ring.rotateX(-Math.PI / 2);
    const spot = new RingGeometry(0, 0.45, 20);
    spot.rotateX(-Math.PI / 2);
    const lineStart = 5.9;
    const lineEnd = GORGE_HEAD.riverStartZ - SPAWN_WALLS.thickness - 0.4;
    const line = new PlaneGeometry(0.35, lineEnd - lineStart);
    line.rotateX(-Math.PI / 2);
    line.translate(0, 0, (lineStart + lineEnd) / 2);
    this.geometries.push(ring, spot, line);

    for (const geometry of [ring, spot, line]) {
      const mesh = new Mesh(geometry, paint);
      mesh.position.y = y;
      mesh.receiveShadow = true;
      this.root.add(mesh);
    }
  }

  /** A navy board with a gold frame: the title over a gold subtitle. */
  private addBoard(
    title: string,
    subtitle: string,
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
      ctx.fillStyle = '#14203a';
      ctx.strokeStyle = '#f2c14e';
      ctx.lineWidth = 12;
      ctx.beginPath();
      ctx.roundRect(8, 8, 1008, 204, 18);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = '#f4f6fb';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.roundRect(26, 24, 972, 172, 10);
      ctx.stroke();
      drawFootball(ctx, 74, 110, 32);
      drawFootball(ctx, 950, 110, 32);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.font = `900 64px ${DISPLAY_FONT}`;
      ctx.lineWidth = 12;
      ctx.strokeStyle = '#0b1224';
      ctx.strokeText(title, 512, 82, 780);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(title, 512, 82, 780);
      ctx.font = `900 54px ${DISPLAY_FONT}`;
      ctx.fillStyle = '#ffd84a';
      ctx.fillText(subtitle, 512, 158);
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

    // Two posts carrying it off the crossbar.
    const post = new CylinderGeometry(0.12, 0.12, 2.4, 6);
    this.geometries.push(post);
    for (const side of [-1, 1]) {
      const mesh = new Mesh(post, MAT.white());
      mesh.position.set(x + side * width * 0.38, y - 1.4 - (width * 220) / 1024 / 2 + 1.2, z);
      this.root.add(mesh);
    }
  }
}
