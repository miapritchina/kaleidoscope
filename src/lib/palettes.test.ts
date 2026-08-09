import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PALETTE_ID,
  getPalette,
  hexToRgb,
  isPaletteId,
  PALETTES,
  pickGlassColor,
  rgbToCss,
} from './palettes';

describe('palette registry', () => {
  it('exposes unique ids and valid colours', () => {
    const ids = PALETTES.map((palette) => palette.id);

    expect(new Set(ids).size).toBe(ids.length);

    for (const palette of PALETTES) {
      expect(palette.colors.length).toBeGreaterThan(0);

      for (const color of [...palette.colors, palette.background]) {
        expect(() => hexToRgb(color)).not.toThrow();
      }
    }
  });

  it('falls back to the default for unknown ids', () => {
    expect(getPalette('does-not-exist').id).toBe(DEFAULT_PALETTE_ID);
    expect(getPalette('ember').id).toBe('ember');
  });

  it('guards palette ids', () => {
    expect(isPaletteId('ember')).toBe(true);
    expect(isPaletteId('nope')).toBe(false);
    expect(isPaletteId(42)).toBe(false);
  });
});

describe('hexToRgb', () => {
  it('parses long and short form', () => {
    expect(hexToRgb('#ff8000')).toEqual({ r: 255, g: 128, b: 0 });
    expect(hexToRgb('#f80')).toEqual({ r: 255, g: 136, b: 0 });
    expect(hexToRgb('00ff00')).toEqual({ r: 0, g: 255, b: 0 });
  });

  it('rejects malformed input', () => {
    expect(() => hexToRgb('#12345')).toThrow(TypeError);
    expect(() => hexToRgb('rebeccapurple')).toThrow(TypeError);
  });
});

describe('rgbToCss', () => {
  it('omits alpha when opaque and clamps channels', () => {
    expect(rgbToCss({ r: 10, g: 20, b: 30 })).toBe('rgb(10 20 30)');
    expect(rgbToCss({ r: 300, g: -5, b: 30.6 }, 0.5)).toBe('rgb(255 0 31 / 0.500)');
  });
});

describe('pickGlassColor', () => {
  it('wraps positions outside [0, 1]', () => {
    const palette = getPalette('aurora');

    expect(pickGlassColor(palette, 1.25)).toEqual(pickGlassColor(palette, 0.25));
    expect(pickGlassColor(palette, -0.75)).toEqual(pickGlassColor(palette, 0.25));
  });

  it('returns the first colour at position 0, and the last at the far end', () => {
    const palette = getPalette('ember');

    expect(pickGlassColor(palette, 0)).toEqual(hexToRgb(palette.colors[0]!));
    expect(pickGlassColor(palette, 0.999)).toEqual(hexToRgb(palette.colors.at(-1)!));
  });

  // A chamber is loaded from a few jars of glass, and the halfway house between
  // a green and a magenta is mud.
  it('never mixes two of the colours', () => {
    const palette = getPalette('aurora');
    const stops = palette.colors.map((color) => hexToRgb(color));

    for (let i = 0; i <= 100; i += 1) {
      expect(stops).toContainEqual(pickGlassColor(palette, i / 100));
    }
  });
});
