import {
  CanvasTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  SRGBColorSpace,
  type Texture,
} from 'three';
import {
  RONALDO_FACE,
  SHIRT_NAME,
  ronaldoKit,
  type RonaldoKit,
} from '../../config/ronaldoKits.js';

/**
 * Paints a Ronaldo onto the character atlas.
 *
 * The atlas LAYOUT is Bloxity's avatar skin layout - the one every
 * `/avatars/skins/{id}.png` is drawn for, and the one the bundled FBX's own
 * `green.png` shares. It is a 64-unit grid; the rectangles below were read
 * straight out of `player.glb`'s UVs, face by face. UVs are normalised, so the
 * atlas is painted at 8x (512 px) on the same grid: a face gets 64 x 64 pixels
 * instead of 8 x 8, which is what lets it read as a face.
 *
 * Every face is upright in its rectangle except the BACK OF THE HEAD, which
 * the model maps rotated 180 degrees - painted through `rotated`.
 *
 * One canvas per kit, shared read-only by every character wearing it - a room
 * of fifteen starter Ronaldos is one texture. The GLB body samples it with
 * `flipY = false` (glTF convention) and the FBX fallback with three's default
 * `flipY = true`, so each kit carries one texture per body.
 */

/** Pixels per atlas unit. */
const K = 8;
const SIZE = 64 * K;

type Rect = readonly [u0: number, v0: number, u1: number, v1: number];

/**
 * Atlas rectangles, in 64-unit grid coordinates, per part and face.
 *
 * Sides are named from the CHARACTER: `left` is the character's own left,
 * which is +X on the model (and the viewer's right when facing them).
 *   head/torso `left` face:  its left edge is the FRONT of the body
 *   head/torso `right` face: its right edge is the FRONT
 *   top faces:               the rect's top edge is the BACK
 */
const HEAD = {
  front: [1, 20, 9, 28],
  back: [1, 4, 9, 12],
  left: [21, 20, 29, 28],
  right: [11, 20, 19, 28],
  top: [1, 12, 9, 20],
  bottom: [1, 28, 9, 36],
} as const satisfies Record<string, Rect>;

const TORSO = {
  front: [39, 29, 53, 41],
  back: [17, 29, 31, 41],
  left: [53, 29, 61, 41],
  right: [31, 29, 39, 41],
  top: [39, 21, 53, 29],
  bottom: [39, 41, 53, 49],
} as const satisfies Record<string, Rect>;

interface Limb {
  readonly sides: readonly Rect[];
  /** The outward-facing side, for the shorts stripe. */
  readonly outer: Rect;
  readonly top: Rect;
  readonly bottom: Rect;
}

const ARM_L: Limb = {
  sides: [[30, 7, 36, 19], [10, 7, 17, 19], [17, 7, 23, 19], [23, 7, 30, 19]],
  outer: [10, 7, 17, 19],
  top: [30, 0, 36, 7],
  bottom: [30, 19, 36, 26],
};
const ARM_R: Limb = {
  sides: [[57, 8, 63, 20], [50, 8, 57, 20], [44, 8, 50, 20], [37, 8, 44, 20]],
  outer: [50, 8, 57, 20],
  top: [57, 1, 63, 8],
  bottom: [57, 20, 63, 27],
};
const LEG_L: Limb = {
  sides: [[3, 38, 10, 50], [7, 51, 15, 63], [15, 51, 22, 63], [22, 51, 30, 63]],
  outer: [7, 51, 15, 63],
  top: [21, 42, 28, 50],
  bottom: [12, 42, 19, 50],
};
const LEG_R: Limb = {
  sides: [[55, 51, 62, 63], [47, 51, 55, 63], [40, 51, 47, 63], [32, 51, 40, 63]],
  outer: [47, 51, 55, 63],
  top: [55, 43, 62, 51],
  bottom: [30, 42, 37, 50],
};

/** Heavy display face, the same one the world signage uses. */
const FONT = '"Arial Black", "Segoe UI Black", "Trebuchet MS", system-ui, sans-serif';

interface PaintedKit {
  readonly canvas: HTMLCanvasElement;
  /** For Bloxity's GLB body (glTF UVs). */
  readonly glb: CanvasTexture;
  /** For the bundled FBX fallback body (three's default flipped UVs). */
  readonly fbx: CanvasTexture;
}

const painted = new Map<number, PaintedKit>();

/**
 * The atlas texture for a kit slot, on the given body.
 *
 * @param bloxityBody true for Bloxity's GLB body, false for the FBX fallback
 */
export const ronaldoSkin = (slot: number, bloxityBody: boolean): Texture => {
  const kit = ronaldoKit(slot);
  let entry = painted.get(kit.slot);
  if (!entry) {
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d');
    if (ctx) paintKit(ctx, kit);
    entry = { canvas, glb: texture(canvas, false), fbx: texture(canvas, true) };
    painted.set(kit.slot, entry);
  }
  return bloxityBody ? entry.glb : entry.fbx;
};

/** The painted canvas itself, for anything that wants to show a kit flat. */
export const ronaldoSkinCanvas = (slot: number): HTMLCanvasElement => {
  ronaldoSkin(slot, true);
  return (painted.get(ronaldoKit(slot).slot) as PaintedKit).canvas;
};

/** Free every painted kit. Only for a full teardown - characters share them. */
export const disposeRonaldoSkins = (): void => {
  for (const entry of painted.values()) {
    entry.glb.dispose();
    entry.fbx.dispose();
  }
  painted.clear();
};

const texture = (canvas: HTMLCanvasElement, flipY: boolean): CanvasTexture => {
  const map = new CanvasTexture(canvas);
  map.colorSpace = SRGBColorSpace;
  map.flipY = flipY;
  map.magFilter = LinearFilter;
  map.minFilter = LinearMipmapLinearFilter;
  map.generateMipmaps = true;
  map.anisotropy = 4;
  map.needsUpdate = true;
  return map;
};

// ---------------------------------------------------------------------------
// Painting
// ---------------------------------------------------------------------------

/** A grid rect in canvas pixels. */
const px = (rect: Rect): { x: number; y: number; w: number; h: number } => ({
  x: rect[0] * K,
  y: rect[1] * K,
  w: (rect[2] - rect[0]) * K,
  h: (rect[3] - rect[1]) * K,
});

const fill = (ctx: CanvasRenderingContext2D, rect: Rect, color: string): void => {
  const r = px(rect);
  ctx.fillStyle = color;
  ctx.fillRect(r.x, r.y, r.w, r.h);
};

/**
 * Run `draw` inside one face, clipped to it, with the origin at the face's
 * top-left and (w, h) its size in pixels. `rotated` paints a face the model
 * maps upside down (the back of the head) so the drawing lands upright.
 */
const inFace = (
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  draw: (w: number, h: number) => void,
  rotated = false,
): void => {
  const r = px(rect);
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.clip();
  if (rotated) {
    ctx.translate(r.x + r.w, r.y + r.h);
    ctx.rotate(Math.PI);
  } else {
    ctx.translate(r.x, r.y);
  }
  draw(r.w, r.h);
  ctx.restore();
};

/** Deterministic noise, so every client paints the identical kit. */
const noise = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const paintKit = (ctx: CanvasRenderingContext2D, kit: RonaldoKit): void => {
  // Anything the model never samples, in skin - a seam can only ever bleed
  // into a flesh tone, never into a stray colour.
  ctx.fillStyle = RONALDO_FACE.skin;
  ctx.fillRect(0, 0, SIZE, SIZE);

  paintHead(ctx, kit);
  paintTorso(ctx, kit);
  paintArm(ctx, kit, ARM_L);
  paintArm(ctx, kit, ARM_R);
  paintLeg(ctx, kit, LEG_L);
  paintLeg(ctx, kit, LEG_R);
};

// --- head -------------------------------------------------------------------

const paintHead = (ctx: CanvasRenderingContext2D, kit: RonaldoKit): void => {
  const face = RONALDO_FACE;
  for (const rect of Object.values(HEAD)) fill(ctx, rect, face.skin);

  // Crown: all hair.
  fill(ctx, HEAD.top, kit.hair);
  fill(ctx, HEAD.bottom, face.skinShade);

  // Back of the head: hair down to a clean faded line above the neck.
  inFace(
    ctx,
    HEAD.back,
    (w, h) => {
      ctx.fillStyle = kit.hair;
      ctx.fillRect(0, 0, w, h * 0.66);
      ctx.fillStyle = shade(kit.hair, 0.35);
      ctx.fillRect(0, h * 0.66, w, h * 0.08);
    },
    true,
  );

  // Sides: short faded sides under a longer top, an ear, a sideburn.
  for (const [rect, frontOnLeft] of [
    [HEAD.left, true],
    [HEAD.right, false],
  ] as const) {
    inFace(ctx, rect, (w, h) => {
      const toFront = (x: number): number => (frontOnLeft ? x : w - x);
      ctx.fillStyle = kit.hair;
      ctx.fillRect(0, 0, w, h * 0.2);
      ctx.fillStyle = shade(kit.hair, 0.3);
      ctx.fillRect(0, h * 0.2, w, h * 0.16);
      // Sideburn, just behind the front edge.
      const sx = Math.min(toFront(w * 0.18), toFront(w * 0.3));
      ctx.fillRect(sx, h * 0.2, w * 0.12, h * 0.3);
      // Ear.
      const ex = Math.min(toFront(w * 0.44), toFront(w * 0.62));
      ctx.fillStyle = face.skinShade;
      ctx.fillRect(ex, h * 0.4, w * 0.18, h * 0.26);
      ctx.fillStyle = face.skinLight;
      ctx.fillRect(ex + w * 0.04, h * 0.44, w * 0.08, h * 0.16);
      // Jaw shadow.
      ctx.fillStyle = face.skinShade;
      ctx.fillRect(0, h * 0.9, w, h * 0.1);
    });
  }

  inFace(ctx, HEAD.front, (w, h) => paintFace(ctx, kit, w, h));
};

/** The face, on a w x h (64 x 64) canvas region. Confident, mid-celebration. */
const paintFace = (ctx: CanvasRenderingContext2D, kit: RonaldoKit, w: number, h: number): void => {
  const f = RONALDO_FACE;
  const u = w / 64;
  const v = h / 64;
  const box = (x: number, y: number, bw: number, bh: number, color: string): void => {
    ctx.fillStyle = color;
    ctx.fillRect(x * u, y * v, bw * u, bh * v);
  };

  // Soft cheek and jaw shading.
  box(0, 54, 64, 10, f.skinShade);
  box(4, 40, 8, 10, f.skinLight);
  box(52, 40, 8, 10, f.skinLight);

  // Hairline: a sharp, tidy front with the trademark lift in the middle.
  ctx.fillStyle = kit.hair;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(64 * u, 0);
  ctx.lineTo(64 * u, 14 * v);
  ctx.lineTo(56 * u, 11 * v);
  ctx.lineTo(44 * u, 9 * v);
  ctx.lineTo(32 * u, 8 * v);
  ctx.lineTo(20 * u, 9 * v);
  ctx.lineTo(8 * u, 11 * v);
  ctx.lineTo(0, 14 * v);
  ctx.closePath();
  ctx.fill();
  // A lighter streak for shine.
  box(22, 2, 14, 2.5, shade(kit.hair, -0.5));

  // Brows: thick, straight, slightly raised at the outer ends.
  ctx.fillStyle = f.brow;
  for (const [x0, x1, lift] of [
    [10, 27, -1.5],
    [37, 54, 1.5],
  ] as const) {
    ctx.beginPath();
    ctx.moveTo(x0 * u, (22 + (lift < 0 ? lift : 0)) * v);
    ctx.lineTo(x1 * u, (22 + (lift > 0 ? -lift : 0)) * v);
    ctx.lineTo(x1 * u, (26 + (lift > 0 ? -lift * 0.4 : 0)) * v);
    ctx.lineTo(x0 * u, (26 + (lift < 0 ? lift * 0.4 : 0)) * v);
    ctx.closePath();
    ctx.fill();
  }

  // Eyes.
  for (const x of [13, 38]) {
    box(x, 28, 13, 7, f.eyeWhite);
    box(x + (x < 32 ? 6 : 1), 28, 6, 7, f.iris);
    box(x + (x < 32 ? 7 : 2), 29, 2, 2, '#ffffff');
    box(x, 27, 13, 1.4, f.brow);
  }

  // Nose: a shadowed bridge and a base.
  box(30, 32, 4, 10, f.skinShade);
  box(26, 42, 12, 3, f.skinShade);

  // The grin - mouth open, teeth showing: mid-"SIUUU".
  ctx.fillStyle = f.lip;
  ctx.beginPath();
  ctx.moveTo(17 * u, 47 * v);
  ctx.lineTo(47 * u, 47 * v);
  ctx.lineTo(43 * u, 55 * v);
  ctx.lineTo(21 * u, 55 * v);
  ctx.closePath();
  ctx.fill();
  box(20, 48, 24, 5.5, f.mouth);
  box(20, 48, 24, 2.4, f.teeth);

  // Chin dimple.
  box(30, 58, 4, 2, f.skinShade);
};

// --- torso ------------------------------------------------------------------

const paintTorso = (ctx: CanvasRenderingContext2D, kit: RonaldoKit): void => {
  for (const face of ['front', 'back', 'left', 'right'] as const) {
    inFace(ctx, TORSO[face], (w, h) => paintShirt(ctx, kit, w, h, face, face === 'left' || face === 'right'));
  }
  // Shoulders: shirt, with the collar opening in trim.
  inFace(ctx, TORSO.top, (w, h) => {
    ctx.fillStyle = kit.shirt;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = kit.trim;
    ctx.fillRect(w * 0.34, h * 0.2, w * 0.32, h * 0.6);
    ctx.fillStyle = RONALDO_FACE.skinShade;
    ctx.fillRect(w * 0.38, h * 0.28, w * 0.24, h * 0.44);
  });
  fill(ctx, TORSO.bottom, kit.shorts);
};

const paintShirt = (
  ctx: CanvasRenderingContext2D,
  kit: RonaldoKit,
  w: number,
  h: number,
  face: 'front' | 'back' | 'left' | 'right',
  side: boolean,
): void => {
  ctx.fillStyle = kit.shirt;
  ctx.fillRect(0, 0, w, h);
  paintPattern(ctx, kit, w, h, face);

  // Hem: a darker band where the shirt meets the shorts.
  ctx.fillStyle = shade(kit.shirt, 0.18);
  ctx.fillRect(0, h - K * 0.7, w, K * 0.7);

  if (side) {
    // A trim piping down each side seam.
    ctx.fillStyle = kit.trim;
    ctx.fillRect(w / 2 - K * 0.35, 0, K * 0.7, h);
    return;
  }

  if (face === 'front') {
    // V collar in trim.
    ctx.fillStyle = kit.trim;
    ctx.beginPath();
    ctx.moveTo(w * 0.34, 0);
    ctx.lineTo(w * 0.66, 0);
    ctx.lineTo(w * 0.5, h * 0.22);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = RONALDO_FACE.skinShade;
    ctx.beginPath();
    ctx.moveTo(w * 0.39, 0);
    ctx.lineTo(w * 0.61, 0);
    ctx.lineTo(w * 0.5, h * 0.15);
    ctx.closePath();
    ctx.fill();

    // Badge over the heart - the character's left, the viewer's right.
    const bx = w * 0.74;
    const by = h * 0.3;
    const br = w * 0.085;
    ctx.fillStyle = kit.trim;
    ctx.beginPath();
    ctx.moveTo(bx - br, by - br);
    ctx.lineTo(bx + br, by - br);
    ctx.lineTo(bx + br, by + br * 0.3);
    ctx.lineTo(bx, by + br * 1.35);
    ctx.lineTo(bx - br, by + br * 0.3);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = kit.shirtAlt === kit.shirt ? kit.numberEdge : kit.shirtAlt;
    ctx.beginPath();
    ctx.arc(bx, by + br * 0.1, br * 0.5, 0, Math.PI * 2);
    ctx.fill();

    // A small number under the collar, as national kits wear it.
    numberText(ctx, kit, kit.number, w * 0.5, h * 0.56, h * 0.36);
    return;
  }

  // Back: crew-neck trim, the name arched over the big number.
  ctx.fillStyle = kit.trim;
  ctx.fillRect(w * 0.3, 0, w * 0.4, K * 0.8);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `900 ${Math.round(h * 0.15)}px ${FONT}`;
  ctx.lineJoin = 'round';
  ctx.lineWidth = K * 0.45;
  ctx.strokeStyle = kit.numberEdge;
  ctx.strokeText(SHIRT_NAME, w / 2, h * 0.19, w * 0.86);
  ctx.fillStyle = kit.numberFill;
  ctx.fillText(SHIRT_NAME, w / 2, h * 0.19, w * 0.86);
  numberText(ctx, kit, kit.number, w / 2, h * 0.6, h * 0.62);
};

const numberText = (
  ctx: CanvasRenderingContext2D,
  kit: RonaldoKit,
  text: string,
  x: number,
  y: number,
  size: number,
): void => {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `900 ${Math.round(size)}px ${FONT}`;
  ctx.lineJoin = 'round';
  ctx.lineWidth = size * 0.14;
  ctx.strokeStyle = kit.numberEdge;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = kit.numberFill;
  ctx.fillText(text, x, y);
};

/** The shirt's pattern over its base colour. */
const paintPattern = (
  ctx: CanvasRenderingContext2D,
  kit: RonaldoKit,
  w: number,
  h: number,
  face: string,
): void => {
  ctx.fillStyle = kit.shirtAlt;
  switch (kit.shirtPattern) {
    case 'plain': {
      // A faint tonal pinstripe so a plain shirt is not a flat slab.
      ctx.globalAlpha = 0.35;
      for (let x = K; x < w; x += K * 2) ctx.fillRect(x, 0, K * 0.25, h);
      ctx.globalAlpha = 1;
      break;
    }
    case 'hoops': {
      const band = K * 1.5;
      for (let y = band; y < h; y += band * 2) ctx.fillRect(0, y, w, band);
      break;
    }
    case 'stripes': {
      const band = K * 1.4;
      for (let x = 0; x < w; x += band * 2) ctx.fillRect(x, 0, band, h);
      break;
    }
    case 'sash': {
      if (face !== 'front' && face !== 'back') break;
      ctx.beginPath();
      ctx.moveTo(0, h * 0.05);
      ctx.lineTo(w * 0.28, 0);
      ctx.lineTo(w, h * 0.78);
      ctx.lineTo(w, h);
      ctx.lineTo(w * 0.78, h);
      ctx.lineTo(0, h * 0.28);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'galaxy': {
      const random = noise(kit.slot * 97 + face.length);
      const nebula = ctx.createRadialGradient(w * 0.3, h * 0.35, 0, w * 0.3, h * 0.35, w * 0.7);
      nebula.addColorStop(0, 'rgba(160,90,255,0.55)');
      nebula.addColorStop(1, 'rgba(160,90,255,0)');
      ctx.fillStyle = nebula;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = kit.shirtAlt;
      for (let i = 0; i < 40; i += 1) {
        const s = K * (0.15 + random() * 0.35);
        ctx.fillRect(random() * w, random() * h, s, s);
      }
      break;
    }
    case 'gilded': {
      const sheen = ctx.createLinearGradient(0, 0, w, h);
      sheen.addColorStop(0, 'rgba(255,255,255,0.0)');
      sheen.addColorStop(0.45, 'rgba(255,255,255,0.35)');
      sheen.addColorStop(0.55, 'rgba(255,255,255,0.0)');
      ctx.fillStyle = sheen;
      ctx.fillRect(0, 0, w, h);
      const random = noise(kit.slot * 131 + face.length);
      ctx.fillStyle = kit.shirtAlt;
      for (let i = 0; i < 18; i += 1) {
        const x = random() * w;
        const y = random() * h;
        const s = K * (0.2 + random() * 0.3);
        ctx.fillRect(x - s, y - s * 0.2, s * 2, s * 0.4);
        ctx.fillRect(x - s * 0.2, y - s, s * 0.4, s * 2);
      }
      break;
    }
  }
};

// --- limbs ------------------------------------------------------------------

/** Short sleeves over bare arms, a trim cuff between. */
const paintArm = (ctx: CanvasRenderingContext2D, kit: RonaldoKit, arm: Limb): void => {
  for (const rect of arm.sides) {
    inFace(ctx, rect, (w, h) => {
      const sleeve = h * 0.38;
      ctx.fillStyle = kit.sleeve;
      ctx.fillRect(0, 0, w, sleeve);
      if (kit.shirtPattern === 'hoops') {
        ctx.fillStyle = kit.shirtAlt;
        ctx.fillRect(0, sleeve * 0.35, w, sleeve * 0.3);
      }
      ctx.fillStyle = kit.trim;
      ctx.fillRect(0, sleeve, w, K * 0.7);
      // Hands a touch darker than the forearm, so they read at a distance.
      ctx.fillStyle = RONALDO_FACE.skinShade;
      ctx.fillRect(0, h - K * 1.6, w, K * 1.6);
    });
  }
  fill(ctx, arm.top, kit.sleeve);
  fill(ctx, arm.bottom, RONALDO_FACE.skinShade);
};

/** Shorts, a bare knee, the socks and the boots, top to bottom. */
const paintLeg = (ctx: CanvasRenderingContext2D, kit: RonaldoKit, leg: Limb): void => {
  for (const rect of leg.sides) {
    const outer = rect === leg.outer;
    inFace(ctx, rect, (w, h) => {
      const shortsEnd = h * 0.36;
      const sockStart = h * 0.46;
      const bootStart = h * 0.86;

      ctx.fillStyle = kit.shorts;
      ctx.fillRect(0, 0, w, shortsEnd);
      ctx.fillStyle = kit.shortsTrim;
      ctx.fillRect(0, shortsEnd - K * 0.6, w, K * 0.6);
      if (outer) ctx.fillRect(w / 2 - K * 0.45, 0, K * 0.9, shortsEnd);

      ctx.fillStyle = kit.socks;
      ctx.fillRect(0, sockStart, w, bootStart - sockStart);
      ctx.fillStyle = kit.sockBand;
      ctx.fillRect(0, sockStart, w, K * 0.8);
      ctx.fillRect(0, sockStart + K * 1.4, w, K * 0.4);

      ctx.fillStyle = kit.boots;
      ctx.fillRect(0, bootStart, w, h - bootStart);
      ctx.fillStyle = kit.bootTrim;
      ctx.fillRect(0, bootStart + K * 0.35, w, K * 0.35);
      ctx.fillStyle = shade(kit.boots, 0.45);
      ctx.fillRect(0, h - K * 0.35, w, K * 0.35);
    });
  }
  fill(ctx, leg.top, kit.shorts);
  fill(ctx, leg.bottom, shade(kit.boots, 0.5));
};

/** Darken (amount > 0) or lighten (amount < 0) a #rrggbb colour. */
const shade = (hex: string, amount: number): string => {
  const value = Number.parseInt(hex.slice(1), 16);
  const channel = (shift: number): number => {
    const c = (value >> shift) & 0xff;
    const out = amount >= 0 ? c * (1 - amount) : c + (255 - c) * -amount;
    return Math.max(0, Math.min(255, Math.round(out)));
  };
  return `rgb(${channel(16)},${channel(8)},${channel(0)})`;
};
