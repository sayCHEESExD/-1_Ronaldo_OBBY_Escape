/**
 * The house style for a hanging sign: a dark timber board in a gold frame with
 * a red inner rule, carrying a kanji seal and big cream lettering - a shrine
 * signboard, lit from behind by warm lantern light.
 *
 * Extracted so the Train Speed banner and the Win Shop sign are literally the
 * same treatment rather than two drawings that happen to look alike - a second
 * copy is how the two would drift apart the first time either is tweaked.
 */

import {
  AdditiveBlending,
  Color,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  type CanvasTexture,
} from 'three';
import { createGlowTexture } from './GlowTexture.js';
import { DISPLAY_FONT, KANJI_FONT, drawBlossom } from './JapaneseArt.js';

/** Board fill and its gold frame. */
const PANEL_FILL = '#3a2a22';
const PANEL_STROKE = '#f2c14e';

/** Dark timber the surrounding frame mesh is painted. */
export const SIGN_FRAME_COLOR = 0x2a1d17;

/** How far the frame mesh oversails the panel, in world units. */
export const SIGN_FRAME_MARGIN = 0.7;

/** Warm lantern light the sign frames are lit with. */
export const SIGN_GLOW_COLOR = 0xffa24a;

/** How far the halo reaches past the frame, in WORLD units. */
const GLOW_SPREAD = 1.5;

/**
 * How far behind the frame the halo sits.
 *
 * Behind, not in front: the frame is opaque and writes depth, so it occludes
 * the middle of the halo and only the bleed around its edges survives. That is
 * what makes it read as light escaping from behind a solid object rather than
 * a bright rectangle pasted over it.
 */
export const SIGN_GLOW_STANDOFF = 0.3;

/** Everything a caller must dispose when it tears the sign down. */
export interface SignGlow {
  readonly mesh: Mesh;
  readonly geometry: PlaneGeometry;
  readonly material: MeshBasicMaterial;
  readonly texture: CanvasTexture;
}

/**
 * The frame's material: dark blue, lit from within.
 *
 * Shared by both signs so the pair cannot drift apart - the same reason
 * `drawSign` exists. The emissive term is what keeps the frame bright at
 * night-ish angles where a Lambert surface would otherwise go flat, and it is
 * the same colour as the halo so the two read as one light source.
 */
export const createSignFrameMaterial = (): MeshLambertMaterial =>
  new MeshLambertMaterial({
    color: SIGN_FRAME_COLOR,
    emissive: new Color(SIGN_GLOW_COLOR),
    emissiveIntensity: 0.18,
  });

/**
 * A neon halo sized to a sign frame.
 *
 * Deliberately NOT post-processing: a bloom pass would light the whole scene
 * and cost a full-screen render target on exactly the mobile hardware least
 * able to afford it. This is one additive plane per sign - two draws in total
 * - and it needs no light, so it is bright regardless of where the sun is.
 *
 * The mesh faces +Z, like `PlaneGeometry` itself. The caller positions and
 * rotates it to match its own panel, which is the only thing that differs
 * between the two signs.
 *
 * @param frameWidth  the frame mesh's width in world units
 * @param frameHeight the frame mesh's height in world units
 */
export const createSignGlow = (frameWidth: number, frameHeight: number): SignGlow => {
  const planeWidth = frameWidth + GLOW_SPREAD * 2;
  const planeHeight = frameHeight + GLOW_SPREAD * 2;

  const texture = createGlowTexture({
    color: SIGN_GLOW_COLOR,
    planeWidth,
    planeHeight,
    spread: GLOW_SPREAD,
  });

  const geometry = new PlaneGeometry(planeWidth, planeHeight);
  const material = new MeshBasicMaterial({
    map: texture,
    transparent: true,
    // Additive, so the halo BRIGHTENS whatever is behind it instead of
    // painting a washed-out rectangle over the wall.
    blending: AdditiveBlending,
    // Never occludes anything: it is light, not a surface.
    depthWrite: false,
    side: DoubleSide,
    fog: false,
  });

  const mesh = new Mesh(geometry, material);
  // Drawn before ordinary transparent geometry, so the sign panel in front of
  // it composites on top rather than fighting it.
  mesh.renderOrder = -1;

  return { mesh, geometry, material, texture };
};

/**
 * Size of supplied ICON ART, as a multiple of the label's font size.
 *
 * Art is drawn larger than the emoji it replaces: an emoji is a glyph tuned to
 * sit on a text line, whereas a sign icon is read from across a gorge. The
 * emoji path is deliberately left at its own metrics, so a sign with no art
 * looks exactly as it always did.
 */
const ICON_IMAGE_SCALE = 1.5;

export interface SignOptions {
  /**
   * Kanji stamped in a red seal to the left of the label. Takes the icon's
   * slot; the English label is always the readable part.
   */
  readonly kanji?: string;
  /** Emoji shown to the left of the label. Omit for text only. */
  readonly icon?: string;
  /**
   * Art drawn in the icon slot instead of the emoji.
   *
   * Scaled to fit `ICON_IMAGE_SCALE` times the font size, preserving its own
   * aspect ratio - the label is laid out around whatever width that produces,
   * so art and emoji are interchangeable without shifting the text.
   */
  readonly iconImage?: HTMLImageElement | null;
  /** Canvas pixels. Keep the aspect close to the mesh's, or the text stretches. */
  readonly width?: number;
  readonly height?: number;
}

/**
 * Draw a sign onto a fresh canvas.
 *
 * The icon and label are measured and laid out as one group so they stay
 * centred together whatever the label's length - hard-coding an x for each,
 * as the Win Shop sign used to, only centres one particular string.
 */
export const drawSign = (label: string, options: SignOptions = {}): HTMLCanvasElement => {
  const width = options.width ?? 1024;
  const height = options.height ?? 200;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  // Board: dark timber, a gold frame, a red inner rule and wood grain.
  const inset = 8;
  const radius = Math.min(22, height * 0.12);
  const grain = ctx.createLinearGradient(0, 0, 0, height);
  grain.addColorStop(0, '#4a352a');
  grain.addColorStop(0.5, PANEL_FILL);
  grain.addColorStop(1, '#2a1d17');
  ctx.fillStyle = grain;
  ctx.strokeStyle = PANEL_STROKE;
  ctx.lineWidth = Math.max(6, height * 0.05);
  ctx.beginPath();
  ctx.roundRect(inset, inset, width - inset * 2, height - inset * 2, radius);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 2;
  for (let y = inset + 18; y < height - inset; y += 22) {
    ctx.beginPath();
    ctx.moveTo(inset + 20, y);
    ctx.bezierCurveTo(width * 0.3, y + 5, width * 0.7, y - 5, width - inset - 20, y);
    ctx.stroke();
  }
  ctx.strokeStyle = '#c8281e';
  ctx.lineWidth = Math.max(3, height * 0.02);
  ctx.beginPath();
  ctx.roundRect(inset + 14, inset + 12, width - (inset + 14) * 2, height - (inset + 12) * 2, radius * 0.6);
  ctx.stroke();
  drawBlossom(ctx, inset + 38, height / 2, height * 0.1, '#ff9cc0');
  drawBlossom(ctx, width - inset - 38, height / 2, height * 0.1, '#ff9cc0');

  // Text, sized to the panel so a long label still fits.
  const fontSize = height * 0.44;
  const textFont = `900 ${fontSize}px ${DISPLAY_FONT}`;
  const iconFont = `${fontSize * 0.95}px "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
  const gap = fontSize * 0.34;

  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';

  ctx.font = textFont;
  const labelWidth = ctx.measureText(label).width;

  // The kanji seal: a red hanko square with the characters in cream.
  const sealChars = options.kanji ? [...options.kanji] : [];
  const sealSize = height * 0.62;
  if (sealChars.length > 0) {
    const sealWidth = sealSize * (sealChars.length > 1 ? 1.6 : 1);
    const total = sealWidth + gap + labelWidth;
    const x0 = (width - total) / 2;
    const y0 = (height - sealSize) / 2;
    ctx.fillStyle = '#c8281e';
    ctx.strokeStyle = '#fff4e0';
    ctx.lineWidth = Math.max(3, height * 0.02);
    ctx.beginPath();
    ctx.roundRect(x0, y0, sealWidth, sealSize, sealSize * 0.12);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#fff4e0';
    ctx.textAlign = 'center';
    const charSize = sealChars.length > 1 ? sealSize * 0.66 : sealSize * 0.78;
    ctx.font = `900 ${charSize}px ${KANJI_FONT}`;
    sealChars.forEach((c, i) => {
      const cx = x0 + (sealWidth / (sealChars.length + 0)) * (i + 0.5);
      ctx.fillText(c, cx, height / 2 + charSize * 0.04);
    });
    ctx.textAlign = 'left';
    const lx = x0 + sealWidth + gap;
    ctx.font = textFont;
    ctx.lineJoin = 'round';
    ctx.lineWidth = fontSize * 0.19;
    ctx.strokeStyle = 'rgba(20,10,8,0.95)';
    ctx.strokeText(label, lx, height / 2 + fontSize * 0.04);
    ctx.fillStyle = '#fff4e0';
    ctx.fillText(label, lx, height / 2 + fontSize * 0.04);
    return canvas;
  }

  ctx.font = iconFont;
  const emojiWidth = options.icon ? ctx.measureText(options.icon).width : 0;

  // Art carries its OWN layout width. Advancing by the emoji's width instead
  // would let a larger image run under the label and would mis-centre the
  // group, since the centring below is measured from this same number.
  const iconBox = fontSize * ICON_IMAGE_SCALE;
  const iconWidth = options.iconImage ? iconBox : emojiWidth;

  const total = labelWidth + (options.icon ? iconWidth + gap : 0);
  let x = (width - total) / 2;
  const y = height / 2 + fontSize * 0.04;

  if (options.icon) {
    if (options.iconImage) {
      const art = options.iconImage;
      const fit = Math.min(iconBox / art.naturalWidth, iconBox / art.naturalHeight);
      const drawW = art.naturalWidth * fit;
      const drawH = art.naturalHeight * fit;
      ctx.drawImage(art, x + (iconBox - drawW) / 2, y - drawH / 2, drawW, drawH);
    } else {
      ctx.font = iconFont;
      ctx.fillText(options.icon, x, y);
    }
    x += iconWidth + gap;
  }

  ctx.font = textFont;
  ctx.lineJoin = 'round';
  ctx.lineWidth = fontSize * 0.19;
  ctx.strokeStyle = 'rgba(20,10,8,0.95)';
  ctx.strokeText(label, x, y);
  ctx.fillStyle = '#fff4e0';
  ctx.fillText(label, x, y);

  return canvas;
};
