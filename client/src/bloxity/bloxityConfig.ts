/**
 * Bloxity integration configuration.
 *
 * Data only, like every other config in this project. The slug, the CDN layout
 * and the settings this game actually honours are declared once here so the
 * bridge reads them instead of hard-coding strings at each call site.
 */

import {
  BLOXITY_GAME_SLUG,
  DEFAULT_AVATAR_PROPORTIONS,
  clampAvatarProportions,
  AVATAR_PROPORTION_KEYS,
  isAvatarIdSet,
  type AvatarLook,
  type AvatarPartSlot,
} from '@obby/shared';
import type { LegionProportions } from './sdkTypes.js';

/**
 * The slug this game is registered under on bloxity.io (its /g/<slug> page).
 *
 * Always passed to `init`, even embedded, where the portal would supply it -
 * standalone hosting and every Bux purchase resolve their catalog by it. From
 * shared config, because the server verifies login tokens against the SAME
 * slug; the two disagreeing is what kept every signed-in player a guest.
 */
export const GAME_SLUG = BLOXITY_GAME_SLUG;

/**
 * Optional portal and API overrides, for local development only.
 *
 * The SDK normally resolves both itself, and that is what ships: unset, it
 * uses bloxity.io and api.bloxity.io. There is one exception it makes on its
 * own - served from localhost with neither URL given, it points BOTH at the
 * local origin, on the assumption that a developer running the game locally is
 * running the portal locally too. This game is not, so login on a dev machine
 * would open `http://localhost:5173/auth`, which does not exist.
 *
 * Setting `VITE_BLOXITY_PORTAL_URL=https://bloxity.io` (and the API to match)
 * makes the real portal reachable from a dev build. Leave both unset for
 * production, where the SDK's own defaults are correct.
 */
export const PORTAL_URL = (import.meta.env['VITE_BLOXITY_PORTAL_URL'] as string | undefined) ?? '';
export const API_URL = (import.meta.env['VITE_BLOXITY_API_URL'] as string | undefined) ?? '';

/** Avatar asset CDN root. */
export const AVATAR_CDN = 'https://static.bloxity.io/avatars';

/**
 * A Bloxity profile picture as a full URL.
 *
 * A signed-in account's `pfp` is a PATH (`/pfps/s0.png`) - only guest
 * pictures arrive as URLs. The SDK turns paths into URLs with exactly this
 * rule (`pfpUrlFromPath`); without it every signed-in player's picture was
 * rejected by the server, which only accepts https URLs on Bloxity's hosts.
 */
export const resolvePfpUrl = (pfp: string): string => {
  if (!pfp) return '';
  if (/^https?:\/\//i.test(pfp)) return pfp;
  const path = pfp.startsWith('/') ? pfp.slice(1) : pfp;
  return `https://static.bloxity.io/img/${path}?width=128&quality=85&v=2`;
};

/** The SDK's `encodeFloatForUrl`: 1 -> "1f0", 1.25 -> "1f25". */
const encodeFloat = (value: number): string => {
  const text = parseFloat(value.toFixed(4)).toString();
  return text.includes('.') ? text.replace('.', 'f') : `${text}f0`;
};

/**
 * The profile picture of a LOOK - Bloxity's render of exactly this avatar.
 *
 * Mirrors the SDK's `getAvatarPfpPath` (itself a copy of the portal's
 * `cdn.ts`, which the renderer parses, so the key format must match exactly)
 * and `pfpUrlFromPath`. The CDN renders any combination on demand, so the
 * picture on the scoreboards is always the avatar the player is wearing NOW -
 * a stored `pfp` field only changes when the account is re-read, which is why
 * the boards kept showing an old picture after the avatar changed.
 */
export const avatarPfpUrl = (look: AvatarLook): string => {
  const id = (value: string, fallback: string): string => value || fallback;
  let key = `s${id(look.skin, '0')}`;
  if (look.hat) key += `_h${look.hat}`;
  if (look.back) key += `_b${look.back}`;
  const hd = id(look.parts.head, '0');
  const aL = id(look.parts.armL, '0');
  const aR = id(look.parts.armR, '0');
  const lL = id(look.parts.legL, '0');
  const lR = id(look.parts.legR, '0');
  const to = id(look.parts.torso, '0');
  const values = AVATAR_PROPORTION_KEYS.map((name) => look.proportions[name]);
  const customParts = [hd, aL, aR, lL, lR, to].some((part) => part !== '0');
  const customShape = values.some((value) => Math.abs(value - 1) > 0.0001);
  if (customParts || customShape) {
    key += `_hd${hd}_aL${aL}_aR${aR}_lL${lL}_lR${lR}_to${to}`;
    key += `_p${values.map(encodeFloat).join('-')}`;
  }
  return resolvePfpUrl(`/pfps/${key}.png`);
};

/** Body-part file per slot under `/parts`, `{id}` filled in by `partMesh`. */
const PART_FILES: Readonly<Record<AvatarPartSlot, string>> = {
  head: 'head/{id}.glb',
  torso: 'torso/{id}.glb',
  armL: 'arms/{id}_L.glb',
  armR: 'arms/{id}_R.glb',
  legL: 'legs/{id}_L.glb',
  legR: 'legs/{id}_R.glb',
};

/** Where each avatar slot's mesh and texture live under {@link AVATAR_CDN}. */
export const avatarUrls = {
  hatMesh: (id: string) => `${AVATAR_CDN}/items/hats/${id}.obj`,
  hatTexture: (id: string) => `${AVATAR_CDN}/textures/hats/${id}.png`,
  backMesh: (id: string) => `${AVATAR_CDN}/items/back/${id}.obj`,
  backTexture: (id: string) => `${AVATAR_CDN}/textures/back/${id}.png`,
  skinTexture: (id: string) => `${AVATAR_CDN}/skins/${id}.png`,
  /** Bloxity's base avatar body: one skeleton, six skinned part meshes. */
  baseBody: () => `${AVATAR_CDN}/player.glb`,
  /**
   * A body-part model, by the SDK's SLOT_FILE_INFO: heads and torsos are one
   * file, arms and legs are a left and a right file sharing one id.
   */
  partMesh: (slot: AvatarPartSlot, id: string) => `${AVATAR_CDN}/parts/${PART_FILES[slot]}`.replace('{id}', id),
  icon: (id: string) => `${AVATAR_CDN}/icons/${id}.png`,
} as const;

/**
 * Whether an id means "something is equipped here". One definition, shared
 * with the server's avatar-look parser.
 */
export const isEquipped = (id: string | null | undefined): id is string => isAvatarIdSet(id);

/** Proportion defaults, applied to anything the portal has not set. */
export const DEFAULT_PROPORTIONS: Required<LegionProportions> = { ...DEFAULT_AVATAR_PROPORTIONS };

/**
 * Fill in and clamp a partial proportions object, to the portal's own limits
 * (`AVATAR_PROPORTION_RANGE` in shared, which the server clamps to as well).
 *
 * The SDK returns `{}` for a player who has never opened the customizer, so
 * every consumer would otherwise have to spell out seven fallbacks - and one
 * missed fallback multiplies a bone scale by `undefined`.
 */
export const resolveProportions = (
  raw: LegionProportions | null | undefined,
): Required<LegionProportions> => clampAvatarProportions(raw);

/**
 * The portal settings this game honours.
 *
 * Registering a listener is also what makes a control APPEAR in the portal
 * menu, so this list is the game's advertised settings surface - not just the
 * ones it reads. Only keys with a real effect below are listed; advertising a
 * control the game ignores is worse than not offering it.
 */
export const SETTING_KEYS = [
  'master_volume',
  'music_volume',
  'graphics_quality',
  'show_fps',
  'camera_sensitivity',
  'enable_chat',
  'fullscreen',
  'background_transparency',
] as const;

export type SettingKey = (typeof SETTING_KEYS)[number];

/** Parse a "true"/"false" setting. Every portal setting arrives as a string. */
export const settingBool = (value: string, fallback = false): boolean => {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
};

/** Parse a numeric setting, falling back when the portal sends nonsense. */
export const settingNumber = (value: string, fallback: number): number => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
