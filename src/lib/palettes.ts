/** Named colour palettes used to tint the shards of the kaleidoscope. */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Palette {
  readonly id: string;
  readonly name: string;
  /** Ordered stops; colours are interpolated between neighbouring stops. */
  readonly colors: readonly string[];
  /** Backdrop the shards are composited onto. */
  readonly background: string;
}

export const PALETTES = [
  {
    id: 'aurora',
    name: 'Aurora',
    colors: ['#3ddc97', '#37b3ff', '#7a5cff', '#ff5ce1', '#ffd166'],
    background: '#05060f',
  },
  {
    id: 'ember',
    name: 'Ember',
    colors: ['#ffe066', '#ff9f1c', '#ff4d3d', '#c1121f', '#6a040f'],
    background: '#120404',
  },
  {
    id: 'lagoon',
    name: 'Lagoon',
    colors: ['#caffbf', '#5cf2d6', '#26a0c8', '#2755a8', '#1b1f6b'],
    background: '#030b14',
  },
  {
    id: 'orchid',
    name: 'Orchid',
    colors: ['#ffd6ff', '#e7a1ff', '#b25cff', '#6a2cc9', '#2f0f5c'],
    background: '#0b0518',
  },
  {
    id: 'monochrome',
    name: 'Monochrome',
    colors: ['#ffffff', '#c9c9d4', '#8b8ba0', '#4c4c63', '#1c1c28'],
    background: '#08080c',
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
 * Samples the palette as a continuous gradient.
 *
 * @param t Position along the ramp. Values outside `[0, 1]` wrap around, so
 *   animated hues cycle smoothly instead of clamping at the ends.
 */
export function samplePalette(palette: Palette, t: number): Rgb {
  const { colors } = palette;
  const first = hexToRgb(colors[0]!);

  if (colors.length === 1) {
    return first;
  }

  const wrapped = ((t % 1) + 1) % 1;
  const scaled = wrapped * colors.length;
  const index = Math.floor(scaled);
  const from = hexToRgb(colors[index % colors.length]!);
  const to = hexToRgb(colors[(index + 1) % colors.length]!);

  return lerpRgb(from, to, scaled - index);
}

/** Linearly interpolates between two colours. */
export function lerpRgb(from: Rgb, to: Rgb, t: number): Rgb {
  const amount = clamp(t, 0, 1);

  return {
    r: from.r + (to.r - from.r) * amount,
    g: from.g + (to.g - from.g) * amount,
    b: from.b + (to.b - from.b) * amount,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
