/**
 * Named colour palettes for the glass.
 *
 * You look through a kaleidoscope *at* a light: the far end of the tube is a
 * frosted window, and everything you see is that light with coloured glass in
 * front of it. So the backdrop is the light source, not a void, and the palette
 * colours are transmission colours — what a piece of glass leaves of the light
 * that passes through it. They are deep and saturated for the same reason
 * stained glass is: a pale tint over a bright light reads as no glass at all.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Palette {
  readonly id: string;
  readonly name: string;
  /** The jars of glass a chamber is loaded from. Each chip is one of these. */
  readonly colors: readonly string[];
  /** The light behind the glass, seen through the frosted end of the tube. */
  readonly background: string;
}

export const PALETTES = [
  {
    id: 'aurora',
    name: 'Aurora',
    colors: ['#0f8f57', '#12659d', '#3d2199', '#a3186d', '#c07f0c'],
    background: '#f3f6fa',
  },
  {
    id: 'ember',
    name: 'Ember',
    colors: ['#d19b06', '#c65a09', '#ad1a17', '#780c17', '#42080e'],
    background: '#fff5e8',
  },
  {
    id: 'lagoon',
    name: 'Lagoon',
    colors: ['#5aa838', '#0f9182', '#0f6285', '#1b3673', '#141652'],
    background: '#eef8fa',
  },
  {
    id: 'orchid',
    name: 'Orchid',
    colors: ['#b6519f', '#9a3bb8', '#6f21a8', '#451580', '#230a45'],
    background: '#f9f1fb',
  },
  {
    id: 'monochrome',
    name: 'Monochrome',
    colors: ['#d8d8e0', '#a9a9b8', '#727284', '#454556', '#1e1e2a'],
    background: '#f4f4f7',
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
