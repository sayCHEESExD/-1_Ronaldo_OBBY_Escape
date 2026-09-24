import { CanvasTexture, RepeatWrapping, SRGBColorSpace, type Texture } from 'three';

/**
 * Canvas-painted art for the Japanese world: lantern paper, banner cloth,
 * wall plaster, roof tiles, wood planks, flagstones and lacquer.
 *
 * Everything is drawn at runtime - no image files, so the whole look costs
 * nothing against the 12 MB budget. Each texture is created once and shared.
 * Lettering uses the system's Mincho / Gothic faces, which every desktop and
 * mobile OS ships with Japanese coverage.
 */

/** Brush-like serif for kanji. Every major OS ships one of these. */
export const KANJI_FONT =
  '"Yu Mincho", "YuMincho", "Hiragino Mincho ProN", "Noto Serif JP", "Noto Serif CJK JP", "MS Mincho", serif';

/** Heavy display face for the English that must stay readable. */
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

export const disposeJapaneseArt = (): void => {
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

/** A glowing red paper lantern: ribs, black bands and a kanji. */
export const lanternPaper = (kanji = '祭'): Texture =>
  make(`lantern:${kanji}`, 256, 128, (ctx, w, h) => {
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, '#ff8a3d');
    gradient.addColorStop(0.5, '#ffd27a');
    gradient.addColorStop(1, '#ff7a33');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
    // Red wash, brightest where the flame sits.
    ctx.fillStyle = 'rgba(214,40,30,0.55)';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(120,20,10,0.35)';
    ctx.lineWidth = 2;
    for (let y = 8; y < h; y += 11) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    ctx.fillStyle = '#1b1416';
    ctx.fillRect(0, 0, w, 7);
    ctx.fillRect(0, h - 7, w, 7);
    ctx.font = `900 ${h * 0.56}px ${KANJI_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#1b1416';
    for (const x of [w * 0.25, w * 0.75]) ctx.fillText(kanji, x, h / 2 + 3);
  });

/** Banner designs, one per atlas column. Vertical kanji on coloured cloth. */
export const BANNER_DESIGNS = [
  { cloth: '#d8322a', edge: '#ffffff', ink: '#ffffff', text: '速' },
  { cloth: '#fff4e0', edge: '#d8322a', ink: '#c8281e', text: '勝利' },
  { cloth: '#23304f', edge: '#f2c14e', ink: '#fff4e0', text: '修行' },
  { cloth: '#ff9cc0', edge: '#1b1416', ink: '#1b1416', text: '挑戦' },
] as const;

/**
 * Nobori banners, four designs side by side. The banner geometry picks its
 * column through its UVs, so every design shares one material.
 */
export const bannerAtlas = (): Texture =>
  make('banners', 512, 512, (ctx, w, h) => {
    const col = w / BANNER_DESIGNS.length;
    BANNER_DESIGNS.forEach((design, i) => {
      const x = i * col;
      ctx.fillStyle = design.cloth;
      ctx.fillRect(x, 0, col, h);
      // The chichi loops down the pole side, and a hem band at the top.
      ctx.fillStyle = design.edge;
      ctx.fillRect(x, 0, col, 34);
      ctx.fillRect(x, 0, 10, h);
      ctx.fillStyle = design.cloth;
      for (let y = 46; y < h; y += 46) ctx.fillRect(x + 2, y, 6, 12);
      // A sakura crest under the hem.
      drawBlossom(ctx, x + col / 2 + 4, 70, 18, design.edge);
      ctx.fillStyle = design.ink;
      const chars = [...design.text];
      const size = Math.min(col * 0.72, (h - 130) / chars.length);
      ctx.font = `900 ${size}px ${KANJI_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      chars.forEach((c, j) => ctx.fillText(c, x + col / 2 + 4, 120 + size * (j + 0.5)));
    });
  });

/** A five-petal sakura blossom. */
export const drawBlossom = (
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  color: string,
): void => {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = color;
  for (let i = 0; i < 5; i += 1) {
    ctx.rotate((Math.PI * 2) / 5);
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.55, r * 0.32, r * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 5; i += 1) {
    ctx.rotate((Math.PI * 2) / 5);
    ctx.beginPath();
    ctx.moveTo(0, -r * 1.08);
    ctx.lineTo(r * 0.12, -r * 0.9);
    ctx.lineTo(-r * 0.12, -r * 0.9);
    ctx.fill();
  }
  ctx.restore();
};

/** Cream plaster over a dark timber skirting: a temple compound wall. */
export const plasterWall = (): Texture =>
  make('plaster', 256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#f3e8d2';
    ctx.fillRect(0, 0, w, h);
    const r = rng(7);
    for (let i = 0; i < 900; i += 1) {
      ctx.fillStyle = `rgba(160,130,90,${r() * 0.05})`;
      ctx.fillRect(r() * w, r() * h, 2 + r() * 5, 2 + r() * 5);
    }
    // Three white rule lines: the mark of a noble compound wall (suji-bei).
    ctx.fillStyle = '#ffffff';
    for (const y of [h * 0.18, h * 0.26, h * 0.34]) ctx.fillRect(0, y, w, 5);
    ctx.fillStyle = 'rgba(120,100,70,0.35)';
    for (const y of [h * 0.18, h * 0.26, h * 0.34]) ctx.fillRect(0, y + 5, w, 1.5);
    // Timber base.
    ctx.fillStyle = '#3a2a22';
    ctx.fillRect(0, h * 0.8, w, h * 0.2);
    ctx.fillStyle = '#2a1d17';
    ctx.fillRect(0, h * 0.8, w, 5);
    // Vertical timber post.
    ctx.fillStyle = '#3a2a22';
    ctx.fillRect(w * 0.47, 0, w * 0.06, h);
  }, true);

/** Blue-grey kawara tiles, for every roof in the world. */
export const roofTiles = (): Texture =>
  make('roof', 128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#3c4458';
    ctx.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 16) {
      const gradient = ctx.createLinearGradient(x, 0, x + 16, 0);
      gradient.addColorStop(0, 'rgba(255,255,255,0.0)');
      gradient.addColorStop(0.5, 'rgba(255,255,255,0.18)');
      gradient.addColorStop(1, 'rgba(0,0,0,0.25)');
      ctx.fillStyle = gradient;
      ctx.fillRect(x, 0, 16, h);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    for (let y = 0; y < h; y += 16) ctx.fillRect(0, y, w, 3);
  }, true);

/** Warm timber planks for the early island decks and the shrine verandas. */
export const woodPlanks = (): Texture =>
  make('planks', 256, 256, (ctx, w, h) => {
    const r = rng(11);
    const plank = w / 8;
    for (let i = 0; i < 8; i += 1) {
      const shade = 200 + Math.floor(r() * 40);
      ctx.fillStyle = `rgb(${shade},${Math.floor(shade * 0.78)},${Math.floor(shade * 0.55)})`;
      ctx.fillRect(i * plank, 0, plank, h);
      ctx.strokeStyle = 'rgba(110,70,40,0.25)';
      ctx.lineWidth = 1;
      for (let g = 0; g < 5; g += 1) {
        const gx = i * plank + 4 + r() * (plank - 8);
        ctx.beginPath();
        ctx.moveTo(gx, 0);
        ctx.bezierCurveTo(gx + 4, h * 0.3, gx - 4, h * 0.7, gx, h);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(60,35,20,0.55)';
      ctx.fillRect(i * plank, 0, 2, h);
      // Staggered butt joints.
      const joint = r() * h;
      ctx.fillRect(i * plank, joint, plank, 2);
    }
  }, true);

/** Mossy flagstones for the mid-route mountain islands. */
export const flagstones = (): Texture =>
  make('flagstones', 256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#5f5a52';
    ctx.fillRect(0, 0, w, h);
    const r = rng(23);
    const rows = 4;
    const rowH = h / rows;
    for (let row = 0; row < rows; row += 1) {
      let x = row % 2 === 0 ? 0 : -rowH * 0.5;
      while (x < w) {
        const width = rowH * (0.8 + r() * 0.7);
        const shade = 190 + Math.floor(r() * 45);
        ctx.fillStyle = `rgb(${shade},${shade - 4},${shade - 14})`;
        ctx.beginPath();
        ctx.roundRect(x + 3, row * rowH + 3, width - 6, rowH - 6, 8);
        ctx.fill();
        x += width;
      }
    }
    ctx.fillStyle = 'rgba(96,150,70,0.4)';
    for (let i = 0; i < 60; i += 1) {
      ctx.beginPath();
      ctx.arc(r() * w, r() * h, 2 + r() * 6, 0, Math.PI * 2);
      ctx.fill();
    }
  }, true);

/** Coloured lacquer with a gold inlay border, for the floating shrines. */
export const lacquer = (base: number): Texture =>
  make(`lacquer:${base}`, 256, 128, (ctx, w, h) => {
    ctx.fillStyle = `#${base.toString(16).padStart(6, '0')}`;
    ctx.fillRect(0, 0, w, h);
    const sheen = ctx.createLinearGradient(0, 0, w, h);
    sheen.addColorStop(0, 'rgba(255,255,255,0.14)');
    sheen.addColorStop(0.5, 'rgba(255,255,255,0)');
    sheen.addColorStop(1, 'rgba(0,0,0,0.18)');
    ctx.fillStyle = sheen;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(242,193,78,0.95)';
    ctx.lineWidth = 6;
    ctx.strokeRect(10, 10, w - 20, h - 20);
    ctx.lineWidth = 2;
    ctx.strokeRect(20, 20, w - 40, h - 40);
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    for (let x = 0; x < w; x += 32) ctx.fillRect(x, 0, 2, h);
    drawBlossom(ctx, w / 2, h / 2, 26, 'rgba(242,193,78,0.85)');
  });

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
    // Scattered fallen petals.
    for (let i = 0; i < 26; i += 1) {
      ctx.fillStyle = r() < 0.6 ? '#ffc4d8' : '#ff9cc0';
      ctx.beginPath();
      ctx.ellipse(r() * w, r() * h, 2.4, 1.5, r() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
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

/** Tatami: woven rush in soft green-gold with a dark cloth border. */
export const tatami = (): Texture =>
  make('tatami', 128, 256, (ctx, w, h) => {
    ctx.fillStyle = '#c9c07a';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(110,100,40,0.35)';
    ctx.lineWidth = 1;
    for (let y = 0; y < h; y += 3) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    ctx.fillStyle = '#2a2f3a';
    ctx.fillRect(0, 0, 9, h);
    ctx.fillRect(w - 9, 0, 9, h);
    ctx.fillStyle = 'rgba(242,193,78,0.6)';
    ctx.fillRect(3, 0, 2, h);
    ctx.fillRect(w - 5, 0, 2, h);
  }, true);
