import { describe, expect, it } from 'vitest';

import {
  clampToLimit,
  DEFAULT_SETTINGS,
  hasSettingsParams,
  LIMITS,
  randomizeSeed,
  sanitizeSettings,
  settingsFromSearchParams,
  settingsToSearchParams,
} from './settings';

describe('clampToLimit', () => {
  it('clamps to the range', () => {
    expect(clampToLimit(-99, LIMITS.mirrors)).toBe(LIMITS.mirrors.min);
    expect(clampToLimit(999, LIMITS.mirrors)).toBe(LIMITS.mirrors.max);
  });

  it('snaps to the step without overshooting the maximum', () => {
    expect(clampToLimit(5.4, LIMITS.mirrors)).toBe(5);
    expect(clampToLimit(17.9, LIMITS.mirrors)).toBe(LIMITS.mirrors.max);
    expect(clampToLimit(0.94, LIMITS.trails)).toBe(0.95);
  });

  it('allows an odd mirror count, three included', () => {
    expect(clampToLimit(3, LIMITS.mirrors)).toBe(3);
    expect(LIMITS.mirrors.min).toBeLessThanOrEqual(3);
  });

  it('falls back to the minimum for non-finite input', () => {
    expect(clampToLimit(Number.NaN, LIMITS.zoom)).toBe(LIMITS.zoom.min);
    expect(clampToLimit(Number.POSITIVE_INFINITY, LIMITS.zoom)).toBe(LIMITS.zoom.min);
  });

  it('keeps the mirror count a whole number', () => {
    const max: number = LIMITS.mirrors.max;

    for (let value = LIMITS.mirrors.min; value <= max; value += 0.25) {
      expect(Number.isInteger(clampToLimit(value, LIMITS.mirrors))).toBe(true);
    }
  });
});

describe('sanitizeSettings', () => {
  it('returns defaults for non-objects', () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings('nope')).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  it('repairs individual fields without discarding valid ones', () => {
    const result = sanitizeSettings({
      mirrors: 500,
      shards: '30',
      zoom: 1.5,
      trails: -4,
      glow: 'yes',
      paletteId: 'unknown-palette',
      seed: '  drifting  ',
    });

    expect(result).toEqual({
      source: DEFAULT_SETTINGS.source,
      geometry: DEFAULT_SETTINGS.geometry,
      mirrors: LIMITS.mirrors.max,
      shards: 30,
      chipSize: DEFAULT_SETTINGS.chipSize,
      zoom: 1.5,
      trails: 0,
      glow: DEFAULT_SETTINGS.glow,
      paletteId: DEFAULT_SETTINGS.paletteId,
      seed: 'drifting',
    });
  });

  it('replaces an empty seed and truncates a long one', () => {
    expect(sanitizeSettings({ seed: '   ' }).seed).toBe(DEFAULT_SETTINGS.seed);
    expect(sanitizeSettings({ seed: 'x'.repeat(80) }).seed).toHaveLength(32);
  });
});

describe('randomizeSeed', () => {
  it('changes only the seed', () => {
    const next = randomizeSeed(DEFAULT_SETTINGS);

    expect(next.seed).not.toBe(DEFAULT_SETTINGS.seed);
    expect({ ...next, seed: DEFAULT_SETTINGS.seed }).toEqual(DEFAULT_SETTINGS);
  });
});

describe('hasSettingsParams', () => {
  // A parameter the detector does not know about is a shared link that opens on
  // the wrong settings, so every encoded key has to be recognised.
  it('recognises every parameter the encoder writes', () => {
    for (const [name, value] of settingsToSearchParams(DEFAULT_SETTINGS)) {
      expect(hasSettingsParams(new URLSearchParams({ [name]: value })), name).toBe(true);
    }
  });

  it('recognises the legacy wedge count', () => {
    expect(hasSettingsParams(new URLSearchParams('segments=12'))).toBe(true);
  });

  it('ignores unrelated query strings', () => {
    expect(hasSettingsParams(new URLSearchParams(''))).toBe(false);
    expect(hasSettingsParams(new URLSearchParams('utm_source=newsletter'))).toBe(false);
  });
});

describe('search param round trip', () => {
  it('restores the settings it encoded', () => {
    const settings = { ...DEFAULT_SETTINGS, mirrors: 3, glow: false, seed: 'round-trip' };

    expect(settingsFromSearchParams(settingsToSearchParams(settings))).toEqual(settings);
  });

  it('sanitises hand-edited links', () => {
    const params = new URLSearchParams('mirrors=9999&palette=hax&seed=&trails=abc');

    expect(settingsFromSearchParams(params)).toEqual({
      ...DEFAULT_SETTINGS,
      mirrors: LIMITS.mirrors.max,
    });
  });

  // This control used to count wedges; a link made back then should still show
  // the figure it was shared for rather than snapping to the default.
  it('reads the wedge count from older links as half as many mirrors', () => {
    expect(settingsFromSearchParams(new URLSearchParams('segments=12')).mirrors).toBe(6);
    expect(settingsFromSearchParams(new URLSearchParams('segments=8')).mirrors).toBe(4);
  });

  it('prefers a mirror count over a legacy wedge count', () => {
    expect(settingsFromSearchParams(new URLSearchParams('mirrors=3&segments=24')).mirrors).toBe(3);
  });

  it('reads a legacy wedge count from stored settings too', () => {
    expect(sanitizeSettings({ segments: 12 }).mirrors).toBe(6);
  });

  it('keeps the three-mirror tiling as the default geometry', () => {
    expect(DEFAULT_SETTINGS.geometry).toBe('triangle');
    expect(sanitizeSettings({ geometry: 'nonsense' }).geometry).toBe('triangle');
  });

  it('treats a missing glow flag as the default', () => {
    expect(settingsFromSearchParams(new URLSearchParams('seed=abc')).glow).toBe(
      DEFAULT_SETTINGS.glow,
    );
  });
});
