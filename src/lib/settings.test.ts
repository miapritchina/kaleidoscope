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
    expect(clampToLimit(-99, LIMITS.shards)).toBe(LIMITS.shards.min);
    expect(clampToLimit(999, LIMITS.shards)).toBe(LIMITS.shards.max);
  });

  it('snaps to the step without overshooting the maximum', () => {
    expect(clampToLimit(5.4, LIMITS.shards)).toBe(5);
    expect(clampToLimit(59.9, LIMITS.shards)).toBe(LIMITS.shards.max);
  });

  it('falls back to the minimum for non-finite input', () => {
    expect(clampToLimit(Number.NaN, LIMITS.zoom)).toBe(LIMITS.zoom.min);
    expect(clampToLimit(Number.POSITIVE_INFINITY, LIMITS.zoom)).toBe(LIMITS.zoom.min);
  });

  it('keeps the shard count a whole number', () => {
    const max: number = LIMITS.shards.max;

    for (let value = LIMITS.shards.min; value <= max; value += 0.25) {
      expect(Number.isInteger(clampToLimit(value, LIMITS.shards))).toBe(true);
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
      shards: '30',
      zoom: 1.5,
      seed: '  drifting  ',
    });

    expect(result).toEqual({
      source: DEFAULT_SETTINGS.source,
      cameraFacing: DEFAULT_SETTINGS.cameraFacing,
      shards: 30,
      chipSize: DEFAULT_SETTINGS.chipSize,
      objects: DEFAULT_SETTINGS.objects,
      zoom: 1.5,
      tilt: DEFAULT_SETTINGS.tilt,
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

  // These described arrangements the app once offered. They no longer decide
  // anything, but a link carrying one still has settings worth reading.
  it('recognises the parameters older links carried', () => {
    expect(hasSettingsParams(new URLSearchParams('segments=12'))).toBe(true);
    expect(hasSettingsParams(new URLSearchParams('mirrors=4'))).toBe(true);
    expect(hasSettingsParams(new URLSearchParams('geometry=rosette'))).toBe(true);
    // The motion trail, back when each frame lingered into the next, and the
    // palette, back when the pieces were drawn and coloured from one.
    expect(hasSettingsParams(new URLSearchParams('trails=0.5'))).toBe(true);
    expect(hasSettingsParams(new URLSearchParams('palette=ember'))).toBe(true);
    expect(hasSettingsParams(new URLSearchParams('metallic=1'))).toBe(true);
  });

  it('ignores unrelated query strings', () => {
    expect(hasSettingsParams(new URLSearchParams(''))).toBe(false);
    expect(hasSettingsParams(new URLSearchParams('utm_source=newsletter'))).toBe(false);
  });
});

describe('search param round trip', () => {
  it('restores the settings it encoded', () => {
    const settings = { ...DEFAULT_SETTINGS, zoom: 2, seed: 'round-trip' };

    expect(settingsFromSearchParams(settingsToSearchParams(settings))).toEqual(settings);
  });

  it('sanitises hand-edited links', () => {
    const params = new URLSearchParams('shards=9999&seed=&objects=nope');

    expect(settingsFromSearchParams(params)).toEqual({
      ...DEFAULT_SETTINGS,
      shards: LIMITS.shards.max,
    });
  });

  // An old link named an arrangement this app no longer offers. It should still
  // open, on the settings it does carry, rather than being ignored wholesale.
  it('opens an older link on everything still meaningful in it', () => {
    const params = new URLSearchParams('geometry=rosette&mirrors=9&segments=18&zoom=2');

    expect(settingsFromSearchParams(params)).toEqual({ ...DEFAULT_SETTINGS, zoom: 2 });
  });

  // The finish and the palette described drawn pieces, which are gone. A link
  // carrying either still opens, on whatever else it carries.
  it('ignores the settings that described drawn pieces', () => {
    const params = new URLSearchParams('metallic=1&palette=ember&trails=0.5&zoom=2');

    expect(settingsFromSearchParams(params)).toEqual({ ...DEFAULT_SETTINGS, zoom: 2 });
  });
});
