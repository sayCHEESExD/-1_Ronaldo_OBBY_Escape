import { CanvasTexture, RepeatWrapping, SRGBColorSpace, type Texture } from 'three';

/**
 * Canvas-painted art for the football world: stadium hoardings, supporters'
 * flags, the training turf and the pitch-side textures, plus the small
 * football drawings (ball, star, cup) every sign and plaque in the game shares.
 *
 * Everything is drawn at runtime - no image files, so the whole look costs
 * nothing against the 12 MB budget. Each texture is created once and shared.
 */

/** Heavy display face for every sign and board. */
export const DISPLAY_FONT = '"Arial Black", "Segoe UI Black", "Trebuchet MS", system-ui, sans-serif';

const cache = new Map<string, CanvasTexture>();

const make = (
  key: string,
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  repeat = false,
): CanvasTexture => {
  const existing = cache.get(key);
  if (existing) return existing;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx) draw(ctx, width, height);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  if (repeat) {
    texture.wrapS = RepeatWrapping;
    texture.wrapT = RepeatWrapping;
  }
  cache.set(key, texture);
  return texture;
};

export const disposeWorldArt = (): void => {
  for (const texture of cache.values()) texture.dispose();
  cache.clear();
};

/** Deterministic noise for painted surfaces. */
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

// ---------------------------------------------------------------------------
// Football drawings
// ---------------------------------------------------------------------------

/** A five-point star. */
export const drawStar = (
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  color: string,
): void => {
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 10; i += 1) {
    const radius = i % 2 === 0 ? r : r * 0.45;
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
};

/** A classic black-and-white football. */
export const drawFootball = (ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void => {
  const line = Math.max(1.5, r * 0.08);
  const pentagon = (px: number, py: number, pr: number, turn: number): void => {
    ctx.beginPath();
    for (let i = 0; i < 5; i += 1) {
      const angle = turn + (i * Math.PI * 2) / 5;
      const x = px + Math.cos(angle) * pr;
      const y = py + Math.sin(angle) * pr;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
  };

  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.clip();
  ctx.fillStyle = '#15171c';
  ctx.strokeStyle = '#15171c';
  ctx.lineWidth = line;
  pentagon(cx, cy, r * 0.36, -Math.PI / 2);
  for (let i = 0; i < 5; i += 1) {
    const angle = -Math.PI / 2 + (i * Math.PI * 2) / 5;
    const x = cx + Math.cos(angle) * r * 0.95;
    const y = cy + Math.sin(angle) * r * 0.95;
    pentagon(x, y, r * 0.3, angle + Math.PI / 5);
    // Seams from the centre panel out to each outer one.
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * r * 0.36, cy + Math.sin(angle) * r * 0.36);
    ctx.lineTo(x, y);
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = '#15171c';
  ctx.lineWidth = line;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
};

/** A two-handled trophy cup. */
export const drawCup = (
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  color: string,
): void => {
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = r * 0.16;
  // Bowl.
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.62, cy - r * 0.78);
  ctx.lineTo(cx + r * 0.62, cy - r * 0.78);
  ctx.quadraticCurveTo(cx + r * 0.62, cy + r * 0.1, cx, cy + r * 0.22);
  ctx.quadraticCurveTo(cx - r * 0.62, cy + r * 0.1, cx - r * 0.62, cy - r * 0.78);
  ctx.fill();
  // Handles.
  for (const side of [-1, 1] as const) {
    ctx.beginPath();
    ctx.arc(cx + side * r * 0.62, cy - r * 0.42, r * 0.26, -Math.PI / 2, Math.PI / 2, side < 0);
    ctx.stroke();
  }
  // Stem and base.
  ctx.fillRect(cx - r * 0.1, cy + r * 0.2, r * 0.2, r * 0.36);
  ctx.fillRect(cx - r * 0.42, cy + r * 0.56, r * 0.84, r * 0.22);
  ctx.restore();
};

// ---------------------------------------------------------------------------
// Textures
// ---------------------------------------------------------------------------

/** Flag designs, one per atlas column: club and country colours, and his number. */
export const BANNER_DESIGNS = [
  { cloth: '#c8102e', edge: '#0b7a3b', ink: '#f2c14e', text: '7' },
  { cloth: '#ffffff', edge: '#f2c14e', ink: '#c8102e', text: 'CR7' },
  { cloth: '#1f9d55', edge: '#ffffff', ink: '#ffffff', text: 'SIU' },
  { cloth: '#14203a', edge: '#5ce1ff', ink: '#5ce1ff', text: 'GOAT' },
] as const;

/**
 * Supporters' flags, four designs side by side. The flag geometry picks its
 * column through its UVs, so every design shares one material.
 */
export const bannerAtlas = (): Texture =>
  make('banners', 512, 512, (ctx, w, h) => {
    const col = w / BANNER_DESIGNS.length;
    BANNER_DESIGNS.forEach((design, i) => {
      const x = i * col;
      const cx = x + col / 2 + 6;
      ctx.fillStyle = design.cloth;
      ctx.fillRect(x, 0, col, h);
      if (design.text === 'SIU') {
        // Hooped, like the kit it salutes.
        ctx.fillStyle = design.edge;
        for (let y = 130; y < h - 30; y += 70) ctx.fillRect(x + 12, y, col - 12, 24);
      }
      // The pole sleeve, a hem band at the top and one at the foot.
      ctx.fillStyle = design.edge;
      ctx.fillRect(x, 0, col, 30);
      ctx.fillRect(x, 0, 12, h);
      ctx.fillRect(x, h - 22, col, 22);
      drawFootball(ctx, cx, 76, 24);
      ctx.fillStyle = design.ink;
      ctx.strokeStyle = design.cloth === '#ffffff' ? '#15171c' : 'rgba(0,0,0,0.6)';
      ctx.lineJoin = 'round';
      const chars = [...design.text];
      const size = Math.min(col * 0.74, (h - 190) / chars.length);
      ctx.font = `900 ${size}px ${DISPLAY_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = size * 0.12;
      chars.forEach((c, j) => {
        const cy = 128 + size * (j + 0.5);
        ctx.strokeText(c, cx, cy);
        ctx.fillText(c, cx, cy);
      });
      drawStar(ctx, cx, h - 58, 18, design.edge);
    });
  });

/** Messages round the stadium hoardings, one per board. */
const HOARDINGS = [
  { back: '#c8102e', ink: '#ffd84a', text: 'SIUUU!' },
  { back: '#14203a', ink: '#ffffff', text: 'CR7' },
  { back: '#0b7a3b', ink: '#ffffff', text: '+1 SPEED' },
  { back: '#15171c', ink: '#5ce1ff', text: 'GOAL!' },
] as const;

/**
 * A stadium perimeter wall: a white coping band, a row of lit LED advertising
 * boards, then painted concrete down to a pitch-green kick board. One repeat
 * is four boards - `STADIUM_WALL_REPEAT` world units of wall.
 */
export const STADIUM_WALL_REPEAT = 32;

export const stadiumWall = (): Texture =>
  make('stadiumWall', 1024, 256, (ctx, w, h) => {
    const board = w / HOARDINGS.length;
    // Concrete.
    ctx.fillStyle = '#8f98a8';
    ctx.fillRect(0, 0, w, h);
    const r = rng(7);
    for (let i = 0; i < 700; i += 1) {
      ctx.fillStyle = `rgba(40,50,70,${r() * 0.06})`;
      ctx.fillRect(r() * w, r() * h, 2 + r() * 5, 2 + r() * 5);
    }
    // Coping band.
    ctx.fillStyle = '#f4f6fb';
    ctx.fillRect(0, 0, w, 22);
    ctx.fillStyle = '#f2c14e';
    ctx.fillRect(0, 22, w, 5);
    // LED boards.
    HOARDINGS.forEach((ad, i) => {
      const x = i * board;
      ctx.fillStyle = '#0b0e16';
      ctx.fillRect(x, 34, board, 104);
      ctx.fillStyle = ad.back;
      ctx.fillRect(x + 6, 40, board - 12, 92);
      // LED dot grid.
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      for (let gx = x + 8; gx < x + board - 8; gx += 6) {
        for (let gy = 42; gy < 130; gy += 6) ctx.fillRect(gx, gy, 2, 2);
      }
      ctx.fillStyle = ad.ink;
      ctx.font = `900 ${ad.text.length > 5 ? 50 : 62}px ${DISPLAY_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(ad.text, x + board / 2, 88, board - 40);
    });
    // Seams in the concrete, and the kick board along the foot.
    ctx.fillStyle = 'rgba(40,50,70,0.35)';
    for (let x = 0; x < w; x += board / 2) ctx.fillRect(x, 140, 3, h - 180);
    ctx.fillStyle = '#2f8f45';
    ctx.fillRect(0, h - 40, w, 40);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, h - 40, w, 5);
  }, true);

/**
 * A packed grandstand: tiered rows of seats filled with supporters in club
 * colours, with a few flags waving. Painted onto the stand's raked face.
 */
export const crowd = (): Texture =>
  make('crowd', 512, 256, (ctx, w, h) => {
    const rows = 12;
    const rowH = h / rows;
    const r = rng(83);
    const shirts = ['#c8102e', '#ffffff', '#1f9d55', '#ffd400', '#15171c', '#f2c14e', '#da291c', '#1d3f96'];
    for (let row = 0; row < rows; row += 1) {
      const y = row * rowH;
      ctx.fillStyle = row % 2 === 0 ? '#2a3244' : '#323b50';
      ctx.fillRect(0, y, w, rowH);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(0, y + rowH - 3, w, 3);
      for (let x = 2; x < w; x += 9) {
        if (r() < 0.12) continue;
        const shirt = shirts[Math.floor(r() * shirts.length)] as string;
        const bob = r() * 3;
        ctx.fillStyle = shirt;
        ctx.fillRect(x, y + rowH * 0.45 - bob, 7, rowH * 0.5);
        ctx.fillStyle = r() < 0.5 ? '#c98d62' : '#8a5a3c';
        ctx.fillRect(x + 1.5, y + rowH * 0.15 - bob, 4, 5);
        // Arms up for the SIU.
        if (r() < 0.18) {
          ctx.fillStyle = shirt;
          ctx.fillRect(x - 1, y + rowH * 0.05 - bob, 2, 7);
          ctx.fillRect(x + 6, y + rowH * 0.05 - bob, 2, 7);
        }
      }
    }
  }, true);

/**
 * World units covered by one repeat of `pitchGrass`: two mown stripes. The
 * island length (11) is exactly two repeats, so every island shows the same
 * four stripes end to end.
 */
export const PITCH_GRASS_REPEAT = 5.5;

/**
 * Bright, short football-pitch grass: two mown stripes in vivid green with a
 * fine speckle of blades, and nothing else - no strokes, no petals. It is the
 * ground of every island and of the whole starting area.
 *
 * The stripes run along the texture's U axis, so on a box's top face they lie
 * ACROSS the route and a player runs over them the way a camera looks down a
 * pitch. 256 px, drawn at runtime: nothing shipped against the build budget.
 */
export const pitchGrass = (): Texture =>
  make('pitchGrass', 256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#4cc444';
    ctx.fillRect(0, 0, w, h / 2);
    ctx.fillStyle = '#3fb03a';
    ctx.fillRect(0, h / 2, w, h / 2);
    // Short blades: tiny specks, a touch lighter and darker than the stripe,
    // too small to read as anything but texture at play distance.
    const r = rng(97);
    for (let i = 0; i < 2600; i += 1) {
      const light = r() < 0.5;
      ctx.fillStyle = light ? `rgba(160,240,120,${0.18 + r() * 0.2})` : `rgba(20,90,20,${0.14 + r() * 0.18})`;
      ctx.fillRect(Math.floor(r() * w), Math.floor(r() * h), 1, 2);
    }
    // A soft sheen along each stripe's edge, as a mower leaves it.
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(0, 0, w, 3);
    ctx.fillRect(0, h / 2, w, 3);
  }, true);

/** Stylised grass: soft painterly strokes rather than moulded studs. */
export const grass = (base: string, dark: string, light: string, seed = 5): Texture =>
  make(`grass:${base}:${seed}`, 256, 256, (ctx, w, h) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    const r = rng(seed);
    for (let i = 0; i < 140; i += 1) {
      ctx.fillStyle = r() < 0.5 ? dark : light;
      ctx.globalAlpha = 0.35 + r() * 0.3;
      const x = r() * w;
      const y = r() * h;
      ctx.beginPath();
      ctx.ellipse(x, y, 6 + r() * 16, 3 + r() * 6, r() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }, true);

/**
 * Stratified cliff rock with moss ledges. `vertical` turns the strata a
 * quarter, for faces whose U axis runs up the slope rather than along it.
 */
export const cliffRock = (vertical = false): Texture =>
  make(`cliff:${vertical}`, 256, 256, (out, w, h) => {
    const source = document.createElement('canvas');
    source.width = w;
    source.height = h;
    const ctx = source.getContext('2d');
    if (!ctx) return;
    const r = rng(31);
    const bands = 9;
    for (let i = 0; i < bands; i += 1) {
      const shade = 120 + Math.floor(r() * 40);
      ctx.fillStyle = `rgb(${shade + 12},${shade + 2},${shade - 10})`;
      ctx.fillRect(0, (i * h) / bands, w, h / bands + 1);
    }
    ctx.strokeStyle = 'rgba(40,30,25,0.35)';
    ctx.lineWidth = 2;
    for (let i = 0; i < bands; i += 1) {
      const y = (i * h) / bands;
      ctx.beginPath();
      ctx.moveTo(0, y);
      for (let x = 0; x <= w; x += 32) ctx.lineTo(x, y + (r() - 0.5) * 6);
      ctx.stroke();
    }
    for (let i = 0; i < 40; i += 1) {
      ctx.fillStyle = `rgba(90,140,60,${0.25 + r() * 0.35})`;
      ctx.beginPath();
      ctx.ellipse(r() * w, r() * h, 8 + r() * 18, 3 + r() * 5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    if (vertical) {
      out.translate(w / 2, h / 2);
      out.rotate(Math.PI / 2);
      out.drawImage(source, -w / 2, -h / 2);
    } else {
      out.drawImage(source, 0, 0);
    }
  }, true);

/** Flowing river: deep blue with drifting white foam strokes. Scrolled per frame. */
export const riverWater = (): Texture =>
  make('river', 256, 256, (ctx, w, h) => {
    const gradient = ctx.createLinearGradient(0, 0, w, 0);
    gradient.addColorStop(0, '#1f73b8');
    gradient.addColorStop(0.5, '#2f9fd6');
    gradient.addColorStop(1, '#1f73b8');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
    const r = rng(41);
    ctx.strokeStyle = 'rgba(235,250,255,0.6)';
    ctx.lineCap = 'round';
    for (let i = 0; i < 46; i += 1) {
      const x = r() * w;
      const y = r() * h;
      const len = 14 + r() * 40;
      ctx.lineWidth = 1.5 + r() * 2.5;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + (r() - 0.5) * 8, y + len / 2, x, y + len);
      ctx.stroke();
    }
  }, true);

/** Falling water streaks for waterfalls. Scrolled per frame. */
export const waterfallStreaks = (): Texture =>
  make('waterfall', 128, 256, (ctx, w, h) => {
    ctx.fillStyle = 'rgba(120,200,240,0.55)';
    ctx.fillRect(0, 0, w, h);
    const r = rng(53);
    for (let i = 0; i < 60; i += 1) {
      ctx.fillStyle = `rgba(255,255,255,${0.35 + r() * 0.5})`;
      ctx.fillRect(r() * w, r() * h, 2 + r() * 4, 30 + r() * 80);
    }
  }, true);

/** Training turf: two-tone mown stripes with a white touchline down each edge. */
export const turf = (): Texture =>
  make('turf', 128, 256, (ctx, w, h) => {
    const stripe = h / 8;
    for (let i = 0; i < 8; i += 1) {
      ctx.fillStyle = i % 2 === 0 ? '#3f9a45' : '#4bab50';
      ctx.fillRect(0, i * stripe, w, stripe);
    }
    const r = rng(61);
    for (let i = 0; i < 400; i += 1) {
      ctx.fillStyle = `rgba(20,60,20,${r() * 0.18})`;
      ctx.fillRect(r() * w, r() * h, 1.5, 3 + r() * 3);
    }
    ctx.fillStyle = '#f4f6fb';
    ctx.fillRect(4, 0, 6, h);
    ctx.fillRect(w - 10, 0, 6, h);
  }, true);

/**
 * A football pitch seen from above, for the mini pitches beside the route:
 * mown stripes, touchlines, the halfway line, the centre circle and both
 * penalty boxes. Drawn on the long axis (X) of the texture.
 */
export const pitchMarkings = (): Texture =>
  make('pitch', 512, 320, (ctx, w, h) => {
    const stripes = 12;
    for (let i = 0; i < stripes; i += 1) {
      ctx.fillStyle = i % 2 === 0 ? '#3f9a45' : '#4bab50';
      ctx.fillRect((i * w) / stripes, 0, w / stripes + 1, h);
    }
    ctx.strokeStyle = '#f4f6fb';
    ctx.lineWidth = 5;
    const m = 16;
    ctx.strokeRect(m, m, w - m * 2, h - m * 2);
    ctx.beginPath();
    ctx.moveTo(w / 2, m);
    ctx.lineTo(w / 2, h - m);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, h * 0.17, 0, Math.PI * 2);
    ctx.stroke();
    const boxW = w * 0.14;
    const boxH = h * 0.5;
    ctx.strokeRect(m, (h - boxH) / 2, boxW, boxH);
    ctx.strokeRect(w - m - boxW, (h - boxH) / 2, boxW, boxH);
    ctx.fillStyle = '#f4f6fb';
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, 5, 0, Math.PI * 2);
    ctx.fill();
  });
