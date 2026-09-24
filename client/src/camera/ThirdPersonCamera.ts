import { CAMERA } from '@obby/shared';
import { PerspectiveCamera, Vector3 } from 'three';

/**
 * Extra distance the camera starts a respawn from, in world units.
 *
 * This is a DELIBERATE effect, and it is not the artefact it replaced. The old
 * zoom came from the follow point easing across the respawn gap, so the camera
 * drifted through every position between where the player died and spawn. This
 * moves only the DISTANCE along the camera's own axis: the follow point is
 * already at spawn on the first frame, so the shot is framed correctly
 * throughout and simply pulls in. Set to 0 to remove it.
 */
const RESPAWN_ZOOM_DISTANCE = 9;

/** How fast that extra distance is given up. Higher is snappier. */
const RESPAWN_ZOOM_RATE = 6.5;

/** How fast the camera eases to a wheel-zoom distance. Higher is snappier. */
const WHEEL_ZOOM_RATE = 12;

const FORWARD = new Vector3();
const LOOK_TARGET = new Vector3();
const OFFSET = new Vector3();

/**
 * Third-person orbit camera.
 *
 * The camera owns its OWN yaw and pitch, supplied by the mouse, and the player
 * supplies only a position to orbit. That separation is the whole point: it
 * used to trail the player's facing, so pressing A turned the character, which
 * turned the camera, which turned what "forward" meant - the classic feedback
 * loop where WASD ends up steering the view.
 *
 * The movement controller rotates its stick input by `yaw`, so the camera is
 * the single source of "which way is forward" and the character's own facing
 * follows where it is actually going.
 */
export class ThirdPersonCamera {
  readonly camera: PerspectiveCamera;

  private readonly target = new Vector3();
  /** Smoothed point the camera orbits. The only thing that is smoothed. */
  private readonly followed = new Vector3();
  /** Orbit angles, written by the mouse. */
  private orbitYaw = 0;
  private orbitPitch = 0.22;
  private initialised = false;
  /** Extra distance still to be given up by the respawn dolly. */
  private zoomOffset = 0;
  /** Orbit distance: eased toward `targetDistance`, set by the wheel. */
  private orbitDistance = CAMERA.distance;
  private targetDistance = CAMERA.distance;

  constructor() {
    this.camera = new PerspectiveCamera(CAMERA.fov, 1, CAMERA.near, CAMERA.far);
    this.camera.position.set(0, CAMERA.height, -CAMERA.distance);
  }

  /** Called by RendererManager whenever the drawing buffer changes size. */
  setViewport(width: number, height: number): void {
    this.camera.aspect = width / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
  }

  /** The direction the camera faces. This is what "forward" means. */
  get yaw(): number {
    return this.orbitYaw;
  }

  /** Follow this player position. The camera's own angles are unchanged. */
  setTarget(position: Vector3): void {
    this.target.copy(position);
  }

  /**
   * Arrive at a position instead of easing to it. Used for a PLACEMENT.
   *
   * The smoothing exists to absorb a player who MOVED; a respawn or a server
   * correction is a player who was PLACED, and easing across that gap is what
   * produced the original zoom artefact - the camera position and the look
   * target are both derived from the follow point, so while it lagged the
   * camera sat a whole map behind a player who had already arrived.
   *
   * @param zoomIn play the respawn dolly. TRUE only for a respawn; a network
   *               correction must arrive invisibly, not announce itself.
   */
  snapTo(position: Vector3, zoomIn = false): void {
    this.target.copy(position);
    this.followed.copy(position);
    this.initialised = true;
    this.zoomOffset = zoomIn ? RESPAWN_ZOOM_DISTANCE : 0;
  }

  /**
   * Aim the orbit. Called every frame from the mouse look source.
   *
   * @param distance how far out to orbit, from the mouse wheel. Clamped to the
   *                 camera limits; omitted, the default framing.
   */
  setOrbit(yaw: number, pitch: number, distance: number = CAMERA.distance): void {
    this.orbitYaw = yaw;
    this.orbitPitch = pitch;
    this.targetDistance = Number.isFinite(distance)
      ? Math.min(Math.max(distance, CAMERA.minDistance), CAMERA.maxDistance)
      : CAMERA.distance;
  }

  update(delta: number): void {
    // ONE smoothing stage, applied to the point the camera follows.
    //
    // The camera position used to be smoothed while the look target was taken
    // raw, so any jitter in the player's transform rotated the view directly
    // even though the position absorbed it - the two disagreed every frame,
    // which is exactly what reads as vibration. Smoothing the followed POINT
    // and deriving both the position and the look target from it means they
    // can no longer disagree.
    if (!this.initialised) {
      this.followed.copy(this.target);
      this.initialised = true;
    } else {
      // Frame-rate independent exponential smoothing.
      this.followed.lerp(this.target, 1 - Math.exp(-CAMERA.followLerp * delta));
    }

    // Give up the respawn dolly's extra distance. Frame-rate independent, and
    // snapped to zero once it stops being visible so it cannot linger.
    if (this.zoomOffset > 0) {
      this.zoomOffset *= Math.exp(-RESPAWN_ZOOM_RATE * delta);
      if (this.zoomOffset < 0.01) this.zoomOffset = 0;
    }
    // Ease to the wheel's distance so a notch glides rather than jumps.
    this.orbitDistance +=
      (this.targetDistance - this.orbitDistance) * (1 - Math.exp(-WHEEL_ZOOM_RATE * delta));
    const distance = this.orbitDistance + this.zoomOffset;
    // The lift scales with the zoom so zooming keeps the same angle onto the
    // player; at the default distance it is exactly `CAMERA.height`.
    const height = CAMERA.height * (this.orbitDistance / CAMERA.distance);

    // Where the camera sits: back along its own yaw, lifted by its pitch. The
    // pitch shortens the horizontal reach as it rises, so the camera swings
    // over the player rather than sliding away from them.
    const cosPitch = Math.cos(this.orbitPitch);
    const sinPitch = Math.sin(this.orbitPitch);

    FORWARD.set(Math.sin(this.orbitYaw) * cosPitch, 0, Math.cos(this.orbitYaw) * cosPitch);

    // Applied directly, not lerped again: the look angles must never lag the
    // mouse, and the follow point is already smooth.
    this.camera.position
      .copy(this.followed)
      .addScaledVector(FORWARD, -distance)
      .add(OFFSET.set(0, height + sinPitch * distance, 0));

    LOOK_TARGET.copy(this.followed).add(OFFSET.set(0, CAMERA.lookAtHeight, 0));
    this.camera.lookAt(LOOK_TARGET);
  }
}
