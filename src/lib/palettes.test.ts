import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PALETTE_ID,
  getPalette,
  hexToRgb,
  isPaletteId,
  lerpRgb,
  PALETTES,
  rgbToCss,
  samplePalette,
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

describe('samplePalette', () => {
  it('wraps positions outside [0, 1]', () => {
    const palette = getPalette('aurora');

    expect(samplePalette(palette, 1.25)).toEqual(samplePalette(palette, 0.25));
    expect(samplePalette(palette, -0.75)).toEqual(samplePalette(palette, 0.25));
  });

  it('returns the first stop at position 0', () => {
    const palette = getPalette('ember');

    expect(samplePalette(palette, 0)).toEqual(hexToRgb(palette.colors[0]!));
  });
});

describe('lerpRgb', () => {
  it('interpolates and clamps the amount', () => {
    const from = { r: 0, g: 0, b: 0 };
    const to = { r: 100, g: 200, b: 50 };

    expect(lerpRgb(from, to, 0.5)).toEqual({ r: 50, g: 100, b: 25 });
    expect(lerpRgb(from, to, 2)).toEqual(to);
    expect(lerpRgb(from, to, -1)).toEqual(from);
  });
});
