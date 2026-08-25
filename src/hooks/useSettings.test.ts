import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS, LIMITS, type Settings } from '../lib/settings';
import { settingsReducer, useSettings } from './useSettings';

/** One valid, genuinely different value per setting. */
const CHANGES = [
  ['source', 'camera'],
  ['cameraFacing', 'user'],
  ['shards', 40],
  ['thickness', 0.8],
  ['variety', 0.9],
  ['ink', 0.6],
  ['glitter', 0.8],
  ['bead', 0.25],
  ['sourceScale', 1.5],
  ['debug', true],
  ['objects', ['custom']],
  ['zoom', 2],
  ['angle', 45],
  ['tilt', true],
  ['seed', 'changed'],
] as const satisfies readonly [keyof Settings, Settings[keyof Settings]][];

describe('settingsReducer', () => {
  it('validates values as they are set', () => {
    const next = settingsReducer(DEFAULT_SETTINGS, { type: 'set', key: 'shards', value: 9999 });

    expect(next.shards).toBe(LIMITS.shards.max);
  });

  it('returns the same object when nothing changes, so renders are skipped', () => {
    const action = { type: 'set', key: 'shards', value: DEFAULT_SETTINGS.shards } as const;

    expect(settingsReducer(DEFAULT_SETTINGS, action)).toBe(DEFAULT_SETTINGS);
  });

  // A field left out of the reducer's equality check makes its control dead:
  // the update is judged a no-op and the previous state is handed back.
  it.each(CHANGES)('applies a change to %s', (key, value) => {
    const next = settingsReducer(DEFAULT_SETTINGS, { type: 'set', key, value });

    // toStrictEqual rather than toBe: the chosen sets are a fresh list after
    // sanitising, so the value that lands is equal to the one set but not the
    // same array. For every other field the two are identical.
    expect(next[key]).toStrictEqual(value);
    expect(next).not.toBe(DEFAULT_SETTINGS);
  });

  it('exercises every setting above', () => {
    // Fails when a field is added without a case, which is what keeps the
    // equality check honest as the settings grow.
    expect(CHANGES.map(([key]) => key).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
  });

  it('randomizes only the seed', () => {
    const next = settingsReducer(DEFAULT_SETTINGS, { type: 'randomize' });

    expect(next.seed).not.toBe(DEFAULT_SETTINGS.seed);
    expect(next.shards).toBe(DEFAULT_SETTINGS.shards);
  });

  it('resets to the defaults', () => {
    const changed = settingsReducer(DEFAULT_SETTINGS, {
      type: 'set',
      key: 'seed',
      value: 'changed',
    });

    expect(settingsReducer(changed, { type: 'reset' })).toEqual(DEFAULT_SETTINGS);
  });
});

describe('useSettings', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, '', '/');
  });

  /**
   * Writes settings the way a previous visit would have left them.
   *
   * Goes through the hook to learn the current version rather than naming it,
   * so that moving the version — which is a thing releases are meant to do —
   * does not leave these tests asserting against a number nobody updated.
   */
  function store(settings: Settings): void {
    renderHook(() => useSettings()).unmount();

    const written = JSON.parse(window.localStorage.getItem('kaleidoscope:settings') ?? '{}') as {
      version: number;
    };

    window.localStorage.setItem(
      'kaleidoscope:settings',
      JSON.stringify({ version: written.version, settings }),
    );
  }

  it('starts from the defaults', () => {
    const { result } = renderHook(() => useSettings());

    expect(result.current.settings).toEqual(DEFAULT_SETTINGS);
  });

  it('persists changes and restores them on the next mount', () => {
    const first = renderHook(() => useSettings());

    act(() => {
      first.result.current.set('seed', 'lagoon');
    });
    first.unmount();

    const second = renderHook(() => useSettings());

    expect(second.result.current.settings.seed).toBe('lagoon');
  });

  // A photo is gone and a camera would ask for permission on page load, so
  // neither is restored. A cell of glass is restored whichever cell it was:
  // both are entirely this app's to reopen.
  it('reopens on the cell it was left on, but never on a photo or the camera', () => {
    store({ ...DEFAULT_SETTINGS, source: 'liquid' });
    expect(renderHook(() => useSettings()).result.current.settings.source).toBe('liquid');

    for (const source of ['image', 'camera'] as const) {
      store({ ...DEFAULT_SETTINGS, source });
      expect(renderHook(() => useSettings()).result.current.settings.source).toBe('objects');
    }
  });

  it('ignores corrupt storage', () => {
    window.localStorage.setItem('kaleidoscope:settings', '{not json');

    const { result } = renderHook(() => useSettings());

    expect(result.current.settings).toEqual(DEFAULT_SETTINGS);
  });

  it('reads a url that carries only one setting', () => {
    window.history.replaceState(null, '', '/?shards=42');

    const { result } = renderHook(() => useSettings());

    expect(result.current.settings.shards).toBe(42);
  });

  it('prefers the url over stored settings', () => {
    store({ ...DEFAULT_SETTINGS, seed: 'stored' });
    window.history.replaceState(null, '', '/?seed=shared&sourceScale=1.5');

    const { result } = renderHook(() => useSettings());

    expect(result.current.settings.seed).toBe('shared');
    expect(result.current.settings.sourceScale).toBe(1.5);
  });

  // What a visitor who has been here before gets when a release changes what
  // the app opens on. Their saved set is a perfectly valid one, so nothing
  // else would ever let it go, and they would never see the new one.
  it('lets go of settings saved by another release', () => {
    window.localStorage.setItem(
      'kaleidoscope:settings',
      JSON.stringify({ version: 1, settings: { ...DEFAULT_SETTINGS, seed: 'from-before' } }),
    );

    const { result } = renderHook(() => useSettings());

    expect(result.current.settings).toEqual(DEFAULT_SETTINGS);
  });

  it('lets go of settings saved before there was a version', () => {
    window.localStorage.setItem(
      'kaleidoscope:settings',
      JSON.stringify({ ...DEFAULT_SETTINGS, seed: 'from-before' }),
    );

    const { result } = renderHook(() => useSettings());

    expect(result.current.settings).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps settings saved by this release', () => {
    store({ ...DEFAULT_SETTINGS, seed: 'mine' });

    const { result } = renderHook(() => useSettings());

    expect(result.current.settings.seed).toBe('mine');
  });

  it('resets back to the defaults', () => {
    const { result } = renderHook(() => useSettings());

    act(() => {
      result.current.set('zoom', 2.5);
    });
    expect(result.current.settings.zoom).toBe(2.5);

    act(() => {
      result.current.reset();
    });
    expect(result.current.settings).toEqual(DEFAULT_SETTINGS);
  });
});
