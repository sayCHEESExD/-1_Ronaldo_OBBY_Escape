import {
  BANK_WALL,
  GORGE,
  GORGE_HEAD,
  PLATFORM,
  TROPHY_PLATFORMS,
} from '@obby/shared';
import { Group } from 'three';
import { AREA_THEMES, DEFAULT_AREA_THEME, type RouteStage } from '../config/worldVisuals.js';
import {
  animateWaterfalls,
  banner,
  boulder,
  cornerFlag,
  floatingIslet,
  floodlight,
  football,
  grandstand,
  hangingLamp,
  lampPost,
  miniPitch,
  trophyCup,
  waterfall,
} from './WorldProps.js';
import { PropBatch, seededRandom, type Prop } from './PropBatch.js';
import { broadleaf, pineTree, type CanopyTone, type TreeBuild } from './Trees.js';
import { routeProgress } from './SkyAtmosphere.js';

/**
 * Everything along the route that is not the route: the trees and the
 * football landmarks on the canyon rims - floodlight towers, grandstands,
 * practice pitches, giant footballs and trophies - waterfalls pouring down the
 * cliffs, floating islets beside the islands, and the stadium lamps hung
 * beneath each island.
 *
 * NONE of it enters the playable channel. Trees stand on the rims (|x| >= 33),
 * islets float at |x| ~ 20 - outside the |x| <= 13 channel - and lamps hang
 * UNDER the islands. There are no goals along the river: the one goal on the
 * route is the giant goal over the gorge mouth, in SpawnDecor. The route's
 * collision is untouched because none of this is collision at all.
 *
 * Placement is seeded, so every client sees the identical world; and it is
 * batched into chunked instanced draws, so a 70 km route costs a handful of
 * draws wherever the camera is.
 */

/** Stage for a Z along the route. */
const stageAt = (z: number): RouteStage => {
  const p = routeProgress(z);
  if (p < 9.5) return 'early';
  if (p < 24.5) return 'mid';
  return 'late';
};

/** Tree spacing along the rim per stage: dense parkland, then open mountains. */
const TREE_STEP: Record<RouteStage, number> = { early: 7, mid: 20, late: 36 };

/** Seeds per tree build - distinct silhouettes, few enough to batch well. */
const TREE_SEEDS = [101, 202] as const;
const PINE_SEEDS = [301, 302, 303] as const;

export class RouteDecor {
  readonly root = new Group();
  private time = 0;

  constructor() {
    const batch = new PropBatch(700);
    const random = seededRandom(0x5a4b17a);

    this.plantRims(batch, random);
    this.dressRims(batch, random);
    this.dressIslands(batch, random);
    this.addWaterfalls(batch, random);

    batch.build(this.root);
  }

  /** Waterfalls. The wind itself is ticked by the world. */
  update(delta: number): void {
    this.time += delta;
    animateWaterfalls(delta);
  }

  dispose(): void {
    // Geometry and materials are owned by the prop and tree libraries, which
    // the world disposes once for every user.
    this.root.removeFromParent();
  }

  /** A tree for this stage, from a roll in [0, 1). */
  private tree(stage: RouteStage, roll: number, pick: number): Prop {
    const seed = TREE_SEEDS[pick % TREE_SEEDS.length] as number;
    const pine = PINE_SEEDS[pick % PINE_SEEDS.length] as number;
    const leaf = (build: TreeBuild, tone: CanopyTone): Prop => broadleaf(build, seed, tone);
    switch (stage) {
      case 'early':
        if (roll < 0.14) return leaf('grand', 'leaf');
        if (roll < 0.5) return leaf('garden', pick % 3 === 0 ? 'leafDeep' : 'leaf');
        if (roll < 0.66) return leaf('umbrella', 'leafLight');
        if (roll < 0.78) return leaf('sapling', 'leafLight');
        return pineTree(pine);
      case 'mid':
        if (roll < 0.5) return pineTree(pine);
        if (roll < 0.8) return leaf('garden', 'leafDeep');
        return leaf('sapling', 'leaf');
      case 'late':
        if (roll < 0.4) return leaf(pick % 2 ? 'umbrella' : 'garden', 'autumn');
        if (roll < 0.75) return pineTree(pine);
        return leaf('garden', 'leafDeep');
    }
  }

  /**
   * Forest along both rims, thickest near the rim edge so the canyon is
   * framed by trees, thinning outward. Denser around every island, which is
   * where a player actually stops and looks.
   */
  private plantRims(batch: PropBatch, random: () => number): void {
    const rimTop = BANK_WALL.rimY;
    const rimInner = BANK_WALL.rimX + 1.5;
    const rimSpan = BANK_WALL.rimWidth - 4;

    const plant = (z: number, side: 1 | -1, stage: RouteStage, bias: number): void => {
      const depth = Math.pow(random(), bias) * rimSpan;
      const prop = this.tree(stage, random(), Math.floor(random() * 6));
      batch.add(prop, {
        x: side * (rimInner + depth),
        y: rimTop,
        z,
        rotationY: random() * Math.PI * 2,
        scale: 1.1 + random() * 0.9,
      });
    };

    // A steady line along the whole gorge, behind the spawn and past the end.
    let z = GORGE.startZ;
    while (z < GORGE.horizonZ) {
      const stage = stageAt(z);
      for (const side of [-1, 1] as const) plant(z + random() * 4, side, stage, 1.8);
      z += TREE_STEP[stage] * (0.7 + random() * 0.6);
    }

    // Groves around each island, so every landing is framed.
    for (const platform of TROPHY_PLATFORMS) {
      const stage = stageAt(platform.centerZ);
      for (let i = 0; i < 12; i += 1) {
        const side = i % 2 === 0 ? 1 : -1;
        plant(platform.centerZ + (random() - 0.5) * 120, side, stage, 2.4);
      }
    }
  }

  /** Lamp posts, flags and football landmarks along the rims. */
  private dressRims(batch: PropBatch, random: () => number): void {
    const rimTop = BANK_WALL.rimY;
    const edge = BANK_WALL.rimX + 1.2;

    // Pitch-side lamps and supporters' flags pacing the rim edge, densest
    // early on. The lamps face the river.
    const lampStep: Record<RouteStage, number> = { early: 16, mid: 60, late: 90 };
    let z = GORGE_HEAD.riverStartZ + 6;
    let design = 0;
    while (z < GORGE.horizonZ) {
      const stage = stageAt(z);
      for (const side of [-1, 1] as const) {
        batch.add(lampPost(), { x: side * edge, y: rimTop, z, rotationY: side > 0 ? -Math.PI / 2 : Math.PI / 2 });
      }
      if (stage === 'early' || random() < 0.3) {
        const side = design % 2 === 0 ? 1 : -1;
        batch.add(banner(design % 4), {
          x: side * (edge + 1.6),
          y: rimTop,
          z: z + lampStep[stage] / 2,
          rotationY: side > 0 ? Math.PI : 0,
        });
        design += 1;
      }
      z += lampStep[stage];
    }

    // A landmark on the rim beside every island, alternating sides, all
    // facing the river.
    TROPHY_PLATFORMS.forEach((platform, i) => {
      const stage = stageAt(platform.centerZ);
      const side = i % 2 === 0 ? 1 : -1;
      const x = side * (BANK_WALL.rimX + 16 + random() * 8);
      const z = platform.centerZ + 10 + random() * 20;
      const facing = side > 0 ? -Math.PI / 2 : Math.PI / 2;
      if (i % 3 === 1) {
        batch.add(floodlight(), { x, y: rimTop, z, rotationY: facing + (random() - 0.5) * 0.4 });
        batch.add(trophyCup(), { x: x + side * 8, y: rimTop, z: z + 6, rotationY: random() * 6, scale: 0.9 });
      } else if (i % 3 === 2 || stage === 'late') {
        batch.add(grandstand(), { x: x + side * 6, y: rimTop, z, rotationY: facing, scale: 0.7 });
      } else {
        const pitchX = -side * (BANK_WALL.rimX + 18);
        batch.add(miniPitch(), { x: pitchX, y: rimTop, z: z + 30, rotationY: Math.PI / 2 });
        batch.add(football(), { x: pitchX - side * 3, y: rimTop + 0.1, z: z + 32, rotationY: random() * 6, scale: 0.8 });
        batch.add(football(), { x, y: rimTop, z, rotationY: random() * 6, scale: 2.4 });
      }
      // A couple of boulders so the ground is not a flat lawn.
      for (let b = 0; b < 3; b += 1) {
        batch.add(boulder(11 + b), {
          x: side * (BANK_WALL.rimX + 3 + random() * 26),
          y: rimTop,
          z: platform.centerZ + (random() - 0.5) * 60,
          rotationY: random() * 6,
          scale: 0.8 + random() * 1.6,
        });
      }
    });
  }

  /**
   * Each island's own dressing: stadium lamps hung beneath it, and a
   * floating islet beside it carrying a tree and a corner flag.
   */
  private dressIslands(batch: PropBatch, random: () => number): void {
    TROPHY_PLATFORMS.forEach((platform, i) => {
      const theme = AREA_THEMES[platform.area] ?? DEFAULT_AREA_THEME;
      const stage = theme.stage;

      // No goal per island: the route has ONE, the giant goal over the gorge
      // mouth (SpawnDecor). A frame at every landing made the river a
      // corridor of gates.

      // Stadium lamps hung from the island's underside at each corner.
      const hookY = PLATFORM.topY - PLATFORM.thickness;
      const cornerX = PLATFORM.width / 2 - 1.5;
      for (const x of [-cornerX, cornerX]) {
        for (const dz of [-4.2, 4.2]) {
          batch.add(hangingLamp(), { x, y: hookY, z: platform.centerZ + dz, rotationY: random() * 6 });
        }
      }

      // A floating islet beside every island, alternating sides.
      const side = i % 2 === 0 ? -1 : 1;
      const isletX = side * (21 + random() * 3);
      const isletY = -2 - random() * 5;
      const isletZ = platform.centerZ + (random() - 0.5) * 6;
      batch.add(floatingIslet(), { x: isletX, y: isletY, z: isletZ, rotationY: random() * 6, scale: 0.8 });
      const tree = this.tree(stage, random() * 0.5, i);
      batch.add(tree, { x: isletX, y: isletY, z: isletZ, rotationY: random() * 6, scale: 0.75 });
      if (stage !== 'mid') {
        batch.add(cornerFlag(), { x: isletX - side * 2, y: isletY, z: isletZ + 1.5 });
      }
    });
  }

  /** Waterfalls down the canyon walls through the mountain stretch. */
  private addWaterfalls(batch: PropBatch, random: () => number): void {
    const rise = BANK_WALL.rimY - BANK_WALL.footY;
    const run = BANK_WALL.rimX - BANK_WALL.footX;
    const length = Math.hypot(rise, run);
    // Tilt so the sheet lies down the slope face (see PropBatch's YXZ order).
    const tilt = Math.atan2(run, rise);
    const normalX = rise / length;
    const normalY = run / length;

    TROPHY_PLATFORMS.forEach((platform, i) => {
      const stage = stageAt(platform.centerZ);
      if (stage === 'early' && i < 3) return;
      const falls = stage === 'mid' ? 3 : 1;
      for (let k = 0; k < falls; k += 1) {
        const side = (i + k) % 2 === 0 ? 1 : -1;
        const z = platform.centerZ + (random() - 0.5) * 140;
        batch.add(waterfall(), {
          x: side * (BANK_WALL.rimX - normalX * 0.35),
          y: BANK_WALL.rimY + normalY * 0.35,
          z,
          rotationY: Math.PI / 2,
          tiltX: side * tilt,
          scale: [3 + random() * 4, length, 1],
        });
      }
    });
  }
}
