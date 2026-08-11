/**
 * Named palettes for the objects in the chamber.
 *
 * The pieces are solid and the light is at the viewer's eye, so a colour here
 * is a *body* colour — what the material is, not what it leaves of a light
 * behind it. Bright, because a lit face returns most of what it is given and
 * the shading takes it down from there rather than up.
 *
 * The ground behind them is white. It stays a property of the palette rather
 * than a constant, so a palette can be given its own again, but every one of
 * them is white today: the objects are the subject and a white ground is what a
 * photographer would put them on.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Palette {
  readonly id: string;
  readonly name: string;
  /** The materials a chamber is loaded from. Each piece is one of these. */
  readonly colors: readonly string[];
  /** The inside of the tube, behind the objects. */
  readonly background: string;
}

/** The ground behind the objects. */
const WHITE = '#ffffff';

export const PALETTES = [
  {
    id: 'aurora',
    name: 'Aurora',
    colors: ['#2fd694', '#3aa6f0', '#7b5cf0', '#f05ca8', '#f2b134'],
    background: WHITE,
  },
  {
    id: 'ember',
    name: 'Ember',
    colors: ['#f5c542', '#f08a2c', '#e0452f', '#b02020', '#7a1420'],
    background: WHITE,
  },
  {
    id: 'lagoon',
    name: 'Lagoon',
    colors: ['#9fe07a', '#3fd2bc', '#2aa2cc', '#3a6fd0', '#4a4ec0'],
    background: WHITE,
  },
  {
    id: 'orchid',
    name: 'Orchid',
    colors: ['#f0b6e8', '#d071e8', '#a03fd6', '#6f2ab0', '#4a1a80'],
    background: WHITE,
  },
  {
    // Bare metals, and the palette the light-at-the-eye arrangement is really
    // for: there is no body colour to speak of, only what the surface returns.
    // Darker than the metals themselves are, because a pale steel on a white
    // ground is a piece you cannot see the edge of.
    id: 'metal',
    name: 'Metal',
    colors: ['#9aa3ad', '#c9a227', '#b87333', '#6c7581', '#3f4650'],
    background: WHITE,
  },
] as const satisfies readonly Palette[];

export type PaletteId = (typeof PALETTES)[number]['id'];

export const DEFAULT_PALETTE_ID: PaletteId = 'aurora';

const PALETTES_BY_ID = new Map<string, Palette>(PALETTES.map((palette) => [palette.id, palette]));

/** Looks up a palette, falling back to the default for unknown ids. */
export function getPalette(id: string): Palette {
  return PALETTES_BY_ID.get(id) ?? PALETTES_BY_ID.get(DEFAULT_PALETTE_ID)!;
}

/** Type guard for values coming from storage or the URL. */
export function isPaletteId(value: unknown): value is PaletteId {
  return typeof value === 'string' && PALETTES_BY_ID.has(value);
}

/** Parses `#rgb` / `#rrggbb` into channel values. Throws on malformed input. */
export function hexToRgb(hex: string): Rgb {
  const normalized = hex.trim().replace(/^#/, '');
  const expanded =
    normalized.length === 3
      ? normalized
          .split('')
          .map((char) => char + char)
          .join('')
      : normalized;

  if (!/^[0-9a-f]{6}$/i.test(expanded)) {
    throw new TypeError(`Invalid hex colour: ${hex}`);
  }

  const value = Number.parseInt(expanded, 16);

  return {
    r: (value >> 16) & 0xff,
    g: (value >> 8) & 0xff,
    b: value & 0xff,
  };
}

/** Formats a colour as a CSS `rgb()` / `rgba()` string. */
export function rgbToCss({ r, g, b }: Rgb, alpha = 1): string {
  const round = (channel: number) => Math.round(clamp(channel, 0, 255));

  return alpha >= 1
    ? `rgb(${round(r)} ${round(g)} ${round(b)})`
    : `rgb(${round(r)} ${round(g)} ${round(b)} / ${clamp(alpha, 0, 1).toFixed(3)})`;
}

/**
 * Picks one of the palette's colours.
 *
 * Discrete, not a blend of the two nearest. A chamber is loaded from a handful
 * of jars of coloured glass, so every chip is one of a few strong colours;
 * mixing continuously along the ramp lands most chips in between two of them,
 * and the halfway house between a green and a magenta is mud.
 *
 * @param t Position along the ramp. Values outside `[0, 1]` wrap around.
 */
export function pickGlassColor(palette: Palette, t: number): Rgb {
  const { colors } = palette;
  const wrapped = ((t % 1) + 1) % 1;
  const index = Math.min(colors.length - 1, Math.floor(wrapped * colors.length));

  return hexToRgb(colors[index]!);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
