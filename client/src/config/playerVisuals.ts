/**
 * Visual tuning for the player character. Data-driven so the model can be
 * re-authored without touching gameplay code.
 */

/**
 * Yaw correction applied to the FBX model inside its container, in radians.
 *
 * player.fbx already faces +Z after FBXLoader applies the export's -90 deg X
 * correction, and the game also treats +Z as "forward" (down the gorge), so no
 * correction is needed. Verified visually against the running client.
 */
export const PLAYER_MODEL_YAW_OFFSET = 0;
