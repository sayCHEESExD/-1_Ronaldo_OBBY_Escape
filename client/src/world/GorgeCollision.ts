/**
 * The gorge's collision model now lives in `@obby/shared` as `WorldCollision`,
 * because the SERVER re-simulates movement against the very same object. A
 * second copy on the client would be a source of desync, so this module only
 * re-exports it under the name the rest of the client already uses.
 */
export { WorldCollision as GorgeCollision, type GorgeTriggers } from '@obby/shared';
