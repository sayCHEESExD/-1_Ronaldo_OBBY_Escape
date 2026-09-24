/**
 * The HUD's single scaling system.
 *
 * Every HUD metric is written as `design px * var(--obby-ui-scale)`, and this
 * module is the ONE place that value is decided - from the live viewport, on
 * every resize, rotation and mobile toolbar change. The HUD is therefore the
 * same design at every size, scaled as a whole; nothing checks for "mobile".
 *
 * The scale is:
 *
 *   1. proportional to the viewport against the reference screen the HUD was
 *      designed on (1366 x 768 at scale 1.3, the look it has always had), on
 *      whichever axis is tighter - so a narrow portrait phone and a short
 *      landscape phone both shrink it, and a big monitor grows it;
 *   2. clamped between a floor that keeps tiles usable touch targets and text
 *      readable, and a ceiling so a 4K window does not get billboard buttons;
 *   3. capped so the left column - the Wins counter and the rail of tiles
 *      below it, centred vertically as one unit - always fits the height.
 *      This last limit wins over the floor: on a very short window
 *      everything getting smaller beats anything going off-screen.
 */

/** The screen the HUD was designed on, and the scale it was designed at. */
const DESIGN_WIDTH = 1366;
const DESIGN_HEIGHT = 768;
const DESIGN_SCALE = 1.3;

/** Floor: a 68px tile at 0.66 is 45px - the platform's touch-target minimum. */
const MIN_SCALE = 0.66;
/** Ceiling: tiles top out at ~109px however large the window. */
const MAX_SCALE = 1.6;

/**
 * The left column's extent in design px: the Wins counter's top (14 - it is
 * 48 tall and sits 8 above the Rebirth tile at 70) to the bottom of the
 * Bloxity tile (386 + 68). Components place themselves at
 * `50% + (top - RAIL_CENTER) * scale`, so the column stays centred as a unit.
 */
const RAIL_START = 14;
const RAIL_END = 454;
export const RAIL_CENTER = (RAIL_START + RAIL_END) / 2;
const RAIL_HALF = (RAIL_END - RAIL_START) / 2;

/** Design px kept clear above and below the column. */
const EDGE_MARGIN = 10;

/** The column fits when `scale <= height / FIT_DIVISOR`. */
const FIT_DIVISOR = 2 * (RAIL_HALF + EDGE_MARGIN);

let installed = false;

/** The scale for a viewport. Exported so the rule is testable on its own. */
export const hudScaleFor = (width: number, height: number): number => {
  const proportional = DESIGN_SCALE * Math.min(width / DESIGN_WIDTH, height / DESIGN_HEIGHT);
  const bounded = Math.min(MAX_SCALE, Math.max(MIN_SCALE, proportional));
  return Math.min(bounded, height / FIT_DIVISOR);
};

const viewport = (): { width: number; height: number } => {
  // The visual viewport tracks the mobile toolbar sliding in and out; the
  // layout viewport does not.
  const vv = window.visualViewport;
  return {
    width: Math.round(vv?.width ?? window.innerWidth),
    height: Math.round(vv?.height ?? window.innerHeight),
  };
};

/**
 * Recompute and publish the scale.
 *
 * Applied straight from the resize event, not deferred to an animation
 * frame: browsers already deliver resize at most once per frame, the work is
 * two property writes, and a deferred update is skipped entirely while the
 * page is not painting - leaving the HUD at the previous window's size.
 */
const apply = (): void => {
  const { width, height } = viewport();
  if (width === 0 || height === 0) return;
  const root = document.documentElement.style;
  root.setProperty('--obby-ui-scale', hudScaleFor(width, height).toFixed(4));
  root.setProperty('--obby-rail-center', `${RAIL_CENTER}px`);
};

/** Start driving `--obby-ui-scale` from the viewport. Idempotent. */
export const installHudScale = (): void => {
  if (installed) return;
  installed = true;
  apply();
  window.addEventListener('resize', apply);
  window.addEventListener('orientationchange', apply);
  window.visualViewport?.addEventListener('resize', apply);
  // A backgrounded tab gets no resize events; one rotated or resized while
  // hidden must still come back at the right size.
  document.addEventListener('visibilitychange', apply);
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(apply).observe(document.documentElement);
  }
};
