/**
 * @obby/shared - the single source of truth for anything that must be
 * byte-for-byte identical between the client and the authoritative server.
 *
 * Nothing in here may import from `three`, `colyseus`, or the DOM.
 */
export * from './constants/network.js';
export * from './constants/world.js';
export * from './config/backflip.js';
export * from './config/auras.js';
export * from './config/avatarLook.js';
export * from './config/boots.js';
export * from './config/bloxity.js';
export * from './config/bux.js';
export * from './config/leaderboard.js';
export * from './config/movement.js';
export * from './config/camera.js';
export * from './config/gorge.js';
export * from './config/progression.js';
export * from './config/progressionGain.js';
export * from './config/rebirth.js';
export * from './config/speed.js';
export * from './config/trails.js';
export * from './config/treadmills.js';
export * from './types/math.js';
export * from './types/player.js';
export * from './types/messages.js';
export * from './sim/WorldCollision.js';
export * from './sim/PlayerSim.js';
