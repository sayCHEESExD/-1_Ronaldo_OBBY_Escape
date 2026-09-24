import {
  AmbientLight,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Scene,
} from 'three';

import { WORLD_COLORS, WORLD_FOG } from '../config/worldVisuals.js';

const SKY_COLOR = WORLD_COLORS.sky;
const GROUND_BOUNCE = 0x8a6f5a;

/**
 * Owns the Three.js scene graph root and the base lighting rig.
 *
 * The lights are exposed so `SkyAtmosphere` can grade them along the route -
 * warm afternoon at the start, crimson dusk at the end. Their placement and
 * the shadow camera never change.
 */
export class SceneManager {
  readonly scene = new Scene();
  readonly hemi: HemisphereLight;
  readonly ambient: AmbientLight;
  readonly sun: DirectionalLight;

  constructor() {
    this.scene.background = new Color(SKY_COLOR);
    this.scene.fog = new Fog(SKY_COLOR, WORLD_FOG.near, WORLD_FOG.far);

    this.hemi = new HemisphereLight(0xd6e8ff, GROUND_BOUNCE, 1.05);
    this.hemi.position.set(0, 50, 0);
    this.scene.add(this.hemi);

    this.ambient = new AmbientLight(0xffffff, 0.32);
    this.scene.add(this.ambient);

    const sun = new DirectionalLight(0xfff1dc, 2.0);
    sun.position.set(30, 55, 20);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 220;
    sun.shadow.camera.left = -70;
    sun.shadow.camera.right = 70;
    sun.shadow.camera.top = 70;
    sun.shadow.camera.bottom = -70;
    sun.shadow.bias = -0.0008;
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sun = sun;
  }
}
