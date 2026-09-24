import { GORGE_HEAD, SPAWN_PLATFORM, SPAWN_WALLS } from '@obby/shared';
import { BoxGeometry, Group, Mesh, type BufferGeometry, type Material, type Texture } from 'three';
import { WORLD_COLORS } from '../config/worldVisuals.js';
import { plasterWall } from './JapaneseArt.js';
import { gableRoof, hipRoof } from './JapaneseProps.js';
import { toon } from './ToonKit.js';
import type { WorldTextures } from './WorldTextures.js';

/** Height of the tiled roof that caps every compound wall. */
const ROOF_HEIGHT = 1.3;
/** How far the roof oversails the wall on each side. */
const ROOF_OVERHANG = 0.75;

/**
 * The shrine compound's walls, closing the starting area on the left (+X),
 * the back (-Z) and the outer parts of the front.
 *
 * Styled as a temple wall - cream plaster with ruled lines over a timber
 * skirting, capped by a curved tiled roof - with timber pillars at every
 * corner. Every wall keeps exactly the footprint it always had.
 *
 * The right side is closed by the Win Shop's own backdrop. The front is open
 * only across the GORGE MOUTH - the starting area is much wider than the
 * channel it feeds into, so the rest of the front edge is walled. Without that
 * the player could walk off the front out at the far left and be snapped
 * sideways to the channel limit in a single step.
 *
 * Collision for all of these lives in `WorldCollision.clampToBounds`.
 */
export class SpawnArea {
  readonly root = new Group();

  private readonly geometries: BufferGeometry[] = [];
  private readonly textures: Texture[] = [];

  constructor(textures: WorldTextures) {
    void textures;
    // One texture repeat per 8 units of run and exactly one up the wall, so
    // the timber skirting and the ruled lines sit at the same height on every
    // wall. The two wall orientations get their own clone.
    const material = this.plaster(SPAWN_PLATFORM.length / 8);
    const acrossMaterial = this.plaster(SPAWN_PLATFORM.width / 8);

    const halfWidth = SPAWN_PLATFORM.width / 2;
    const halfLength = SPAWN_PLATFORM.length / 2;
    const midY = SPAWN_PLATFORM.topY + SPAWN_WALLS.height / 2;

    // Left wall, running the full length of the platform.
    const leftGeometry = new BoxGeometry(
      SPAWN_WALLS.thickness,
      SPAWN_WALLS.height,
      SPAWN_PLATFORM.length,
    );
    this.geometries.push(leftGeometry);
    const left = new Mesh(leftGeometry, material);
    left.position.set(
      halfWidth - SPAWN_WALLS.thickness / 2,
      midY,
      SPAWN_PLATFORM.centerZ,
    );
    left.receiveShadow = true;
    left.castShadow = true;
    this.root.add(left);

    // Back wall, spanning the full width so the corners meet cleanly.
    const backGeometry = new BoxGeometry(
      SPAWN_PLATFORM.width,
      SPAWN_WALLS.height,
      SPAWN_WALLS.thickness,
    );
    this.geometries.push(backGeometry);
    const back = new Mesh(backGeometry, acrossMaterial);
    back.position.set(
      SPAWN_PLATFORM.x,
      midY,
      SPAWN_PLATFORM.centerZ - halfLength + SPAWN_WALLS.thickness / 2,
    );
    back.receiveShadow = true;
    back.castShadow = true;
    this.root.add(back);

    this.buildMouthWalls(
      this.plaster((SPAWN_WALLS.leftInnerX - GORGE_HEAD.mouthHalfWidth) / 8),
      halfWidth,
    );
    this.buildCoping(halfWidth, halfLength);
    this.buildCornerPosts(halfWidth, halfLength);
  }

  private plaster(repeat: number): Material {
    const map = plasterWall().clone();
    map.needsUpdate = true;
    map.repeat.set(repeat, 1);
    this.textures.push(map);
    return toon(0xffffff, { map });
  }

  /**
   * A curved tiled roof along the top of every wall - the coping course.
   *
   * It is what turns a slab into a temple wall. The roofs span exactly the
   * runs of the walls they cap, so no two of them overlap.
   */
  private buildCoping(halfWidth: number, halfLength: number): void {
    const material = toon(WORLD_COLORS.roofTile);
    const width = SPAWN_WALLS.thickness + ROOF_OVERHANG * 2;
    const y = SPAWN_PLATFORM.topY + SPAWN_WALLS.height;

    // Left wall: the roof's ridge runs along Z, which is gableRoof's own axis.
    const leftGeometry = gableRoof(width, ROOF_HEIGHT, SPAWN_PLATFORM.length);
    this.geometries.push(leftGeometry);
    const left = new Mesh(leftGeometry, material);
    left.position.set(halfWidth - SPAWN_WALLS.thickness / 2, y, SPAWN_PLATFORM.centerZ);
    left.castShadow = true;
    this.root.add(left);

    // Back wall: turned a quarter so the ridge runs along X.
    const backGeometry = gableRoof(width, ROOF_HEIGHT, SPAWN_PLATFORM.width);
    backGeometry.rotateY(Math.PI / 2);
    this.geometries.push(backGeometry);
    const back = new Mesh(backGeometry, material);
    back.position.set(
      SPAWN_PLATFORM.x,
      y,
      SPAWN_PLATFORM.centerZ - halfLength + SPAWN_WALLS.thickness / 2,
    );
    back.castShadow = true;
    this.root.add(back);

    // The two mouth walls either side of the gorge entrance.
    const mouth = GORGE_HEAD.mouthHalfWidth;
    const span = SPAWN_WALLS.leftInnerX - mouth;
    if (span <= 0) return;
    const mouthGeometry = gableRoof(width, ROOF_HEIGHT, span);
    mouthGeometry.rotateY(Math.PI / 2);
    this.geometries.push(mouthGeometry);
    for (const side of [-1, 1] as const) {
      const cap = new Mesh(mouthGeometry, material);
      cap.position.set(
        side * (mouth + span / 2),
        y,
        GORGE_HEAD.riverStartZ - SPAWN_WALLS.thickness / 2,
      );
      cap.castShadow = true;
      this.root.add(cap);
    }
  }

  /**
   * Square posts where the walls meet.
   *
   * They tie the runs together at the corners and at the gorge mouth, so the
   * boundary reads as one deliberate enclosure rather than four separate
   * pieces that happen to touch.
   */
  private buildCornerPosts(halfWidth: number, halfLength: number): void {
    // Dark timber pillars, each wearing a small tiled cap.
    const material = toon(WORLD_COLORS.timber);
    const capMaterial = toon(WORLD_COLORS.roofTile);

    const size = SPAWN_WALLS.thickness + 1.1;
    const height = SPAWN_WALLS.height + 1.4;
    const geometry = new BoxGeometry(size, height, size);
    const capGeometry = hipRoof(size * 0.95, size * 0.2, 1.1);
    this.geometries.push(geometry, capGeometry);

    const y = SPAWN_PLATFORM.topY + height / 2;
    const backZ = SPAWN_PLATFORM.centerZ - halfLength + SPAWN_WALLS.thickness / 2;
    const frontZ = GORGE_HEAD.riverStartZ - SPAWN_WALLS.thickness / 2;
    const mouth = GORGE_HEAD.mouthHalfWidth;

    const spots: [number, number][] = [
      // Back corners.
      [halfWidth - SPAWN_WALLS.thickness / 2, backZ],
      [-(halfWidth - SPAWN_WALLS.thickness / 2), backZ],
      // Front corners, out at the canyon rim.
      [halfWidth - SPAWN_WALLS.thickness / 2, frontZ],
      [-(halfWidth - SPAWN_WALLS.thickness / 2), frontZ],
      // Either side of the gorge mouth - the gateposts of the route.
      [mouth, frontZ],
      [-mouth, frontZ],
    ];

    for (const [x, z] of spots) {
      const post = new Mesh(geometry, material);
      post.position.set(x, y, z);
      post.castShadow = true;
      post.receiveShadow = true;
      this.root.add(post);

      const cap = new Mesh(capGeometry, capMaterial);
      cap.position.set(x, SPAWN_PLATFORM.topY + height + 0.55, z);
      this.root.add(cap);
    }
  }

  /**
   * The lip either side of the gorge mouth.
   *
   * Runs from the channel edge out to the canyon rim on both sides, so the
   * route leaves the start through an opening exactly as wide as the gorge.
   */
  private buildMouthWalls(material: Material, halfWidth: number): void {
    const mouth = GORGE_HEAD.mouthHalfWidth;
    // Stop at the SIDE wall's inner face rather than the platform edge. Run to
    // the edge and the last two units of this wall sit inside the left wall,
    // with both tops at the same height - two blue surfaces fighting for the
    // same pixels along the whole front-left corner.
    const span = SPAWN_WALLS.leftInnerX - mouth;
    if (span <= 0) return;
    void halfWidth;

    const geometry = new BoxGeometry(span, SPAWN_WALLS.height, SPAWN_WALLS.thickness);
    this.geometries.push(geometry);

    const midY = SPAWN_PLATFORM.topY + SPAWN_WALLS.height / 2;
    const z = GORGE_HEAD.riverStartZ - SPAWN_WALLS.thickness / 2;

    for (const side of [-1, 1] as const) {
      const wall = new Mesh(geometry, material);
      wall.position.set(side * (mouth + span / 2), midY, z);
      wall.receiveShadow = true;
      wall.castShadow = true;
      this.root.add(wall);
    }
  }

  dispose(): void {
    for (const geometry of this.geometries) geometry.dispose();
    for (const texture of this.textures) texture.dispose();
  }
}
