import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS, LIMITS } from '../lib/settings';
import { settingsReducer, useSettings } from './useSettings';

describe('settingsReducer', () => {
  it('validates values as they are set', () => {
    const next = settingsReducer(DEFAULT_SETTINGS, { type: 'set', key: 'segments', value: 9999 });

    expect(next.segments).toBe(LIMITS.segments.max);
  });

  it('returns the same object when nothing changes, so renders are skipped', () => {
    const action = { type: 'set', key: 'segments', value: DEFAULT_SETTINGS.segments } as const;

    expect(settingsReducer(DEFAULT_SETTINGS, action)).toBe(DEFAULT_SETTINGS);
  });

  it('randomizes only the seed', () => {
    const next = settingsReducer(DEFAULT_SETTINGS, { type: 'randomize' });

    expect(next.seed).not.toBe(DEFAULT_SETTINGS.seed);
    expect(next.segments).toBe(DEFAULT_SETTINGS.segments);
  });

  it('resets to the defaults', () => {
    const changed = settingsReducer(DEFAULT_SETTINGS, {
      type: 'set',
      key: 'paletteId',
      value: 'ember',
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
      first.result.current.set('paletteId', 'lagoon');
    });
    first.unmount();

    const second = renderHook(() => useSettings());

    expect(second.result.current.settings.paletteId).toBe('lagoon');
  });

  it('ignores corrupt storage', () => {
    window.localStorage.setItem('kaleidoscope:settings', '{not json');

    const { result } = renderHook(() => useSettings());

    expect(result.current.settings).toEqual(DEFAULT_SETTINGS);
  });

  it('prefers the url over stored settings', () => {
    window.localStorage.setItem(
      'kaleidoscope:settings',
      JSON.stringify({ ...DEFAULT_SETTINGS, seed: 'stored' }),
    );
    window.history.replaceState(null, '', '/?seed=shared&palette=ember');

    const { result } = renderHook(() => useSettings());

    expect(result.current.settings.seed).toBe('shared');
    expect(result.current.settings.paletteId).toBe('ember');
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
