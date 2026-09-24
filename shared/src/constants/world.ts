import type { Vec3 } from '../types/math.js';

/**
 * World-space constants shared by the renderer and the authoritative server.
 *
 * Units are "world units" (1 unit ~= 1 Roblox stud in feel). The supplied
 * player.fbx is authored at 320 units tall, so it is scaled down on load.
 */

/** Multiplier applied to the loaded FBX so the character is PLAYER_HEIGHT tall. */
export const FBX_TO_WORLD_SCALE = 0.01;

/** Resulting character height in world units (320 * FBX_TO_WORLD_SCALE). */
export const PLAYER_HEIGHT = 3.2;

/** Approximate character radius, used for future collision work. */
export const PLAYER_RADIUS = 0.7;

/**
 * The gorge runs along +Z. Players travel *along* this axis and never across
 * it; X is clamped to the walkable channel between the (inaccessible) banks.
 */
export const GORGE_FORWARD_AXIS = 'z' as const;

/** Spawn transform at the mouth of the gorge. */
export const SPAWN_POSITION: Readonly<Vec3> = { x: 0, y: 0, z: 0 };

/** Spawn yaw in radians (facing +Z, down the gorge). */
export const SPAWN_ROTATION_Y = 0;

/**
 * Y below which a player has fallen into the blue gorge floor (a death zone)
 * and is respawned at SPAWN_POSITION. Sits above GORGE.pitFloorY so the fall
 * reads as landing in the gorge rather than passing through it.
 */
export const DEATH_PLANE_Y = -9;
