import {
  CanvasTexture,
  LinearFilter,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
} from 'three';

/** Canvas pixels. Wide enough for a long display name without wrapping. */
const CANVAS_W = 512;
const CANVAS_H = 128;

/** World size of the plate, and how far above the player's feet it floats. */
const WORLD_W = 2.9;
const WORLD_H = CANVAS_H * (WORLD_W / CANVAS_W);
const HEIGHT_ABOVE_FEET = 4;

/** Longest name drawn before the font starts shrinking to fit. */
const BASE_FONT = 58;

/**
 * The floating name above a player's head.
 *
 * A `Sprite`, so it always faces the camera without anything per-frame: the
 * renderer bills it to the GPU and nothing here runs in the game loop.
 *
 * Parented to the character's ROOT - the physics transform - and never to the
 * flip pivot or the visual node. A plate under the flip pivot would cartwheel
 * with a backflip, and one under `visual` would be squashed by the death
 * animation. Root is the one node that only ever holds where the player is.
 *
 * It shows the player's BLOXITY DISPLAY NAME and nothing else. A player with
 * no name yet gets no plate rather than an internal id.
 */
export class NamePlate {
  readonly sprite: Sprite;

  private readonly canvas: HTMLCanvasElement;
  private readonly texture: CanvasTexture;
  private readonly material: SpriteMaterial;
  private name = '';

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = CANVAS_W;
    this.canvas.height = CANVAS_H;

    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    // The plate is drawn at one size and viewed at many; linear keeps it
    // readable at distance where the world's own textures stay nearest-filtered.
    this.texture.minFilter = LinearFilter;
    this.texture.magFilter = LinearFilter;

    this.material = new SpriteMaterial({
      map: this.texture,
      transparent: true,
      // Never writes depth: a transparent plate that did would punch a hole in
      // whatever is drawn after it.
      depthWrite: false,
      fog: false,
      toneMapped: false,
    });

    this.sprite = new Sprite(this.material);
    this.sprite.scale.set(WORLD_W, WORLD_H, 1);
    this.sprite.position.set(0, HEIGHT_ABOVE_FEET, 0);
    // Nothing to show until a name arrives.
    this.sprite.visible = false;
    this.sprite.renderOrder = 2;
  }

  /**
   * Show a display name, or hide the plate when there is none.
   *
   * Cheap to call every time state arrives: an unchanged name returns before
   * touching the canvas, so a plate costs nothing per patch.
   */
  setName(name: string): void {
    const next = (name ?? '').trim();
    if (next === this.name) return;
    this.name = next;

    this.sprite.visible = next.length > 0;
    if (next.length === 0) return;

    this.draw(next);
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.sprite.removeFromParent();
    this.material.dispose();
    this.texture.dispose();
  }

  /** A dark rounded pill with the name outlined on top, as the HUD draws text. */
  private draw(name: string): void {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    // Shrink to fit rather than clip: a name is short, and a half-shown one
    // reads as a bug.
    let font = BASE_FONT;
    const pad = 26;
    ctx.font = `900 ${font}px "Trebuchet MS", "Segoe UI", sans-serif`;
    const maxWidth = CANVAS_W - pad * 2 - 24;
    const measured = ctx.measureText(name).width;
    if (measured > maxWidth) {
      font = Math.max(24, Math.floor(font * (maxWidth / measured)));
      ctx.font = `900 ${font}px "Trebuchet MS", "Segoe UI", sans-serif`;
    }

    const textWidth = ctx.measureText(name).width;
    const pillW = Math.min(CANVAS_W - 8, textWidth + pad * 2);
    const pillH = Math.min(CANVAS_H - 8, font + 34);
    const pillX = (CANVAS_W - pillW) / 2;
    const pillY = (CANVAS_H - pillH) / 2;

    ctx.fillStyle = 'rgba(8, 14, 26, 0.62)';
    ctx.beginPath();
    ctx.roundRect(pillX, pillY, pillW, pillH, pillH / 2);
    ctx.fill();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = font * 0.2;
    ctx.strokeStyle = 'rgba(12, 20, 40, 0.9)';
    ctx.strokeText(name, CANVAS_W / 2, CANVAS_H / 2);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(name, CANVAS_W / 2, CANVAS_H / 2);
  }
}
