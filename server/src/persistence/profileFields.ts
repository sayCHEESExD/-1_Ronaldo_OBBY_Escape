import type { StoredProfile } from './PersistenceAdapter.js';

/**
 * The optional fields a save is allowed to CLEAR.
 *
 * For these, "absent" is a real value - a guest profile that is being played
 * again is no longer `migratedTo` anywhere. Every OTHER field a stored profile
 * carries that this build does not know about is left exactly as it was.
 */
export const CLEARABLE_FIELDS = ['migratedTo', 'migratedFrom'] as const;

/**
 * Apply a save onto what was stored, in memory: unknown fields survive, known
 * ones take the new values, clearable ones are dropped when the save omits them.
 */
export const writeProfileFields = (
  existing: StoredProfile | undefined,
  profile: StoredProfile,
): StoredProfile => {
  const next: Record<string, unknown> = { ...(existing ?? {}) };
  for (const field of CLEARABLE_FIELDS) delete next[field];
  for (const [field, value] of Object.entries(profile)) {
    if (value !== undefined) next[field] = value;
  }
  return next as unknown as StoredProfile;
};

/**
 * The same rule as a MongoDB update: `$set` what the save carries, `$unset`
 * the clearable fields it does not. Nothing else in the document is mentioned,
 * so nothing else is touched.
 */
export const profileUpdate = (
  profile: StoredProfile,
): { $set: Record<string, unknown>; $unset?: Record<string, ''> } => {
  const $set: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(profile)) {
    if (value !== undefined && field !== '_id') $set[field] = value;
  }
  const $unset: Record<string, ''> = {};
  for (const field of CLEARABLE_FIELDS) {
    if ($set[field] === undefined) $unset[field] = '';
  }
  return Object.keys($unset).length > 0 ? { $set, $unset } : { $set };
};
