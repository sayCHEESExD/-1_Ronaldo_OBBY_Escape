/**
 * A player's Bloxity avatar LOOK, as replicated to everyone else in the room.
 *
 * Cosmetic and client-supplied, exactly like the display name: it decides how
 * a character is dressed on other screens and NOTHING else. No outcome may
 * read it. The server only cleans its shape - known id characters, finite
 * proportions clamped to the portal's own limits - so a forged value can at
 * worst dress a character oddly, never reach anything that matters.
 *
 * One compact string rather than a schema of fifteen fields: it changes only
 * when someone re-dresses, and a single field keeps the state patch small.
 * Only catalog IDS travel - never a model or a texture. Every client fetches
 * the assets for those ids from Bloxity's CDN itself.
 *
 *   skin|hat|back|head|torso|armL|armR|legL|legR|height,shoulderWidth,...
 *
 * The six part ids are the SDK's `headId`, `torsoId`, `armLId`, `armRId`,
 * `legLId` and `legRId`: which Bloxity body-part model fills each slot.
 *
 * An empty id means "nothing chosen", which for the SKIN is Bloxity's default
 * avatar - resolved by `resolveBloxitySkin`, never by a local texture.
 */

/** Proportion keys, in wire order. */
export const AVATAR_PROPORTION_KEYS = [
  'height',
  'shoulderWidth',
  'armLength',
  'legOffsetX',
  'torsoScaleX',
  'neckHeight',
  'headScale',
] as const;

export type AvatarProportionKey = (typeof AVATAR_PROPORTION_KEYS)[number];
export type AvatarProportions = Record<AvatarProportionKey, number>;

/** Every proportion is a multiplier around 1. */
export const DEFAULT_AVATAR_PROPORTIONS: Readonly<AvatarProportions> = {
  height: 1,
  shoulderWidth: 1,
  armLength: 1,
  legOffsetX: 1,
  torsoScaleX: 1,
  neckHeight: 1,
  headScale: 1,
};

/** The portal's own limits, so every side clamps identically. */
export const AVATAR_PROPORTION_RANGE: Readonly<Record<AvatarProportionKey, readonly [number, number]>> = {
  height: [0.5, 1.6],
  shoulderWidth: [0.5, 1.5],
  armLength: [0.05, 3],
  legOffsetX: [-0.7, 5],
  torsoScaleX: [0.3, 2],
  neckHeight: [0.94, 1.2],
  headScale: [0.3, 2.6],
};

export interface AvatarLook {
  /** Skin id, or '' for Bloxity's default avatar. */
  readonly skin: string;
  /** Hat id, or '' for none. */
  readonly hat: string;
  /** Back item id, or '' for none. */
  readonly back: string;
  /** Body-part model per slot, or '' for Bloxity's default part in that slot. */
  readonly parts: AvatarParts;
  readonly proportions: AvatarProportions;
}

/** The six swappable body-part slots, in wire order. */
export const AVATAR_PART_SLOTS = ['head', 'torso', 'armL', 'armR', 'legL', 'legR'] as const;
export type AvatarPartSlot = (typeof AVATAR_PART_SLOTS)[number];
export type AvatarParts = Readonly<Record<AvatarPartSlot, string>>;

/** Every slot on Bloxity's default part. */
export const DEFAULT_AVATAR_PARTS: AvatarParts = {
  head: '',
  torso: '',
  armL: '',
  armR: '',
  legL: '',
  legR: '',
};

/** Longest encoded look the server will accept. */
export const AVATAR_LOOK_MAX = 400;

/** Ids are short CDN path segments. Anything else is dropped as "none". */
const AVATAR_ID = /^[A-Za-z0-9_-]{1,32}$/;

/**
 * Whether an id means "something is equipped here".
 *
 * The SDK uses several spellings for empty across slots and environments.
 */
export const isAvatarIdSet = (id: unknown): id is string =>
  typeof id === 'string' && id !== '' && id !== '-1' && id !== 'undefined' && id !== 'null';

const cleanId = (id: unknown): string => (isAvatarIdSet(id) && AVATAR_ID.test(id) ? id : '');

/**
 * The skin Bloxity itself renders for an id.
 *
 * Mirrors the SDK's own rule (its customizer's `skinSeg` and `getAvatarPfpPath`
 * both do this): an unset skin IS skin "0", Bloxity's default avatar. The
 * default is therefore a real Bloxity texture like any other, and the game's
 * bundled texture is never the answer to "which skin is this player wearing".
 */
export const resolveBloxitySkin = (id: unknown): string => cleanId(id) || '0';

/** Fill in and clamp a partial proportions object. */
export const clampAvatarProportions = (
  raw: Partial<Record<AvatarProportionKey, unknown>> | null | undefined,
): AvatarProportions => {
  const out: AvatarProportions = { ...DEFAULT_AVATAR_PROPORTIONS };
  if (!raw) return out;
  for (const key of AVATAR_PROPORTION_KEYS) {
    const value = raw[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    const [min, max] = AVATAR_PROPORTION_RANGE[key];
    out[key] = Math.min(Math.max(value, min), max);
  }
  return out;
};

/** Encode a look for the wire. */
export const encodeAvatarLook = (look: AvatarLook): string =>
  [
    cleanId(look.skin),
    cleanId(look.hat),
    cleanId(look.back),
    ...AVATAR_PART_SLOTS.map((slot) => cleanId(look.parts[slot])),
    AVATAR_PROPORTION_KEYS.map((key) => Number(look.proportions[key].toFixed(3))).join(','),
  ].join('|');

/**
 * Decode AND clean a look from the wire. Never throws: anything malformed
 * comes back as the default look, which is Bloxity's default avatar.
 */
export const parseAvatarLook = (raw: unknown): AvatarLook => {
  const text = typeof raw === 'string' && raw.length <= AVATAR_LOOK_MAX ? raw : '';
  const fields = text.split('|');
  const [skin, hat, back] = fields;
  const numbers = fields[3 + AVATAR_PART_SLOTS.length];
  const parts = {} as Record<AvatarPartSlot, string>;
  AVATAR_PART_SLOTS.forEach((slot, i) => {
    parts[slot] = cleanId(fields[3 + i]);
  });
  const values = (numbers ?? '').split(',').map((v) => (v === '' ? Number.NaN : Number(v)));
  const partial: Partial<Record<AvatarProportionKey, number>> = {};
  AVATAR_PROPORTION_KEYS.forEach((key, i) => {
    const value = values[i];
    if (value !== undefined && Number.isFinite(value)) partial[key] = value;
  });
  return {
    skin: cleanId(skin),
    hat: cleanId(hat),
    back: cleanId(back),
    parts,
    proportions: clampAvatarProportions(partial),
  };
};

/** Re-encode through the parser: the server's whole validation step. */
export const cleanAvatarLook = (raw: unknown): string => encodeAvatarLook(parseAvatarLook(raw));
