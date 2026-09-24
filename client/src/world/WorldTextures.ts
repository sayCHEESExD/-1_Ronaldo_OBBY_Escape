import {
  CanvasTexture,
  EquirectangularReflectionMapping,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
} from 'three';

/**
 * Procedural canvas textures for the gorge.
 *
 * Everything here is drawn at runtime on a small canvas - no image files, so
 * the whole toy-brick look costs nothing in the 12 MB budget. Textures are
 * cached and shared: a caller asking twice gets the same GPU upload.
 */
export class WorldTextures {
  private readonly cache = new Map<string, Texture>();

  /** Bright grass with moulded studs, for the spawn pad and the gorge rim. */
  grassStuds(color: string, highlight: string): Texture {
    return this.cached(`studs:${color}:${highlight}`, () => {
      const size = 128;
      const ctx = context(size);
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, size, size);

      // A 4x4 grid of studs; drawn as a soft top-lit disc plus a shadow arc.
      const cells = 4;
      const step = size / cells;
      const radius = step * 0.26;
      for (let ix = 0; ix < cells; ix += 1) {
        for (let iz = 0; iz < cells; iz += 1) {
          const cx = (ix + 0.5) * step;
          const cy = (iz + 0.5) * step;

          ctx.strokeStyle = 'rgba(0,0,0,0.14)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(cx, cy + 1, radius, 0, Math.PI * 2);
          ctx.stroke();

          ctx.fillStyle = highlight;
          ctx.beginPath();
          ctx.arc(cx, cy, radius, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      return ctx.canvas;
    });
  }

  /** Square tiling, for the water and the canyon walls. */
  tiles(color: string, line: string, alt: string): Texture {
    return this.cached(`tiles:${color}:${line}:${alt}`, () => {
      const size = 128;
      const ctx = context(size);
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, size, size);

      // Faint checker so the surface reads as tiled rather than flat.
      const cells = 4;
      const step = size / cells;
      ctx.fillStyle = alt;
      for (let ix = 0; ix < cells; ix += 1) {
        for (let iz = 0; iz < cells; iz += 1) {
          if ((ix + iz) % 2 === 0) continue;
          ctx.fillRect(ix * step, iz * step, step, step);
        }
      }

      ctx.strokeStyle = line;
      ctx.lineWidth = 1.5;
      for (let i = 0; i <= cells; i += 1) {
        const at = i * step;
        ctx.beginPath();
        ctx.moveTo(at, 0);
        ctx.lineTo(at, size);
        ctx.moveTo(0, at);
        ctx.lineTo(size, at);
        ctx.stroke();
      }
      return ctx.canvas;
    });
  }

  /**
   * Bright sky with soft cumulus.
   *
   * Used as `scene.background` with equirectangular mapping rather than a sky
   * dome mesh - three renders it as a true background, which costs no draw
   * call and cannot be frustum-culled.
   */
  /**
   * The sky dome: a deep-to-bright blue gradient with painterly cumulus.
   *
   * Equirectangular, so `v` is latitude - 0 is straight up, 0.5 is the
   * horizon. The camera only ever sees a band around the middle, which is why
   * the gradient does its work there and the clouds are massed just above the
   * horizon rather than scattered evenly over the sphere.
   *
   * Clouds are built from soft radial blobs rather than hard discs, in two
   * passes per cloud: a blue-grey underside offset downward, then a white lit
   * pass over it. That one trick is most of the difference between "circles"
   * and "clouds" - a flat white disc reads as a sticker, a shaded one reads as
   * volume.
   */
  sky(): Texture {
    const texture = this.cached('sky', () => {
      const width = 2048;
      const height = 1024;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return canvas;

      // Zenith to horizon and back down. The brightest band sits just below
      // the horizon line, which is what gives the sky its depth.
      const gradient = ctx.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, '#0851c4');
      gradient.addColorStop(0.18, '#1372e2');
      gradient.addColorStop(0.34, '#2b93f2');
      gradient.addColorStop(0.46, '#58b4fa');
      gradient.addColorStop(0.54, '#93d8ff');
      gradient.addColorStop(0.63, '#c9edff');
      gradient.addColorStop(0.74, '#7cc6f7');
      gradient.addColorStop(1, '#2e8ae0');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);

      const random = seeded(90210);

      // Three passes, far to near. Higher clouds are smaller, paler and
      // flatter; the low ones are big, bright and billowing.
      const layers: CloudLayer[] = [
        { count: 38, minV: 0.2, maxV: 0.44, scale: 34, squash: 0.4, alpha: 0.45, shade: 0.16 },
        { count: 34, minV: 0.34, maxV: 0.54, scale: 56, squash: 0.52, alpha: 0.78, shade: 0.38 },
        { count: 24, minV: 0.46, maxV: 0.63, scale: 84, squash: 0.6, alpha: 0.95, shade: 0.55 },
      ];

      for (const layer of layers) {
        for (let i = 0; i < layer.count; i += 1) {
          const x = random() * width;
          const y = height * (layer.minV + random() * (layer.maxV - layer.minV));
          const scale = layer.scale * (0.65 + random() * 0.8);

          // Drawn again either side of the seam when it is close to one, so a
          // cloud never gets sliced in half where the texture wraps.
          drawCloud(ctx, x, y, scale, layer, random);
          if (x < scale * 3) drawCloud(ctx, x + width, y, scale, layer, random);
          else if (x > width - scale * 3) drawCloud(ctx, x - width, y, scale, layer, random);
        }
      }

      // A few long wisps high up, to break the empty blue above the cumulus.
      for (let i = 0; i < 18; i += 1) {
        const x = random() * width;
        const y = height * (0.2 + random() * 0.18);
        const length = 90 + random() * 220;
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(1, 0.1 + random() * 0.08);
        softBlob(ctx, 0, 0, length, '255,255,255', 0.16 + random() * 0.14);
        ctx.restore();
      }

      return canvas;
    }, false);

    texture.mapping = EquirectangularReflectionMapping;
    return texture;
  }

  /**
   * A deep-space deck: near-black with scattered stars and a faint nebula.
   *
   * Deterministic - a fixed seed, so every client renders the same sky and the
   * island reads identically for everyone.
   */
  starfield(): Texture {
    return this.cached('starfield', () => {
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 128;
      const ctx = canvas.getContext('2d');
      if (!ctx) return canvas;

      ctx.fillStyle = '#0d0824';
      ctx.fillRect(0, 0, 128, 128);

      // Nebula wash.
      const nebula = ctx.createRadialGradient(44, 52, 4, 44, 52, 74);
      nebula.addColorStop(0, 'rgba(140,90,255,0.55)');
      nebula.addColorStop(1, 'rgba(140,90,255,0)');
      ctx.fillStyle = nebula;
      ctx.fillRect(0, 0, 128, 128);

      const random = seeded(0x5eed5);
      for (let i = 0; i < 90; i += 1) {
        const x = random() * 128;
        const y = random() * 128;
        const size = random() < 0.86 ? 1 : 2;
        ctx.fillStyle = random() < 0.2 ? '#9fd8ff' : '#ffffff';
        ctx.globalAlpha = 0.45 + random() * 0.55;
        ctx.fillRect(x, y, size, size);
      }
      ctx.globalAlpha = 1;
      return canvas;
    });
  }

  /**
   * The orange chequer of a Win collection pad.
   *
   * Two tones of the same orange rather than a hard black/white check, so the
   * pad reads as one bright surface from a distance and only shows its pattern
   * up close - which is how the reference art behaves.
   */
  winCheck(): Texture {
    return this.cached('winCheck', () => {
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
      const ctx = canvas.getContext('2d');
      if (!ctx) return canvas;

      ctx.fillStyle = '#ff9d1f';
      ctx.fillRect(0, 0, 64, 64);
      ctx.fillStyle = '#ffc247';
      for (let y = 0; y < 64; y += 32) {
        for (let x = 0; x < 64; x += 32) {
          if (((x + y) / 32) % 2 === 0) ctx.fillRect(x, y, 32, 32);
        }
      }
      return canvas;
    });
  }

  dispose(): void {
    for (const texture of this.cache.values()) texture.dispose();
    this.cache.clear();
  }

  private cached(key: string, draw: () => HTMLCanvasElement, repeat = true): Texture {
    const existing = this.cache.get(key);
    if (existing) return existing;

    const texture = new CanvasTexture(draw());
    texture.colorSpace = SRGBColorSpace;
    if (repeat) {
      texture.wrapS = RepeatWrapping;
      texture.wrapT = RepeatWrapping;
    }
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    this.cache.set(key, texture);
    return texture;
  }
}

const context = (size: number): CanvasRenderingContext2D => {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  return ctx;
};

/** Deterministic PRNG so the sky is identical on every client. */
/** Tuning for one depth of cloud. */
interface CloudLayer {
  readonly count: number;
  /** Latitude band the layer occupies, 0 = zenith, 0.5 = horizon. */
  readonly minV: number;
  readonly maxV: number;
  readonly scale: number;
  /** Vertical squash. Cumulus seen near the horizon are far wider than tall. */
  readonly squash: number;
  readonly alpha: number;
  /** How strongly the underside is shaded, 0..1. */
  readonly shade: number;
}

/**
 * One cumulus: a row of lobes that billow in the middle and flatten at the
 * base, drawn shaded then lit.
 */
const drawCloud = (
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  scale: number,
  layer: CloudLayer,
  random: () => number,
): void => {
  const lobes = 8 + Math.floor(random() * 6);

  // The lobe layout is generated once and drawn twice, so the shaded pass and
  // the lit pass are the same shape rather than two different clouds.
  const shape: { x: number; y: number; r: number }[] = [];
  for (let i = 0; i < lobes; i += 1) {
    const t = lobes === 1 ? 0.5 : i / (lobes - 1);
    const bulge = Math.sin(t * Math.PI);
    shape.push({
      x: (t - 0.5) * scale * 3.2,
      y: -bulge * scale * (0.3 + random() * 0.45) + (random() - 0.5) * scale * 0.2,
      r: scale * (0.32 + bulge * 0.5 + random() * 0.2),
    });
  }
  // A flat-ish base, so the cloud sits on a line instead of floating.
  const baseLobes = 3 + Math.floor(random() * 3);
  for (let i = 0; i < baseLobes; i += 1) {
    const t = baseLobes === 1 ? 0.5 : i / (baseLobes - 1);
    shape.push({
      x: (t - 0.5) * scale * 2.6,
      y: scale * 0.12,
      r: scale * (0.35 + random() * 0.22),
    });
  }

  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, layer.squash);

  if (layer.shade > 0.01) {
    // Underside first, pushed down so it peeks out below the lit pass.
    for (const lobe of shape) {
      softBlob(ctx, lobe.x, lobe.y + scale * 0.3, lobe.r, '150,190,225', layer.alpha * layer.shade);
    }
  }
  for (const lobe of shape) {
    softBlob(ctx, lobe.x, lobe.y, lobe.r, '255,255,255', layer.alpha);
  }

  ctx.restore();
};

/**
 * A soft-edged blob.
 *
 * The gradient is what makes a cloud painterly: a plain filled circle gives a
 * hard rim that reads as a sticker however many you overlap.
 */
const softBlob = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  rgb: string,
  alpha: number,
): void => {
  if (radius <= 0) return;
  const gradient = ctx.createRadialGradient(x, y, radius * 0.2, x, y, radius);
  gradient.addColorStop(0, `rgba(${rgb},${alpha})`);
  gradient.addColorStop(0.6, `rgba(${rgb},${alpha * 0.82})`);
  gradient.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
};

const seeded = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
