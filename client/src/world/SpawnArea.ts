import { GORGE_HEAD, SPAWN_PLATFORM, SPAWN_WALLS } from '@obby/shared';
import { BoxGeometry, Group, Mesh, type BufferGeometry, type Material, type Texture } from 'three';
import { WORLD_COLORS } from '../config/worldVisuals.js';
import { STADIUM_WALL_REPEAT, stadiumWall } from './WorldArt.js';
import { toon } from './ToonKit.js';
import type { WorldTextures } from './WorldTextures.js';

/** Height of the flat coping that caps every stadium wall. */
const COPING_HEIGHT = 0.5;
/** How far the coping oversails the wall on each side. */
const COPING_OVERHANG = 0.3;

/**
 * The stadium's perimeter walls, closing the starting area on the left (+X),
 * the back (-Z) and the outer parts of the front.
 *
 * Styled as the wall round a pitch - a row of lit LED advertising boards over
 * painted concrete and a green kick board, capped by a white and gold coping -
 * with navy pillars at every corner. Every wall keeps exactly the footprint
 * it always had.
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
    // One texture repeat per row of four boards along the run and exactly
    // one up the wall, so the boards and the kick board sit at the same
    // height on every wall. The two wall orientations get their own clone.
    const material = this.hoarding(SPAWN_PLATFORM.length / STADIUM_WALL_REPEAT);
    const acrossMaterial = this.hoarding(SPAWN_PLATFORM.width / STADIUM_WALL_REPEAT);

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
      this.hoarding((SPAWN_WALLS.leftInnerX - GORGE_HEAD.mouthHalfWidth) / STADIUM_WALL_REPEAT),
      halfWidth,
    );
    this.buildCoping(halfWidth, halfLength);
    this.buildCornerPosts(halfWidth, halfLength);
  }

  private hoarding(repeat: number): Material {
    const map = stadiumWall().clone();
    map.needsUpdate = true;
    map.repeat.set(repeat, 1);
    this.textures.push(map);
    return toon(0xffffff, { map });
  }

  /**
   * A flat coping along the top of every wall - white, with a gold lip.
   *
   * The copings span exactly the runs of the walls they cap, so no two of
   * them overlap.
   */
  private buildCoping(halfWidth: number, halfLength: number): void {
    const material = toon(WORLD_COLORS.white);
    const width = SPAWN_WALLS.thickness + COPING_OVERHANG * 2;
    const y = SPAWN_PLATFORM.topY + SPAWN_WALLS.height + COPING_HEIGHT / 2;

    const leftGeometry = new BoxGeometry(width, COPING_HEIGHT, SPAWN_PLATFORM.length);
    this.geometries.push(leftGeometry);
    const left = new Mesh(leftGeometry, material);
    left.position.set(halfWidth - SPAWN_WALLS.thickness / 2, y, SPAWN_PLATFORM.centerZ);
    left.castShadow = true;
    this.root.add(left);

    const backGeometry = new BoxGeometry(SPAWN_PLATFORM.width, COPING_HEIGHT, width);
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
    const mouthGeometry = new BoxGeometry(span, COPING_HEIGHT, width);
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
    // Navy pillars, each wearing a white cap with a gold band.
    const material = toon(WORLD_COLORS.navy);
    const capMaterial = toon(WORLD_COLORS.white);

    const size = SPAWN_WALLS.thickness + 1.1;
    const height = SPAWN_WALLS.height + 1.4;
    const geometry = new BoxGeometry(size, height, size);
    const capGeometry = new BoxGeometry(size + 0.3, 0.7, size + 0.3);
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
      cap.position.set(x, SPAWN_PLATFORM.topY + height + 0.35, z);
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
