/**
 * What each Ronaldo LOOKS like - one kit per tier slot.
 *
 * Presentation only. The economy of a tier (price, Speed per step, its slot)
 * lives in `@obby/shared`'s `BOOT_TIERS` and is untouched by anything here;
 * this file only answers "what does slot N wear". Everything is painted at
 * runtime onto the character atlas by `player/ronaldo/RonaldoSkin.ts`, so no
 * image file is shipped and nothing counts against the 12 MB budget.
 *
 * The kits are evocations of each era - colours, pattern and his number -
 * drawn without club crests or sponsor marks.
 */

/** How the shirt body is patterned. */
export type ShirtPattern =
  | 'plain'
  /** Horizontal bands. */
  | 'hoops'
  /** Vertical bands. */
  | 'stripes'
  /** A diagonal band from shoulder to hip. */
  | 'sash'
  /** Deep space: speckled stars over the base colour. */
  | 'galaxy'
  /** Gold leaf: a metallic sheen with sparkles. */
  | 'gilded';

export interface RonaldoKit {
  /** Tier slot this kit dresses, matching `BOOT_TIERS`. */
  readonly slot: number;
  /** Small line under the name on the pedestal - the era. */
  readonly era: string;

  readonly shirt: string;
  readonly shirtPattern: ShirtPattern;
  /** Second colour of the pattern (hoops, stripes, sash, sparkles). */
  readonly shirtAlt: string;
  /** Collar and sleeve cuffs. */
  readonly trim: string;
  readonly sleeve: string;

  readonly number: string;
  readonly numberFill: string;
  readonly numberEdge: string;

  readonly shorts: string;
  readonly shortsTrim: string;
  readonly socks: string;
  readonly sockBand: string;
  readonly boots: string;
  readonly bootTrim: string;

  /** Hair colour - the cap mesh and the painted hairline. */
  readonly hair: string;
  /** Emissive strength for the late, glowing kits. 0 for a normal kit. */
  readonly glow: number;
}

/** Skin, eyes and the rest of the face are the same Ronaldo in every era. */
export const RONALDO_FACE = {
  skin: '#c98d62',
  skinShade: '#a8704a',
  skinLight: '#dca47a',
  brow: '#231710',
  eyeWhite: '#fbf6ef',
  iris: '#3b2616',
  lip: '#8c4a3a',
  mouth: '#3a1410',
  teeth: '#ffffff',
} as const;

/** The name printed across every shirt back. */
export const SHIRT_NAME = 'RONALDO';

export const RONALDO_KITS: readonly RonaldoKit[] = [
  {
    slot: 1,
    era: 'Lisbon 2002',
    shirt: '#1f9d55',
    shirtPattern: 'hoops',
    shirtAlt: '#ffffff',
    trim: '#ffffff',
    sleeve: '#1f9d55',
    number: '28',
    numberFill: '#ffffff',
    numberEdge: '#0d4d29',
    shorts: '#15171c',
    shortsTrim: '#1f9d55',
    socks: '#1f9d55',
    sockBand: '#ffffff',
    boots: '#15171c',
    bootTrim: '#ffffff',
    hair: '#241911',
    glow: 0,
  },
  {
    slot: 2,
    era: 'Manchester 2003',
    shirt: '#da291c',
    shirtPattern: 'plain',
    shirtAlt: '#b01d12',
    trim: '#ffffff',
    sleeve: '#da291c',
    number: '7',
    numberFill: '#ffffff',
    numberEdge: '#7a0f08',
    shorts: '#ffffff',
    shortsTrim: '#da291c',
    socks: '#15171c',
    sockBand: '#da291c',
    boots: '#f4f4f4',
    bootTrim: '#da291c',
    hair: '#241911',
    glow: 0,
  },
  {
    slot: 3,
    era: 'Madrid 2009',
    shirt: '#f4f6fb',
    shirtPattern: 'plain',
    shirtAlt: '#e3e7f1',
    trim: '#c9a227',
    sleeve: '#f4f6fb',
    number: '7',
    numberFill: '#c9a227',
    numberEdge: '#23284a',
    shorts: '#f4f6fb',
    shortsTrim: '#c9a227',
    socks: '#f4f6fb',
    sockBand: '#23284a',
    boots: '#ff7a1a',
    bootTrim: '#23284a',
    hair: '#241911',
    glow: 0,
  },
  {
    slot: 4,
    era: 'Turin 2018',
    shirt: '#f7f7f7',
    shirtPattern: 'stripes',
    shirtAlt: '#15171c',
    trim: '#f2c14e',
    sleeve: '#15171c',
    number: '7',
    numberFill: '#f2c14e',
    numberEdge: '#15171c',
    shorts: '#f7f7f7',
    shortsTrim: '#15171c',
    socks: '#f7f7f7',
    sockBand: '#15171c',
    boots: '#e8e8e8',
    bootTrim: '#2f6bff',
    hair: '#241911',
    glow: 0,
  },
  {
    slot: 5,
    era: 'Riyadh 2023',
    shirt: '#ffd400',
    shirtPattern: 'plain',
    shirtAlt: '#f0c400',
    trim: '#1d3f96',
    sleeve: '#ffd400',
    number: '7',
    numberFill: '#1d3f96',
    numberEdge: '#ffffff',
    shorts: '#1d3f96',
    shortsTrim: '#ffd400',
    socks: '#ffd400',
    sockBand: '#1d3f96',
    boots: '#ff3b8d',
    bootTrim: '#ffffff',
    hair: '#241911',
    glow: 0,
  },
  {
    slot: 6,
    era: 'Portugal',
    shirt: '#c8102e',
    shirtPattern: 'sash',
    shirtAlt: '#a30c24',
    trim: '#0b7a3b',
    sleeve: '#c8102e',
    number: '7',
    numberFill: '#f2c14e',
    numberEdge: '#5a0612',
    shorts: '#0b7a3b',
    shortsTrim: '#c8102e',
    socks: '#c8102e',
    sockBand: '#0b7a3b',
    boots: '#f2c14e',
    bootTrim: '#15171c',
    hair: '#241911',
    glow: 0,
  },
  {
    slot: 7,
    era: "Ballon d'Or",
    shirt: '#e0a91f',
    shirtPattern: 'gilded',
    shirtAlt: '#fff1a8',
    trim: '#ffffff',
    sleeve: '#e0a91f',
    number: '7',
    numberFill: '#ffffff',
    numberEdge: '#7a5200',
    shorts: '#e0a91f',
    shortsTrim: '#ffffff',
    socks: '#e0a91f',
    sockBand: '#ffffff',
    boots: '#ffffff',
    bootTrim: '#e0a91f',
    hair: '#2b1d12',
    glow: 0.18,
  },
  {
    slot: 8,
    era: 'Beyond the Stars',
    shirt: '#241a5e',
    shirtPattern: 'galaxy',
    shirtAlt: '#8fe9ff',
    trim: '#5ce1ff',
    sleeve: '#241a5e',
    number: '7',
    numberFill: '#5ce1ff',
    numberEdge: '#0a0730',
    shorts: '#1a1245',
    shortsTrim: '#5ce1ff',
    socks: '#241a5e',
    sockBand: '#5ce1ff',
    boots: '#5ce1ff',
    bootTrim: '#ffffff',
    hair: '#1a1210',
    glow: 0.22,
  },
  {
    slot: 9,
    era: 'The GOAT',
    shirt: '#fffaf0',
    shirtPattern: 'gilded',
    shirtAlt: '#f2c14e',
    trim: '#f2c14e',
    sleeve: '#fffaf0',
    number: '7',
    numberFill: '#f2c14e',
    numberEdge: '#6a4a00',
    shorts: '#fffaf0',
    shortsTrim: '#f2c14e',
    socks: '#fffaf0',
    sockBand: '#f2c14e',
    boots: '#f2c14e',
    bootTrim: '#ffffff',
    hair: '#2b1d12',
    glow: 0.26,
  },
];

/** The kit for a slot. Unknown slots wear the starter kit. */
export const ronaldoKit = (slot: number): RonaldoKit =>
  RONALDO_KITS.find((kit) => kit.slot === slot) ?? (RONALDO_KITS[0] as RonaldoKit);
