/**
 * Visual palette and tuning for the anime Japanese mountain world.
 *
 * Colour and presentation only - every coordinate, gap and reward lives in
 * `@obby/shared`'s gorge config and is untouched by anything here. The world
 * is ink black, lacquer red, cream, sakura pink and moss green, lit through a
 * cel-shading ramp (`world/ToonKit.ts`) so it reads as anime rather than as
 * a recoloured obby.
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
  /** Stylised grass on the rims and the shrine grounds. */
  grass: '#79b64a',
  grassDark: '#5c9a38',
  grassLight: '#9ccf5e',
  /** Compound wall: cream plaster over a dark timber base. */
  plaster: '#f3e8d2',
  plasterLine: '#dccfb4',
  timber: 0x3a2a22,
  /** Tiled roofs - kawara, blue-grey slate. */
  roofTile: 0x3c4458,
  /** Vermilion lacquer: torii, pillars, bridges. */
  vermilion: 0xe0412c,
  lacquerRed: 0xb3261e,
  /** Ink black trim. */
  ink: 0x1b1416,
  /** Gold leaf and finials. */
  gold: 0xf2c14e,
  /** Stone lanterns and path stones. */
  stone: 0xa7a293,
  stoneDark: 0x7c786c,
  /** Paper lantern glow. */
  lanternGlow: 0xffb35c,
  /** Sakura blossom and bark. */
  sakura: 0xffb3cf,
  sakuraDeep: 0xf57fa8,
  bark: 0x5a3b2e,
  /** Japanese black pine. */
  pine: 0x3f7a45,
  /** Autumn maple, late route. */
  maple: 0xe8472e,
  /** Bamboo culms and leaves. */
  bamboo: 0x7fbf4a,
  /** Hazard lines. Kept pure red - a hazard must never become decoration. */
  redline: 0xff2b2b,
  /** Win Shop pedestal stands. */
  collectionPad: 0xc8281e,
  /** Fallback fog colour; the live one is driven by `SkyAtmosphere`. */
  sky: 0xffd9e2,
} as const;

/** How an island's deck surface is drawn. */
export type DeckStyle = 'planks' | 'stone' | 'lacquer';

/** Route stage: the world grows more dramatic the further the player goes. */
export type RouteStage = 'early' | 'mid' | 'late';

/** Presentation for one island. Identity (the key) and gameplay stay in shared. */
export interface AreaTheme {
  /** English display name - gameplay information stays readable. */
  readonly name: string;
  /** Japanese title painted on the island plaque. */
  readonly kanji: string;
  /** Tint of the island's deck. */
  readonly deck: number;
  readonly deckStyle: DeckStyle;
  readonly stage: RouteStage;
}

const early = (name: string, kanji: string, deck: number): AreaTheme => ({
  name, kanji, deck, deckStyle: 'planks', stage: 'early',
});
const mid = (name: string, kanji: string, deck: number): AreaTheme => ({
  name, kanji, deck, deckStyle: 'stone', stage: 'mid',
});
const late = (name: string, kanji: string, deck: number): AreaTheme => ({
  name, kanji, deck, deckStyle: 'lacquer', stage: 'late',
});

/**
 * Per-island presentation, keyed by the SHARED area name.
 *
 * The shared name is the island's identity and is never shown any more; the
 * player sees `name` and `kanji` instead. Keeping the key means the server,
 * the route and every reward are exactly as they were.
 *
 * Sakura gardens and shrine paths first, then mountain cliffs, bamboo and
 * waterfalls, then floating shrines under a darkening sky.
 */
export const AREA_THEMES: Readonly<Record<string, AreaTheme>> = {
  'Starter Area': early('Sakura Gate', '桜門', 0xf2c9a4),
  'Cloud Area': early('Shrine Path', '参道', 0xeab98c),
  'Volcano Area': early('Lantern Walk', '灯籠', 0xe2aa7a),
  'Tsunami Area': early('Koi Pond', '鯉池', 0xdba272),
  'Hot Area': early('Maple Bridge', '紅葉橋', 0xe49c76),
  'Nature Area': early('Tea Garden', '茶庭', 0xcaa56c),
  'Crystal Area': early('Moon Garden', '月庭', 0xdab690),
  'Thunder Area': early('Plum Grove', '梅林', 0xe2a4a4),
  'Ancient Area': early('Dojo Steps', '道場', 0xcb9162),
  'Space Island': early('Temple Gate', '山門', 0xda8a72),
  'Nebula Area': mid('Bamboo Grove', '竹林', 0xbcc49c),
  'Comet Area': mid('Misty Cliffs', '霧崖', 0xb8bcb4),
  'Meteor Area': mid('Waterfall Ledge', '滝', 0xaec0c4),
  'Orbit Area': mid('Crane Peak', '鶴峰', 0xc8c6b8),
  'Galaxy Area': mid('Stone Stairs', '石段', 0xb4ae9f),
  'Quasar Area': mid('Cedar Ridge', '杉尾根', 0xaab292),
  'Pulsar Area': mid('Mountain Pass', '峠', 0xbeb4a4),
  'Vortex Area': mid('Fox Shrine', '稲荷', 0xdaa484),
  'Eclipse Area': mid('Cloud Temple', '雲寺', 0xccd0d8),
  'Aurora Area': mid('Thunder Ridge', '雷峰', 0xbcb894),
  'Supernova Area': mid('Dragon Spine', '龍背', 0xa3b4a4),
  'Blackhole Area': mid('Wind Pass', '風道', 0xc0c8c4),
  'Wormhole Area': mid('Hermit Cave', '仙洞', 0xaca294),
  'Andromeda Area': mid('Snow Summit', '雪峰', 0xe4e8ec),
  'Titan Area': mid('Spirit Falls', '霊滝', 0xacc8d0),
  'Cosmos Area': late('Floating Shrine', '浮宮', 0xc8281e),
  'Singularity Area': late('Sky Torii', '天鳥居', 0xd23a26),
  'Infinity Area': late('Crimson Hall', '紅殿', 0xb01e2a),
  'Oblivion Area': late('Storm Gate', '嵐門', 0x8a2a3a),
  'Eternity Area': late('Phoenix Nest', '鳳凰', 0xe0562a),
  'Zenith Area': late('Starfall Shrine', '星社', 0x4a3468),
  'Abyss Area': late('Moon Palace', '月宮', 0x54428a),
  'Radiance Area': late('Oni Gate', '鬼門', 0x7a1426),
  'Chronos Area': late('Spirit Realm', '霊界', 0x2e5476),
  'Elysium Area': late('Heaven Bridge', '天橋', 0x962e62),
  'Genesis Area': late('Eclipse Temple', '蝕寺', 0x3a2334),
  'Paragon Area': late('Dragon Palace', '龍宮', 0x1e6060),
  'Empyrean Area': late('Void Shrine', '虚社', 0x2a1838),
  'Everlast Area': late('Celestial Peak', '天峰', 0x62428e),
  'Apex Area': late('Limit Break', '限界突破', 0xd4a020),
};

/** Fallback for an area with no theme entry. */
export const DEFAULT_AREA_THEME: AreaTheme = early('Shrine Isle', '島', 0xdab690);

/** Thickness of the deck laid over each island. */
export const AREA_DECK_THICKNESS = 0.18;

/** Height of the floating island plaque above the island surface. */
export const AREA_LABEL_HEIGHT = 11;

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
 * Four training machines, reading as a ladder from plain dojo wood up to a
 * gold-lit one. Colour, glow and belt speed climb together.
 */
export const TREADMILL_THEMES: readonly TreadmillTheme[] = [
  { accent: 0xb88a5c, belt: 0xcdbb8a, intensity: 0 },
  { accent: 0xc2783a, belt: 0xc4ae7c, intensity: 0.12 },
  { accent: 0xe8e0d0, belt: 0xbfb088, intensity: 0.25 },
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
