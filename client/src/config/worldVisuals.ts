/**
 * Visual palette and tuning for the football world.
 *
 * Colour and presentation only - every coordinate, gap and reward lives in
 * `@obby/shared`'s gorge config and is untouched by anything here. The world
 * is club red, pitch green, kit white, navy and trophy gold over the same
 * gorge, lit through a cel-shading ramp (`world/ToonKit.ts`) so it keeps its
 * bright cartoon read.
 */
export const WORLD_COLORS = {
  /** The river running the gorge floor. Still the death zone; now it flows. */
  water: '#2f9fd6',
  waterDeep: '#1f73b8',
  waterFoam: 'rgba(235,250,255,0.75)',
  /** Stratified cliff rock on the canyon walls and the headland. */
  rock: '#8a7f73',
  rockDark: '#5f564e',
  rockLight: '#a89c8c',
  rockMoss: '#6f9a4a',
  /** Stylised grass on the rims and the stadium grounds. */
  grass: '#79b64a',
  grassDark: '#5c9a38',
  grassLight: '#9ccf5e',
  /** Club and country colours. */
  red: 0xc8102e,
  green: 0x1f9d55,
  white: 0xf4f6fb,
  navy: 0x14203a,
  /** Ink black trim. */
  ink: 0x15171c,
  /** Trophy gold. */
  gold: 0xf2c14e,
  /** Floodlight masts, rails and stanchions. */
  steel: 0x9aa3b2,
  /** Stadium concrete. */
  concrete: 0x8f98a8,
  /** Boulders and plinths. */
  stone: 0xa7a293,
  stoneDark: 0x7c786c,
  /** Floodlight glow. */
  lampGlow: 0xfff4d6,
  /** Broadleaf canopies and bark. */
  leaf: 0x5fae4a,
  leafDeep: 0x3f8f3a,
  leafLight: 0x8cc85c,
  bark: 0x5a3b2e,
  /** Pines along the rims. */
  pine: 0x3f7a45,
  /** Autumn canopy, late route. */
  autumn: 0xe8872e,
  /** Hazard lines. Kept pure red - a hazard must never become decoration. */
  redline: 0xff2b2b,
  /** Win Shop pedestal stands. */
  collectionPad: 0xc8281e,
  /** Fallback fog colour; the live one is driven by `SkyAtmosphere`. */
  sky: 0xcfe8ff,
} as const;

/** Route stage: the world grows more dramatic the further the player goes. */
export type RouteStage = 'early' | 'mid' | 'late';

/**
 * Presentation for one island. Identity (the key) and gameplay stay in shared.
 *
 * Every island is the same bright pitch grass now, and no sign hangs over
 * any of them - the name plaques blocked the flight path. The names stay as
 * the route's story, and `stage` still grades the scenery along it.
 */
export interface AreaTheme {
  /** The island's name in his story. Not currently shown anywhere. */
  readonly name: string;
  /** The chapter of his story it stands for. Not currently shown anywhere. */
  readonly subtitle: string;
  readonly stage: RouteStage;
}

const early = (name: string, subtitle: string): AreaTheme => ({ name, subtitle, stage: 'early' });
const mid = (name: string, subtitle: string): AreaTheme => ({ name, subtitle, stage: 'mid' });
const late = (name: string, subtitle: string): AreaTheme => ({ name, subtitle, stage: 'late' });

/**
 * Per-island presentation, keyed by the SHARED area name.
 *
 * The shared name is the island's identity and is never shown; the player
 * sees `name` and `subtitle` instead. Keeping the key means the server, the
 * route and every reward are exactly as they were.
 *
 * The route is his career: the streets of Madeira and the academy first, then
 * the great clubs and the records, then beyond anything a footballer has done
 * under a sky that darkens into night-match floodlight.
 */
export const AREA_THEMES: Readonly<Record<string, AreaTheme>> = {
  'Starter Area': early('Kick Off', 'The Journey Begins'),
  'Cloud Area': early('Madeira Streets', 'Where It Started'),
  'Volcano Area': early('Youth Academy', 'First Touch'),
  'Tsunami Area': early('Lisbon Lights', 'The Breakthrough'),
  'Hot Area': early('Step-Over Street', 'Skill School'),
  'Nature Area': early('Theatre of Dreams', 'The Red Devil'),
  'Crystal Area': early('Free-Kick Alley', 'Knuckleball'),
  'Thunder Area': early('Header Heights', 'Rise Higher'),
  'Ancient Area': early('Champions Night', 'First Big Trophy'),
  'Space Island': early('Golden Ball Gate', 'The First Gold'),
  'Nebula Area': mid('Galactico Steps', 'Madrid Calling'),
  'Comet Area': mid('Hat-Trick Hill', 'Three And Counting'),
  'Meteor Area': mid('Bicycle Kick Cliff', 'Overhead'),
  'Orbit Area': mid('European Nights', 'La Decima'),
  'Galaxy Area': mid('Golden Boot Pass', 'Top Scorer'),
  'Quasar Area': mid('Penalty Spot', 'Nerves Of Steel'),
  'Pulsar Area': mid('Derby Day', 'City Divided'),
  'Vortex Area': mid('Turin Towers', 'Bianconero'),
  'Eclipse Area': mid('Euro Glory', 'Champions Of Europe'),
  'Aurora Area': mid("Captain's Armband", 'Lead The Way'),
  'Supernova Area': mid('Record Breaker', 'Most Goals Ever'),
  'Blackhole Area': mid('Stoppage Time', 'Never Give Up'),
  'Wormhole Area': mid('Desert Stadium', 'Riyadh'),
  'Andromeda Area': mid('Nations League', 'Another Trophy'),
  'Titan Area': mid('Hall Of Fame', 'Immortal'),
  'Cosmos Area': late('Golden Dome', 'Five Golden Balls'),
  'Singularity Area': late('Crowd Roar', 'SIUUU!'),
  'Infinity Area': late('Trophy Room', 'No Space Left'),
  'Oblivion Area': late('Floodlight Summit', 'Under The Lights'),
  'Eternity Area': late('Final Whistle', 'Last-Minute Winner'),
  'Zenith Area': late('Galaxy Pitch', 'Beyond The Stars'),
  'Abyss Area': late('Moonlight Derby', 'Night Game'),
  'Radiance Area': late('Legend Lane', 'Greatest Ever'),
  'Chronos Area': late('Thousand Goals', 'Keep Counting'),
  'Elysium Area': late('Heaven Stadium', 'Sold Out'),
  'Genesis Area': late('Eclipse Arena', 'Total Darkness'),
  'Paragon Area': late('Diamond Pitch', 'Perfect Touch'),
  'Empyrean Area': late('Cosmic Cup', 'Out Of This World'),
  'Everlast Area': late('Celestial Final', 'The Last Match'),
  'Apex Area': late('GOAT Summit', 'Limit Break'),
};

/** Fallback for an area with no theme entry. */
export const DEFAULT_AREA_THEME: AreaTheme = early('Training Pitch', 'Practice');

/** Thickness of the grass laid over each island. */
export const AREA_DECK_THICKNESS = 0.18;

/** How one treadmill tier looks. Colour only - layout lives in shared. */
export interface TreadmillTheme {
  /** Frame, rails and rollers. */
  readonly accent: number;
  /** Belt tint. */
  readonly belt: number;
  /** 0..1 glow strength; drives emissive and the lit halo bar. */
  readonly intensity: number;
}

/**
 * Four training machines, reading as a ladder from plain gym steel up to a
 * gold-lit one. Colour, glow and belt speed climb together.
 */
export const TREADMILL_THEMES: readonly TreadmillTheme[] = [
  { accent: 0x9aa3b2, belt: 0x8a93a3, intensity: 0 },
  { accent: 0x2f6bff, belt: 0x7d8aa6, intensity: 0.12 },
  { accent: 0xf4f6fb, belt: 0x9aa0ae, intensity: 0.25 },
  { accent: 0xf2c14e, belt: 0xc9a864, intensity: 0.45 },
];

/** Theme for a tier, falling back to the starter look. */
export const treadmillTheme = (tier: number): TreadmillTheme =>
  TREADMILL_THEMES[tier - 1] ?? (TREADMILL_THEMES[0] as TreadmillTheme);

/** Colour of a deck the player has not unlocked yet. */
export const TREADMILL_LOCKED_COLOR = 0x4a3f3a;

/** Base fog distances. `SkyAtmosphere` eases them per stage. */
export const WORLD_FOG = {
  near: 180,
  far: 900,
} as const;
