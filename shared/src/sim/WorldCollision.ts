import {
  BOOT_SHOP,
  BOOT_TIERS,
  COLLECTION_ZONE,
  collectionZoneX,
  collectionZoneZ,
  DEATH_PLANE_Y,
  GORGE,
  GORGE_HEAD,
  PLATFORM,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  REDLINE_RADIUS,
  REDLINES,
  ROUTE_BARRIER_Z,
  SPAWN_PLATFORM,
  SPAWN_WALLS,
  TREADMILL_DECK_Y,
  TREADMILL_ROW,
  TREADMILL_DECKS,
  TROPHY_PLATFORMS,
} from '../index.js';

/** Half the thickness of the shop backdrop, which closes the right side. */
const SHOP_WALL_HALF_THICKNESS = 0.8 + 0.7;

/**
 * Anything the player can stand on: an axis-aligned rectangle in XZ with a
 * flat top. Every platform in the gorge is one of these.
 */
interface Surface {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  readonly topY: number;
  /** Underside. A platform is solid, so this is what a head hits. */
  readonly bottomY: number;
}

/**
 * What the player walked into this frame. All fields are independent - a
 * player can land in a trophy zone and be over the pit on the same frame.
 */
export interface GorgeTriggers {
  /** Index of the trophy platform whose collection zone was entered. */
  trophyIndex: number | null;
  /** True if the player's body intersects a red hazard line. */
  redline: boolean;
  /** True if the player has fallen past the death plane. */
  fell: boolean;
}

/**
 * The gameplay shape of the gorge: what you can stand on, where you cannot go,
 * and what hurts.
 *
 * Lives in `shared` because BOTH sides need it: the server re-simulates
 * movement against it, and the client predicts against the very same object.
 * A second copy anywhere would be a source of desync.
 *
 * Deliberately separate from the meshes that render it - GorgeWorld builds
 * visuals from the same shared config, so the two cannot drift.
 */
export class WorldCollision {
  private readonly surfaces: Surface[] = [];

  /** Maximum drop below a surface that still counts as landing on it. */
  private static readonly LANDING_TOLERANCE = 0.25;

  /** Slack on the head test, so grazing an underside does not snag. */
  private static readonly CEILING_TOLERANCE = 0.05;

  constructor() {
    this.surfaces.push({
      minX: SPAWN_PLATFORM.x - SPAWN_PLATFORM.width / 2,
      maxX: SPAWN_PLATFORM.x + SPAWN_PLATFORM.width / 2,
      minZ: SPAWN_PLATFORM.centerZ - SPAWN_PLATFORM.length / 2,
      maxZ: SPAWN_PLATFORM.centerZ + SPAWN_PLATFORM.length / 2,
      topY: SPAWN_PLATFORM.topY,
      bottomY: SPAWN_PLATFORM.topY - SPAWN_PLATFORM.thickness,
    });

    for (const platform of TROPHY_PLATFORMS) {
      this.surfaces.push({
        minX: PLATFORM.x - PLATFORM.width / 2,
        maxX: PLATFORM.x + PLATFORM.width / 2,
        minZ: platform.centerZ - PLATFORM.length / 2,
        maxZ: platform.centerZ + PLATFORM.length / 2,
        topY: PLATFORM.topY,
        bottomY: PLATFORM.topY - PLATFORM.thickness,
      });
    }

    // The treadmill decks along the back wall of spawn. They are a SHALLOW
    // step - 0.2, inside LANDING_TOLERANCE - so the player walks straight on
    // and off them and the simulation needs no step-up rule of its own.
    for (const deck of TREADMILL_DECKS) {
      const centreX = deck.x;
      this.surfaces.push({
        minX: centreX - TREADMILL_ROW.beltWidth / 2,
        maxX: centreX + TREADMILL_ROW.beltWidth / 2,
        minZ: TREADMILL_ROW.centerZ - TREADMILL_ROW.beltLength / 2,
        maxZ: TREADMILL_ROW.centerZ + TREADMILL_ROW.beltLength / 2,
        topY: TREADMILL_DECK_Y,
        bottomY: TREADMILL_DECK_Y - TREADMILL_ROW.deckHeight,
      });
    }
  }

  /**
   * Height of the walkable surface under (x, z), or null over empty gorge.
   *
   * The player's radius is honoured so they can stand on a platform edge
   * rather than falling the instant their centre passes it.
   */
  surfaceYAt(x: number, z: number): number | null {
    let best: number | null = null;
    for (const surface of this.surfaces) {
      if (x < surface.minX - PLAYER_RADIUS || x > surface.maxX + PLAYER_RADIUS) continue;
      if (z < surface.minZ - PLAYER_RADIUS || z > surface.maxZ + PLAYER_RADIUS) continue;
      if (best === null || surface.topY > best) best = surface.topY;
    }
    return best;
  }

  /**
   * Underside of the lowest platform the player is about to head-butt, or null.
   *
   * A platform is a SOLID slab, not a one-way floor. Without this a player
   * jumping under an island simply passed up through it and out of the top,
   * which made the whole route climbable from below.
   *
   * `previousHeadY` is what keeps it honest: only a slab the player's head was
   * already BELOW can stop them, so standing on a platform never traps them
   * under the one they are on.
   *
   * Deliberately NOT inflated by the player radius. The ground test inflates so
   * a player can stand on an edge; inflating a ceiling would instead block them
   * in mid air beside one.
   */
  ceilingYAt(x: number, z: number, previousHeadY: number): number | null {
    let best: number | null = null;
    for (const surface of this.surfaces) {
      if (x < surface.minX || x > surface.maxX) continue;
      if (z < surface.minZ || z > surface.maxZ) continue;
      if (previousHeadY > surface.bottomY + WorldCollision.CEILING_TOLERANCE) continue;
      if (best === null || surface.bottomY < best) best = surface.bottomY;
    }
    return best;
  }

  /** True when the player may snap down onto `surfaceY` from `previousY`. */
  canLandOn(previousY: number, surfaceY: number): boolean {
    return previousY >= surfaceY - WorldCollision.LANDING_TOLERANCE;
  }

  /**
   * Invisible boundary keeping players off the banks.
   *
   * The banks start well outside this, so the clamp is a hard guarantee rather
   * than a surface the player can slide along.
   */
  clampToChannel(x: number): number {
    const limit = GORGE.channelHalfWidth;
    return x < -limit ? -limit : x > limit ? limit : x;
  }

  /**
   * Clamp a position to whatever bounds apply where the player is standing.
   *
   * The starting area is much wider than the gorge channel and is walled on
   * the left, the back and (by the shop's backdrop) the right, so it needs its
   * own limits. Everywhere else the narrow channel applies.
   *
   * Writes into `out` to avoid allocating per frame.
   */
  clampToBounds(x: number, z: number, out: { x: number; z: number }): void {
    if (this.isOverSpawnPlatform(z)) {
      const left = SPAWN_WALLS.leftInnerX;
      const right = BOOT_SHOP.wallX + SHOP_WALL_HALF_THICKNESS;
      out.x = x < right ? right : x > left ? left : x;
      out.z = z < SPAWN_WALLS.backInnerZ ? SPAWN_WALLS.backInnerZ : z;

      // The starting area is much wider than the gorge it feeds into, so its
      // front edge is closed except at the mouth. Without this the player
      // could walk off the front out at x=25 and be yanked sideways to the
      // channel limit in a single step - a teleport, not a boundary.
      if (Math.abs(out.x) > GORGE_HEAD.mouthHalfWidth) {
        const lip = GORGE_HEAD.riverStartZ - SPAWN_WALLS.thickness;
        if (out.z > lip) out.z = lip;
      }
      return;
    }

    out.x = this.clampToChannel(x);
    // The end of the route. A CLAMP rather than a surface: it is applied after
    // the step has already integrated, so no speed, jump arc or flip chain can
    // carry a player through it the way a thin collider could be tunnelled.
    // `clampToChannel` above has already pinned X to the corridor, so the
    // barrier spans the full playable width and cannot be rounded at the
    // sides. Nothing renders it, and there is nothing to break.
    out.z = z > ROUTE_BARRIER_Z ? ROUTE_BARRIER_Z : z;
  }

  /**
   * True anywhere at or behind the starting platform's front edge.
   *
   * Deliberately open-ended backwards rather than a range: a single large
   * displacement past the back wall would otherwise escape this test and fall
   * through to the channel branch, which does not clamp Z at all - so the wall
   * could be tunnelled through instead of blocking.
   */
  private isOverSpawnPlatform(z: number): boolean {
    return z <= SPAWN_PLATFORM.centerZ + SPAWN_PLATFORM.length / 2;
  }

  /**
   * Slot of the boot pedestal the player is standing on, or null.
   *
   * Buying is deliberate: the player has to walk onto the stand, so this is
   * what turns proximity into a purchase request.
   */
  bootPedestalAt(x: number, y: number, z: number): number | null {
    if (Math.abs(x - BOOT_SHOP.x) > BOOT_SHOP.pickupRadius) return null;
    if (y < SPAWN_PLATFORM.topY - 1 || y > SPAWN_PLATFORM.topY + 5) return null;

    for (let slot = 1; slot <= BOOT_TIERS.length; slot += 1) {
      const pedestalZ = BOOT_SHOP.firstZ + (slot - 1) * BOOT_SHOP.spacingZ;
      if (Math.abs(z - pedestalZ) <= BOOT_SHOP.pickupRadius) return slot;
    }
    return null;
  }

  /** Sample every trigger volume at the player's current position. */
  sampleTriggers(x: number, y: number, z: number): GorgeTriggers {
    return {
      trophyIndex: this.trophyZoneAt(x, y, z),
      redline: this.touchesRedline(x, y, z),
      fell: y <= DEATH_PLANE_Y,
    };
  }

  /** Index of the collection zone containing the player, if any. */
  private trophyZoneAt(x: number, y: number, z: number): number | null {
    if (y < PLATFORM.topY - 1 || y > PLATFORM.topY + COLLECTION_ZONE.height) return null;

    const halfWidth = COLLECTION_ZONE.width / 2;
    const halfDepth = COLLECTION_ZONE.depth / 2;

    const padX = collectionZoneX();
    if (Math.abs(x - padX) > halfWidth) return null;

    for (const platform of TROPHY_PLATFORMS) {
      if (Math.abs(z - collectionZoneZ(platform.centerZ)) > halfDepth) continue;
      return platform.index;
    }
    return null;
  }

  /**
   * Red lines are level and span the full playable width, so only the Z and Y
   * bands matter: the player is treated as a box PLAYER_HEIGHT tall and
   * PLAYER_RADIUS deep.
   *
   * The X extent is still checked, because a line now ends inside the bank at
   * a height-dependent span rather than running to infinity - and the player
   * is clamped to the channel well inside that, so this only ever matters if
   * the two configs are changed apart.
   */
  private touchesRedline(x: number, y: number, z: number): boolean {
    const feet = y;
    const head = y + PLAYER_HEIGHT;

    for (const line of REDLINES) {
      if (Math.abs(z - line.z) > PLAYER_RADIUS + REDLINE_RADIUS) continue;
      if (Math.abs(x) > line.halfSpan + PLAYER_RADIUS) continue;

      const lineY = PLATFORM.topY + line.y;
      if (head < lineY - REDLINE_RADIUS) continue;
      if (feet > lineY + REDLINE_RADIUS) continue;
      return true;
    }
    return false;
  }
}
