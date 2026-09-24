import { CanvasTexture, SRGBColorSpace } from 'three';

/**
 * The neon halo texture, shared by everything in the world that glows.
 *
 * Extracted the moment a second thing wanted one - the sign frames and the Win
 * pads - so the two cannot drift into looking like different effects. What
 * differs between them is the colour, the shape's aspect and how far the light
 * reaches; the falloff is the same everywhere.
 */

/** Resolution of the texture's longest edge. It is a soft blur; it can be small. */
const DEFAULT_RESOLUTION = 320;

export interface GlowTextureOptions {
  /** Hex colour of the light. */
  readonly color: number;
  /** Size of the PLANE the texture will be mapped onto, in world units. */
  readonly planeWidth: number;
  readonly planeHeight: number;
  /**
   * How far the halo reaches past the lit object, in world units.
   *
   * Given in world units rather than as a fraction so a wide banner and a
   * small pad end up with equally thick light, instead of the halo scaling
   * with whatever it happens to surround.
   */
  readonly spread: number;
  /**
   * Brightness multiplier on the falloff, default 1.
   *
   * Additive light has only the headroom the backdrop leaves it, so the same
   * texture that is emphatic against a dark wall barely registers on a bright
   * island deck. This is the lever for that, rather than authoring a second
   * falloff.
   */
  readonly intensity?: number;
  readonly resolution?: number;
}

/**
 * Draw a soft rounded-rectangle halo.
 *
 * The centre is left SOLID: whatever this sits behind is expected to mask it,
 * so only the bleed around the edges is seen. Three stacked shadow passes
 * rather than one, because a single canvas shadow falls off too fast to have
 * the core-and-bleed shape neon actually has.
 */
export const createGlowTexture = (options: GlowTextureOptions): CanvasTexture => {
  const { color, planeWidth, planeHeight, spread } = options;
  const canvasWidth = options.resolution ?? DEFAULT_RESOLUTION;
  const canvasHeight = Math.max(
    16,
    Math.round(canvasWidth * (planeHeight / Math.max(planeWidth, 1e-6))),
  );

  // The blur margin in PIXELS has to track the world-space spread, or two
  // objects of different sizes would get differently thick halos.
  const margin = (spread / Math.max(planeWidth, 1e-6)) * canvasWidth;

  const canvas = document.createElement('canvas');
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;

  const ctx = canvas.getContext('2d');
  if (ctx) {
    const hex = `#${color.toString(16).padStart(6, '0')}`;
    const innerW = Math.max(1, canvasWidth - margin * 2);
    const innerH = Math.max(1, canvasHeight - margin * 2);
    const radius = Math.min(innerW, innerH) * 0.28;

    const intensity = options.intensity ?? 1;
    ctx.fillStyle = hex;
    ctx.shadowColor = hex;
    for (const [blur, alpha] of [
      [margin * 1.15, 0.34],
      [margin * 0.6, 0.5],
      [margin * 0.28, 0.75],
    ] as const) {
      ctx.globalAlpha = Math.min(1, alpha * intensity);
      ctx.shadowBlur = blur;
      ctx.beginPath();
      ctx.roundRect(margin, margin, innerW, innerH, radius);
      ctx.fill();
    }
  }

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
};
