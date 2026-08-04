import { describe, expect, it } from 'vitest';

import {
  clampToLimit,
  DEFAULT_SETTINGS,
  LIMITS,
  randomizeSeed,
  sanitizeSettings,
  settingsFromSearchParams,
  settingsToSearchParams,
} from './settings';

describe('clampToLimit', () => {
  it('clamps to the range', () => {
    expect(clampToLimit(-99, LIMITS.segments)).toBe(LIMITS.segments.min);
    expect(clampToLimit(999, LIMITS.segments)).toBe(LIMITS.segments.max);
  });

  it('snaps to the step without overshooting the maximum', () => {
    expect(clampToLimit(11, LIMITS.segments)).toBe(12);
    expect(clampToLimit(35.9, LIMITS.segments)).toBe(LIMITS.segments.max);
    expect(clampToLimit(0.94, LIMITS.trails)).toBe(0.95);
  });

  it('falls back to the minimum for non-finite input', () => {
    expect(clampToLimit(Number.NaN, LIMITS.zoom)).toBe(LIMITS.zoom.min);
    expect(clampToLimit(Number.POSITIVE_INFINITY, LIMITS.zoom)).toBe(LIMITS.zoom.min);
  });

  it('keeps the segment count even', () => {
    const max: number = LIMITS.segments.max;

    for (let value = LIMITS.segments.min; value <= max; value += 0.5) {
      expect(clampToLimit(value, LIMITS.segments) % 2).toBe(0);
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
      segments: 500,
      speed: 'not a number',
      shards: '30',
      zoom: 1.5,
      trails: -4,
      glow: 'yes',
      paletteId: 'unknown-palette',
      seed: '  drifting  ',
    });

    expect(result).toEqual({
      segments: LIMITS.segments.max,
      speed: DEFAULT_SETTINGS.speed,
      shards: 30,
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

describe('search param round trip', () => {
  it('restores the settings it encoded', () => {
    const settings = { ...DEFAULT_SETTINGS, segments: 20, glow: false, seed: 'round-trip' };

    expect(settingsFromSearchParams(settingsToSearchParams(settings))).toEqual(settings);
  });

  it('sanitises hand-edited links', () => {
    const params = new URLSearchParams('segments=9999&palette=hax&seed=&trails=abc');

    expect(settingsFromSearchParams(params)).toEqual({
      ...DEFAULT_SETTINGS,
      segments: LIMITS.segments.max,
    });
  });

  it('treats a missing glow flag as the default', () => {
    expect(settingsFromSearchParams(new URLSearchParams('seed=abc')).glow).toBe(
      DEFAULT_SETTINGS.glow,
    );
  });
});
