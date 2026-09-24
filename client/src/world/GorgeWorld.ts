import { Group, type Scene, type Vector3 } from 'three';
import { logger } from '../util/logger.js';
import { BootShop } from './BootShop.js';
import { WorldCollision } from '@obby/shared';
import { GorgeTerrain } from './GorgeTerrain.js';
import { disposeJapaneseArt } from './JapaneseArt.js';
import { disposeProps } from './JapaneseProps.js';
import { Leaderboards } from './Leaderboards.js';
import { Redlines } from './Redlines.js';
import { RouteDecor } from './RouteDecor.js';
import { disposeTrees } from './SakuraTrees.js';
import { SkyAtmosphere, type AtmosphereLights } from './SkyAtmosphere.js';
import { SpawnArea } from './SpawnArea.js';
import { SpawnDecor } from './SpawnDecor.js';
import { disposeToonKit, tickWind } from './ToonKit.js';
import { TreadmillArea } from './TreadmillArea.js';
import { Treadmills } from './Treadmills.js';
import { WinPads } from './WinPads.js';
import { TrophyPlatforms } from './TrophyPlatforms.js';
import { WorldTextures } from './WorldTextures.js';

const SCOPE = 'GorgeWorld';

/**
 * The gorge: terrain, platforms, hazards, scenery and the collision model.
 *
 * Assembles the visual pieces and exposes the single `collision` object that
 * gameplay queries. Everything is built from the shared gorge config, so the
 * geometry the player collides with cannot drift from what is rendered - and
 * none of the anime scenery (shrines, trees, sky) is collision at all.
 */
export class GorgeWorld {
  readonly root = new Group();
  readonly collision = new WorldCollision();

  private readonly textures = new WorldTextures();
  private readonly terrain: GorgeTerrain;
  private readonly platforms: TrophyPlatforms;
  private readonly spawnArea: SpawnArea;
  private readonly redlines = new Redlines();
  private readonly routeDecor = new RouteDecor();
  private readonly spawnDecor = new SpawnDecor();
  readonly bootShop = new BootShop();
  readonly leaderboards = new Leaderboards();
  readonly treadmills = new Treadmills();
  private readonly treadmillArea = new TreadmillArea();
  readonly winPads: WinPads;
  private atmosphere: SkyAtmosphere | null = null;

  constructor() {
    this.terrain = new GorgeTerrain(this.textures);
    this.platforms = new TrophyPlatforms(this.textures);
    this.spawnArea = new SpawnArea(this.textures);
    this.winPads = new WinPads(this.textures);

    this.root.add(this.terrain.root);
    this.root.add(this.platforms.root);
    this.root.add(this.redlines.root);
    this.root.add(this.routeDecor.root);
    this.root.add(this.spawnDecor.root);
    this.root.add(this.bootShop.root);
    this.root.add(this.leaderboards.root);
    this.root.add(this.treadmillArea.root);
    this.root.add(this.treadmills.root);
    this.root.add(this.winPads.root);
    this.root.add(this.spawnArea.root);
  }

  /** The route's sky, or null before the world is attached. */
  get sky(): SkyAtmosphere | null {
    return this.atmosphere;
  }

  addTo(scene: Scene, lights: AtmosphereLights): void {
    scene.add(this.root);
    this.atmosphere = new SkyAtmosphere(scene, lights);

    let meshes = 0;
    this.root.traverse((child) => {
      if ((child as { isMesh?: boolean }).isMesh) meshes += 1;
    });
    logger.info(SCOPE, `gorge built: ${meshes} meshes`);
  }

  /**
   * Every per-frame world animation: wind, river, lanterns, waterfalls, the
   * shop and training machines, and the sky grading for where the camera is.
   * All of it is client-side presentation.
   */
  update(delta: number, camera: Vector3, focusZ: number): void {
    tickWind(delta);
    this.terrain.update(delta);
    this.routeDecor.update(delta);
    this.bootShop.update(delta);
    this.treadmills.update(delta);
    this.winPads.update(delta);
    this.atmosphere?.update(delta, camera, focusZ);
  }

  dispose(): void {
    this.terrain.dispose();
    this.platforms.dispose();
    this.redlines.dispose();
    this.routeDecor.dispose();
    this.spawnDecor.dispose();
    this.bootShop.dispose();
    this.leaderboards.dispose();
    this.treadmills.dispose();
    this.treadmillArea.dispose();
    this.winPads.dispose();
    this.spawnArea.dispose();
    this.atmosphere?.dispose();
    this.textures.dispose();
    disposeProps();
    disposeTrees();
    disposeJapaneseArt();
    disposeToonKit();
    this.root.removeFromParent();
  }
}
