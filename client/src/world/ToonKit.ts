import {
  Color,
  DataTexture,
  DoubleSide,
  MeshBasicMaterial,
  MeshToonMaterial,
  NearestFilter,
  RedFormat,
  type Material,
  type Texture,
} from 'three';

/**
 * The anime cel-shading kit: one gradient ramp, a material cache and the wind.
 *
 * Every piece of scenery in the Japanese world is lit through the same three
 * step ramp, which is most of what makes a box read as "anime" rather than
 * "low poly". Materials are cached by their parameters, so a thousand stone
 * lanterns share one material and one program.
 *
 * Purely visual. Nothing here knows about collision or gameplay.
 */

/** Shared uniform: seconds of wind, advanced once per frame by `tickWind`. */
const windTime = { value: 0 };

/** Advance the shared wind clock. Called once per frame from the world. */
export const tickWind = (delta: number): void => {
  windTime.value += delta;
};

let ramp: DataTexture | null = null;

/**
 * Three hard bands - shadow, mid, lit - with a slightly lifted shadow so the
 * world stays readable at speed. Nearest filtering keeps the steps crisp.
 */
const toonRamp = (): DataTexture => {
  if (ramp) return ramp;
  const data = new Uint8Array([150, 205, 255]);
  ramp = new DataTexture(data, data.length, 1, RedFormat);
  ramp.minFilter = NearestFilter;
  ramp.magFilter = NearestFilter;
  ramp.generateMipmaps = false;
  ramp.needsUpdate = true;
  return ramp;
};

export interface ToonOptions {
  readonly map?: Texture;
  readonly vertexColors?: boolean;
  readonly emissive?: number;
  readonly emissiveIntensity?: number;
  readonly doubleSide?: boolean;
  /**
   * Wind sway, in world units of bend per unit of height above `swayBase`.
   * Zero (the default) compiles no sway at all.
   */
  readonly sway?: number;
  /** Local height below which a vertex does not move - a trunk's roots. */
  readonly swayBase?: number;
  /**
   * -1 for HANGING cloth: vertices further BELOW `swayBase` move more, so a
   * banner or curtain is pinned along its top edge and flutters at the hem.
   */
  readonly swayDir?: 1 | -1;
}

const cache = new Map<string, Material>();

/** A cached cel-shaded material. Identical requests return the same object. */
export const toon = (color: number, options: ToonOptions = {}): MeshToonMaterial => {
  const key = [
    'toon',
    color,
    options.map?.uuid ?? '',
    options.vertexColors ? 'vc' : '',
    options.emissive ?? '',
    options.emissiveIntensity ?? '',
    options.doubleSide ? 'ds' : '',
    options.sway ?? 0,
    options.swayBase ?? 0,
    options.swayDir ?? 1,
  ].join(':');
  const existing = cache.get(key);
  if (existing) return existing as MeshToonMaterial;

  const material = new MeshToonMaterial({
    color: new Color(color),
    gradientMap: toonRamp(),
    map: options.map ?? null,
    vertexColors: options.vertexColors ?? false,
    side: options.doubleSide ? DoubleSide : undefined,
  });
  if (options.emissive !== undefined) {
    material.emissive = new Color(options.emissive);
    material.emissiveIntensity = options.emissiveIntensity ?? 1;
  }
  if (options.sway) {
    applySway(material, options.sway, options.swayBase ?? 0, options.swayDir ?? 1);
  }
  cache.set(key, material);
  return material;
};

/** A cached unlit material - lantern paper, glowing trim, anything that emits. */
export const glow = (color: number, options: { map?: Texture; doubleSide?: boolean } = {}): MeshBasicMaterial => {
  const key = ['glow', color, options.map?.uuid ?? '', options.doubleSide ? 'ds' : ''].join(':');
  const existing = cache.get(key);
  if (existing) return existing as MeshBasicMaterial;
  const material = new MeshBasicMaterial({
    color: new Color(color),
    map: options.map ?? null,
    side: options.doubleSide ? DoubleSide : undefined,
  });
  cache.set(key, material);
  return material;
};

/** Every cached material, for the world's single dispose pass. */
export const disposeToonKit = (): void => {
  for (const material of cache.values()) material.dispose();
  cache.clear();
  ramp?.dispose();
  ramp = null;
};

/**
 * Bend a material's vertices in a gentle wind.
 *
 * Done in the vertex shader so a whole forest sways for no CPU cost. The phase
 * comes from the object's (or the instance's) world origin, so neighbouring
 * trees move out of step rather than as one rigid sheet. Displacement grows
 * with height above `base`, so roots and pole feet stay planted.
 */
export const applySway = (
  material: Material,
  amount: number,
  base: number,
  direction: 1 | -1 = 1,
): void => {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWindTime = windTime;
    shader.uniforms.uSwayAmount = { value: amount };
    shader.uniforms.uSwayBase = { value: base };
    shader.uniforms.uSwayDir = { value: direction };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float uWindTime;\nuniform float uSwayAmount;\nuniform float uSwayBase;\nuniform float uSwayDir;',
      )
      .replace(
        '#include <begin_vertex>',
        [
          '#include <begin_vertex>',
          '#ifdef USE_INSTANCING',
          '  vec3 swayOrigin = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;',
          '#else',
          '  vec3 swayOrigin = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;',
          '#endif',
          '  float swayH = max((position.y - uSwayBase) * uSwayDir, 0.0);',
          '  float swayPhase = uWindTime * 1.35 + swayOrigin.x * 0.21 + swayOrigin.z * 0.13;',
          '  float swayGust = 0.65 + 0.35 * sin(uWindTime * 0.37 + swayOrigin.z * 0.02);',
          '  transformed.x += sin(swayPhase) * swayH * uSwayAmount * swayGust;',
          '  transformed.z += cos(swayPhase * 0.83) * swayH * uSwayAmount * 0.6 * swayGust;',
        ].join('\n'),
      );
  };
  material.customProgramCacheKey = () => 'anime-sway';
};
