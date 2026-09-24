import type { StoredProfile } from './PersistenceAdapter.js';

/**
 * Turn whatever storage handed back into a `StoredProfile`, safely.
 *
 * Used by BOTH adapters, so a profile means the same thing whichever one read
 * it. Every known number is validated (a bad or missing one becomes its
 * default, which is what an older profile without that field meant anyway),
 * strings are capped, and every field this build does NOT know about is
 * carried through untouched rather than silently dropped.
 *
 * Returns null for something that is not an object at all.
 */
export const decodeProfile = (raw: unknown): StoredProfile | null => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const { _id: _ignored, ...rest } = value;

  const profile: StoredProfile = {
    ...(rest as Partial<StoredProfile>),
    totalSpeed: numeric(value['totalSpeed'], 0),
    wins: whole(value['wins'], 0),
    rebirths: whole(value['rebirths'], 0),
    // The starter boot is free, so a profile without the field owns it.
    ownedBoots: whole(value['ownedBoots'], 1),
    ownedTrails: whole(value['ownedTrails'], 0),
    trailSlot: whole(value['trailSlot'], 0),
    ownedAuras: whole(value['ownedAuras'], 0),
    auraSlot: whole(value['auraSlot'], 0),
    legionName: typeof value['legionName'] === 'string' ? value['legionName'].slice(0, 32) : '',
    legionPfp: typeof value['legionPfp'] === 'string' ? value['legionPfp'].slice(0, 600) : '',
    updatedAt: updatedAt(value['updatedAt']),
  };
  text(profile, value, 'migratedTo');
  text(profile, value, 'migratedFrom');
  const applied = value['buxApplied'];
  if (Array.isArray(applied)) {
    profile.buxApplied = applied.filter((id): id is string => typeof id === 'string' && id !== '');
  } else {
    delete profile.buxApplied;
  }
  return profile;
};

const numeric = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;

const whole = (value: unknown, fallback: number): number => Math.floor(numeric(value, fallback));

/** Epoch ms. MongoDB documents written by an earlier build carry a Date. */
const updatedAt = (value: unknown): number => {
  if (value instanceof Date) return value.getTime();
  return numeric(value, 0);
};

const text = (
  profile: StoredProfile,
  value: Record<string, unknown>,
  field: 'migratedTo' | 'migratedFrom',
): void => {
  const raw = value[field];
  if (typeof raw === 'string' && raw) profile[field] = raw.slice(0, 200);
  else delete profile[field];
};
