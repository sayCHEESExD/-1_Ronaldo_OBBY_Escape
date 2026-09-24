import { BoxGeometry, type BufferGeometry } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * A blocky low-top sneaker, built from boxes and merged into two geometries.
 *
 * Shaped in a 1x1x1 box centred on the origin at the sole, so callers scale it
 * to whatever size they need: `depth` runs forward (+Z), `width` across (X).
 * The profile steps up from a low toe to a raised heel collar, which is what
 * reads as a shoe rather than a brick.
 *
 * Returns the coloured upper and the white sole separately so a single tier
 * colour can tint the upper while the sole stays neutral.
 */
export interface SneakerGeometry {
  readonly upper: BufferGeometry;
  readonly sole: BufferGeometry;
}

interface Part {
  /** Size along X, Y, Z. */
  readonly size: readonly [number, number, number];
  /** Centre offset from the origin. */
  readonly at: readonly [number, number, number];
}

/** Sole: a slightly oversized slab running the full length. */
const SOLE_PARTS: readonly Part[] = [
  { size: [1.0, 0.16, 1.0], at: [0, 0.08, 0] },
  // A thin lip at the toe, so the sole reads as wrapping upward at the front.
  { size: [0.94, 0.1, 0.16], at: [0, 0.2, 0.42] },
];

/** Upper: toe box, instep, then the raised heel collar. */
const UPPER_PARTS: readonly Part[] = [
  // Toe - lowest and slightly narrower, giving the front its taper.
  { size: [0.86, 0.2, 0.3], at: [0, 0.26, 0.35] },
  // Instep.
  { size: [0.92, 0.32, 0.34], at: [0, 0.32, 0.06] },
  // Heel body.
  { size: [0.94, 0.46, 0.3], at: [0, 0.39, -0.24] },
  // Ankle collar, the tallest part at the very back.
  { size: [0.9, 0.24, 0.2], at: [0, 0.64, -0.32] },
];

const build = (parts: readonly Part[]): BufferGeometry => {
  const boxes = parts.map((part) => {
    const box = new BoxGeometry(part.size[0], part.size[1], part.size[2]);
    box.translate(part.at[0], part.at[1], part.at[2]);
    return box;
  });

  const merged = mergeGeometries(boxes, false);
  for (const box of boxes) box.dispose();

  if (!merged) throw new Error('Failed to merge sneaker geometry');
  return merged;
};

/**
 * Build one sneaker. The caller owns the returned geometries and must dispose
 * them; they are cheap to share across every boot that needs the same shape.
 */
export const createSneakerGeometry = (): SneakerGeometry => ({
  upper: build(UPPER_PARTS),
  sole: build(SOLE_PARTS),
});
