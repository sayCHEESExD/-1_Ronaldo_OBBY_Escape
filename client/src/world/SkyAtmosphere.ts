import { TROPHY_PLATFORMS } from '@obby/shared';
import {
  BackSide,
  CanvasTexture,
  Color,
  CylinderGeometry,
  Fog,
  Group,
  Mesh,
  MeshBasicMaterial,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  type AmbientLight,
  type DirectionalLight,
  type HemisphereLight,
  type Scene,
} from 'three';
import { WORLD_FOG } from '../config/worldVisuals.js';

/**
 * The anime sky: a gradient dome with a sun (later a crimson moon), painted
 * mountain ranges, drifting cloud banks and a low mist - and the lighting
 * that goes with them.
 *
 * All of it keys off how far down the route the camera is. The first islands
 * sit in a clear spring afternoon; the mountain islands go golden, then misty;
 * the floating shrines at the end burn under a sunset that falls into a
 * starlit night. The world darkens as it gets more epic, which is the whole
 * arc of the route told without a word of UI.
 *
 * Every layer follows the camera's POSITION (never its rotation), so each one
 * behaves as if infinitely far away, and none of it is part of the gameplay
 * world. Fog, the sky and every light are client-side presentation.
 */

interface Keyframe {
  /** Route progress in islands (0 = first island). */
  readonly at: number;
  readonly top: string;
  readonly horizon: string;
  readonly fog: string;
  readonly fogNear: number;
  readonly fogFar: number;
  readonly sun: string;
  readonly sunIntensity: number;
  readonly hemiSky: string;
  readonly hemiGround: string;
  readonly hemiIntensity: number;
  readonly ambient: number;
  readonly disc: string;
  readonly discSize: number;
  readonly farRange: string;
  readonly nearRange: string;
  readonly cloud: string;
  readonly mist: number;
  readonly stars: number;
}

const KEYFRAMES: readonly Keyframe[] = [
  {
    at: 0,
    top: '#3f86e6', horizon: '#ffd8e2', fog: '#f8dbe3', fogNear: WORLD_FOG.near, fogFar: WORLD_FOG.far,
    sun: '#fff1dc', sunIntensity: 2.0, hemiSky: '#d6e8ff', hemiGround: '#8a6f5a', hemiIntensity: 1.05, ambient: 0.32,
    disc: '#fff6d8', discSize: 0.035,
    farRange: '#a9b9dc', nearRange: '#7892be', cloud: '#ffffff', mist: 0.35, stars: 0,
  },
  {
    at: 9,
    top: '#4d86d2', horizon: '#ffd3a0', fog: '#f7d4b2', fogNear: 170, fogFar: 880,
    sun: '#ffe2b4', sunIntensity: 1.95, hemiSky: '#ffe2c4', hemiGround: '#7a5f4a', hemiIntensity: 1.05, ambient: 0.32,
    disc: '#fff0c0', discSize: 0.04,
    farRange: '#b8a8c8', nearRange: '#8a7ea8', cloud: '#fff4e4', mist: 0.4, stars: 0,
  },
  {
    at: 18,
    top: '#6497c2', horizon: '#e4ecec', fog: '#d9e3e3', fogNear: 130, fogFar: 700,
    sun: '#f4f8ff', sunIntensity: 1.75, hemiSky: '#e0eef4', hemiGround: '#5f6a5a', hemiIntensity: 1.1, ambient: 0.36,
    disc: '#ffffff', discSize: 0.03,
    farRange: '#b2c2d0', nearRange: '#7e98aa', cloud: '#f4f8fa', mist: 0.7, stars: 0,
  },
  {
    at: 26,
    top: '#353c88', horizon: '#ff9458', fog: '#e8906e', fogNear: 150, fogFar: 820,
    sun: '#ffb484', sunIntensity: 1.65, hemiSky: '#ffb8a4', hemiGround: '#503040', hemiIntensity: 1.0, ambient: 0.34,
    disc: '#ffd08a', discSize: 0.06,
    farRange: '#7e4c7e', nearRange: '#4c2a4e', cloud: '#ffc0a0', mist: 0.45, stars: 0.05,
  },
  {
    at: 33,
    top: '#171850', horizon: '#c24a6c', fog: '#8c4c72', fogNear: 160, fogFar: 840,
    sun: '#ffa8c0', sunIntensity: 1.35, hemiSky: '#9486d4', hemiGround: '#302040', hemiIntensity: 1.0, ambient: 0.42,
    disc: '#ffb0c0', discSize: 0.07,
    farRange: '#4c305e', nearRange: '#2a1a3a', cloud: '#c890b8', mist: 0.4, stars: 0.55,
  },
  {
    at: 39,
    top: '#080824', horizon: '#5c1a3c', fog: '#3c1a3a', fogNear: 170, fogFar: 860,
    sun: '#d0c0ff', sunIntensity: 1.25, hemiSky: '#7272c4', hemiGround: '#221832', hemiIntensity: 1.0, ambient: 0.5,
    disc: '#ff5a5a', discSize: 0.09,
    farRange: '#2c1a40', nearRange: '#160c24', cloud: '#8a5a9a', mist: 0.35, stars: 1,
  },
];

/** Where the sun (and later the moon) hangs: straight down the gorge. */
const SUN_DIRECTION = new Vector3(0.28, 0.2, 1).normalize();

const CENTERS = TROPHY_PLATFORMS.map((platform) => platform.centerZ);

/** Continuous route progress in islands for a Z position. */
export const routeProgress = (z: number): number => {
  const first = CENTERS[0] ?? 0;
  if (z <= first) return 0;
  for (let i = 0; i < CENTERS.length - 1; i += 1) {
    const a = CENTERS[i] as number;
    const b = CENTERS[i + 1] as number;
    if (z < b) return i + (z - a) / (b - a);
  }
  return CENTERS.length - 1;
};

/** The lights the atmosphere drives. Owned by SceneManager. */
export interface AtmosphereLights {
  readonly hemi: HemisphereLight;
  readonly ambient: AmbientLight;
  readonly sun: DirectionalLight;
}

export class SkyAtmosphere {
  readonly root = new Group();

  /** Colour the ambient petals should take here. Read by SakuraPetals. */
  readonly petalColor = new Color('#ffb8d0');
  /** 0 by day, 1 at night - lantern-lit things may brighten with it. */
  night = 0;

  private readonly dome: Mesh;
  private readonly domeMaterial: ShaderMaterial;
  private readonly far: Mesh;
  private readonly near: Mesh;
  private readonly clouds: Mesh;
  private readonly mist: Mesh;
  private readonly farMaterial: MeshBasicMaterial;
  private readonly nearMaterial: MeshBasicMaterial;
  private readonly cloudMaterial: MeshBasicMaterial;
  private readonly mistMaterial: MeshBasicMaterial;
  private readonly textures: CanvasTexture[] = [];
  private readonly fog: Fog;

  private readonly scratch = {
    top: new Color(),
    horizon: new Color(),
    a: new Color(),
    b: new Color(),
  };

  constructor(
    private readonly scene: Scene,
    private readonly lights: AtmosphereLights,
  ) {
    this.domeMaterial = new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTop: { value: new Color() },
        uHorizon: { value: new Color() },
        uDisc: { value: new Color() },
        uDiscSize: { value: 0.04 },
        uSunDir: { value: SUN_DIRECTION },
        uStars: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uTop;
        uniform vec3 uHorizon;
        uniform vec3 uDisc;
        uniform float uDiscSize;
        uniform vec3 uSunDir;
        uniform float uStars;
        varying vec3 vDir;
        float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453); }
        void main() {
          vec3 dir = normalize(vDir);
          float h = dir.y;
          // Anime skies are saturated overhead and melt into a bright band.
          float t = pow(clamp(h, 0.0, 1.0), 0.55);
          vec3 color = mix(uHorizon, uTop, t);
          // A hot band just above the horizon.
          color += uHorizon * 0.18 * exp(-abs(h) * 14.0);
          if (h < 0.0) color = uHorizon;
          float d = dot(dir, normalize(uSunDir));
          float disc = smoothstep(cos(uDiscSize), cos(uDiscSize * 0.86), d);
          float halo = pow(max(d, 0.0), 22.0) * 0.55 + pow(max(d, 0.0), 4.0) * 0.12;
          color = mix(color, uDisc, disc);
          color += uDisc * halo;
          if (uStars > 0.0 && h > 0.02) {
            vec3 cell = floor(dir * 260.0);
            float star = step(0.9965, hash(cell));
            float twinkle = 0.6 + 0.4 * hash(cell + 7.0);
            color += vec3(star * twinkle * uStars * smoothstep(0.02, 0.3, h));
          }
          gl_FragColor = vec4(color, 1.0);
          #include <colorspace_fragment>
        }
      `,
    });
    this.dome = new Mesh(new SphereGeometry(1250, 32, 16), this.domeMaterial);
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    this.root.add(this.dome);

    this.farMaterial = this.layerMaterial(drawRange(2048, 256, 0x51d, true));
    this.far = this.ring(1150, 420, this.farMaterial, -8);
    this.cloudMaterial = this.layerMaterial(drawClouds(2048, 256));
    this.clouds = this.ring(1050, 520, this.cloudMaterial, -7);
    this.nearMaterial = this.layerMaterial(drawRange(2048, 256, 0x7a3, false));
    this.near = this.ring(950, 300, this.nearMaterial, -6);
    this.mistMaterial = this.layerMaterial(drawMist(512, 128));
    this.mist = this.ring(720, 160, this.mistMaterial, -5);

    this.fog = new Fog(0xffffff, WORLD_FOG.near, WORLD_FOG.far);
    scene.fog = this.fog;
    scene.background = new Color(KEYFRAMES[0]?.horizon ?? '#ffd8e2');
    scene.add(this.root);
    this.apply(0);
  }

  /** Follow the camera and re-grade everything for this point on the route. */
  update(delta: number, camera: Vector3, focusZ: number): void {
    this.root.position.copy(camera);
    // Each band sits at a fixed height relative to the eye.
    this.far.position.y = -150 + 210;
    this.near.position.y = -110 + 150;
    this.clouds.position.y = 170;
    this.mist.position.y = -30;
    this.clouds.rotation.y += delta * 0.0035;
    this.mist.rotation.y -= delta * 0.006;
    this.apply(routeProgress(focusZ));
  }

  dispose(): void {
    this.root.removeFromParent();
    for (const mesh of [this.dome, this.far, this.near, this.clouds, this.mist]) mesh.geometry.dispose();
    for (const material of [this.domeMaterial, this.farMaterial, this.nearMaterial, this.cloudMaterial, this.mistMaterial]) {
      material.dispose();
    }
    for (const texture of this.textures) texture.dispose();
    if (this.scene.fog === this.fog) this.scene.fog = null;
  }

  private layerMaterial(canvas: HTMLCanvasElement): MeshBasicMaterial {
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    this.textures.push(texture);
    return new MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      fog: false,
      side: BackSide,
    });
  }

  private ring(radius: number, height: number, material: MeshBasicMaterial, order: number): Mesh {
    const mesh = new Mesh(new CylinderGeometry(radius, radius, height, 64, 1, true), material);
    mesh.renderOrder = order;
    mesh.frustumCulled = false;
    this.root.add(mesh);
    return mesh;
  }

  private apply(progress: number): void {
    let a = KEYFRAMES[0] as Keyframe;
    let b = a;
    for (let i = 0; i < KEYFRAMES.length - 1; i += 1) {
      const k = KEYFRAMES[i] as Keyframe;
      const n = KEYFRAMES[i + 1] as Keyframe;
      if (progress >= k.at) {
        a = k;
        b = n;
      }
    }
    if (progress >= (KEYFRAMES[KEYFRAMES.length - 1] as Keyframe).at) a = b;
    const span = b.at - a.at;
    const t = span > 0 ? Math.min(1, Math.max(0, (progress - a.at) / span)) : 0;
    const s = t * t * (3 - 2 * t);

    const mix = (key: 'top' | 'horizon' | 'fog' | 'sun' | 'hemiSky' | 'hemiGround' | 'disc' | 'farRange' | 'nearRange' | 'cloud', out: Color): Color =>
      out.set(a[key]).lerp(this.scratch.b.set(b[key]), s);
    const num = (key: 'fogNear' | 'fogFar' | 'sunIntensity' | 'hemiIntensity' | 'ambient' | 'discSize' | 'mist' | 'stars'): number =>
      a[key] + (b[key] - a[key]) * s;

    const uniforms = this.domeMaterial.uniforms;
    mix('top', uniforms.uTop?.value as Color);
    mix('horizon', uniforms.uHorizon?.value as Color);
    mix('disc', uniforms.uDisc?.value as Color);
    if (uniforms.uDiscSize) uniforms.uDiscSize.value = num('discSize');
    const stars = num('stars');
    if (uniforms.uStars) uniforms.uStars.value = stars;

    mix('fog', this.fog.color);
    this.fog.near = num('fogNear');
    this.fog.far = num('fogFar');
    if (this.scene.background instanceof Color) this.scene.background.copy(this.fog.color);

    mix('sun', this.lights.sun.color);
    this.lights.sun.intensity = num('sunIntensity');
    mix('hemiSky', this.lights.hemi.color);
    mix('hemiGround', this.lights.hemi.groundColor);
    this.lights.hemi.intensity = num('hemiIntensity');
    this.lights.ambient.intensity = num('ambient');

    mix('farRange', this.farMaterial.color);
    mix('nearRange', this.nearMaterial.color);
    mix('cloud', this.cloudMaterial.color);
    this.mistMaterial.color.copy(this.fog.color);
    this.mistMaterial.opacity = num('mist');

    this.night = Math.min(1, stars * 1.2);
    // Petals blush pink by day and turn ember-red under the late sky.
    this.petalColor.set('#ffbcd4').lerp(this.scratch.a.set('#ff6a5a'), Math.min(1, progress / 36) ** 2);
  }
}

/** Seeded PRNG for the painted layers. */
const rng = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/**
 * A mountain range silhouette wrapping the full 360 degrees.
 *
 * Painted in greys so the layer's material colour sets the hue: light for
 * snow, mid for the slopes. The far range gets a single great snow-capped
 * cone - an original volcano, not any real mountain's outline. The base
 * fades out so the range dissolves into the horizon haze.
 */
const drawRange = (width: number, height: number, seed: number, far: boolean): HTMLCanvasElement => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const random = rng(seed);
  const ridge: number[] = [];
  const phases = [random() * 6, random() * 6, random() * 6, random() * 6];
  for (let x = 0; x <= width; x += 4) {
    const u = (x / width) * Math.PI * 2;
    let y =
      Math.sin(u * 3 + (phases[0] ?? 0)) * 0.16 +
      Math.sin(u * 7 + (phases[1] ?? 0)) * 0.08 +
      Math.sin(u * 17 + (phases[2] ?? 0)) * 0.04 +
      Math.abs(Math.sin(u * 5 + (phases[3] ?? 0))) * 0.14;
    if (far) {
      // One great cone, off to the left of the route's end.
      const peak = Math.PI * 0.42;
      let du = Math.abs(u - peak);
      du = Math.min(du, Math.PI * 2 - du);
      y = Math.max(y, 0.62 - du * 1.35);
    }
    ridge.push(0.36 + y * (far ? 0.9 : 0.7));
  }
  const toY = (v: number): number => height * (1 - Math.min(0.96, v));

  // Body.
  ctx.fillStyle = far ? '#d6d6d6' : '#bdbdbd';
  ctx.beginPath();
  ctx.moveTo(0, height);
  ridge.forEach((v, i) => ctx.lineTo(i * 4, toY(v)));
  ctx.lineTo(width, height);
  ctx.closePath();
  ctx.fill();

  // Snow caps, only high on the ridges.
  if (far) {
    ctx.save();
    ctx.clip();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ridge.forEach((v, i) => ctx.lineTo(i * 4, toY(Math.max(v - 0.1, 0.6)) + (i % 3) * 2));
    ctx.lineTo(width, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  } else {
    // Stylised pines along the near ridge line.
    ctx.fillStyle = '#9e9e9e';
    for (let i = 0; i < ridge.length; i += 3 + Math.floor(random() * 5)) {
      const x = i * 4;
      const y = toY(ridge[i] ?? 0.4);
      const h = 6 + random() * 10;
      ctx.beginPath();
      ctx.moveTo(x - h * 0.35, y + 2);
      ctx.lineTo(x, y - h);
      ctx.lineTo(x + h * 0.35, y + 2);
      ctx.fill();
    }
  }

  // Fade the base into the horizon haze.
  ctx.globalCompositeOperation = 'destination-out';
  const fade = ctx.createLinearGradient(0, height * 0.55, 0, height);
  fade.addColorStop(0, 'rgba(0,0,0,0)');
  fade.addColorStop(1, 'rgba(0,0,0,0.85)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, width, height);
  return canvas;
};

/** Long anime cloud banks: flat bottoms, billowing tops, soft edges. */
const drawClouds = (width: number, height: number): HTMLCanvasElement => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const random = rng(0xc10d);
  for (let c = 0; c < 22; c += 1) {
    const cx = random() * width;
    const cy = height * (0.35 + random() * 0.4);
    const span = 70 + random() * 160;
    for (const offset of [0, width, -width]) {
      for (let k = 0; k < 9; k += 1) {
        const t = k / 8;
        const x = cx + offset + (t - 0.5) * span * 2;
        const r = span * (0.18 + Math.sin(t * Math.PI) * 0.3) * (0.7 + random() * 0.5);
        const y = cy - Math.sin(t * Math.PI) * r * 0.5;
        const g = ctx.createRadialGradient(x, y, r * 0.2, x, y, r);
        g.addColorStop(0, 'rgba(255,255,255,0.92)');
        g.addColorStop(0.7, 'rgba(255,255,255,0.7)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(x, y, r, r * 0.55, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  return canvas;
};

/** A soft horizontal band of low mist. */
const drawMist = (width: number, height: number): HTMLCanvasElement => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, 'rgba(255,255,255,0)');
  gradient.addColorStop(0.55, 'rgba(255,255,255,0.95)');
  gradient.addColorStop(1, 'rgba(255,255,255,0.5)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  return canvas;
};
