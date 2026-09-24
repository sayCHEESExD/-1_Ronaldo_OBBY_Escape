/**
 * Third-person camera tuning. Lives in shared config so gameplay code can
 * reason about camera framing without importing the renderer.
 */
export interface CameraConfig {
  /** Distance behind the player, in world units - the default framing. */
  readonly distance: number;
  /** Closest and farthest the mouse wheel may zoom the camera. */
  readonly minDistance: number;
  readonly maxDistance: number;
  /** Height above the player's feet that the camera sits at. */
  readonly height: number;
  /** Height above the player's feet that the camera looks at. */
  readonly lookAtHeight: number;
  /** Positional smoothing factor per second (higher = snappier). */
  readonly followLerp: number;
  /** Vertical field of view in degrees. */
  readonly fov: number;
  readonly near: number;
  readonly far: number;
}

/**
 * Pulled back and raised for the gorge: the player needs to read the next
 * platform gap, the trophy pad ahead and any redline strung across the route
 * before committing to a jump.
 */
export const CAMERA: CameraConfig = {
  distance: 13.5,
  minDistance: 6,
  maxDistance: 22,
  height: 7,
  lookAtHeight: 3.4,
  followLerp: 7,
  fov: 64,
  near: 0.1,
  far: 1400,
};
