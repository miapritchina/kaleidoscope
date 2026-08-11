/**
 * Colour, and the ground the objects stand on.
 *
 * There is no palette any more. The objects are cut out of a photograph and
 * bring their own colours; all that is left to choose is what they stand on,
 * and that is white — what anyone photographing a handful of gemstones would
 * stand them on, and what the pictures themselves were cut from.
 */

/** The ground behind the objects. */
export const GROUND = '#ffffff';

export interface Rgb {
  r: number;
  g: number;
  b: number;
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
