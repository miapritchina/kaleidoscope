import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS, LIMITS, type Settings } from '../lib/settings';
import { settingsReducer, useSettings } from './useSettings';

/** One valid, genuinely different value per setting. */
const CHANGES = [
  ['source', 'camera'],
  ['cameraFacing', 'user'],
  ['shards', 40],
  ['chipSize', 1.5],
  ['objects', 'custom'],
  ['zoom', 2],
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

    expect(next[key]).toBe(value);
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
    window.localStorage.setItem(
      'kaleidoscope:settings',
      JSON.stringify({ ...DEFAULT_SETTINGS, seed: 'stored' }),
    );
    window.history.replaceState(null, '', '/?seed=shared&chipSize=1.5');

    const { result } = renderHook(() => useSettings());

    expect(result.current.settings.seed).toBe('shared');
    expect(result.current.settings.chipSize).toBe(1.5);
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
