import { useCallback, useEffect, useReducer } from 'react';

import {
  DEFAULT_SETTINGS,
  randomizeSeed,
  sanitizeSettings,
  settingsFromSearchParams,
  type Settings,
} from '../lib/settings';

const STORAGE_KEY = 'kaleidoscope:settings';

export type SettingsAction =
  | { type: 'set'; key: keyof Settings; value: Settings[keyof Settings] }
  | { type: 'randomize' }
  | { type: 'reset' };

export function settingsReducer(state: Settings, action: SettingsAction): Settings {
  switch (action.type) {
    case 'set': {
      const next = sanitizeSettings({ ...state, [action.key]: action.value });
      return isEqual(state, next) ? state : next;
    }
    case 'randomize':
      return randomizeSeed(state);
    case 'reset':
      return { ...DEFAULT_SETTINGS };
  }
}

export interface UseSettingsResult {
  settings: Settings;
  /** Updates a single field; the value is validated before it lands in state. */
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  randomize: () => void;
  reset: () => void;
}

/**
 * Owns the kaleidoscope settings.
 *
 * Precedence on first paint is URL query > `localStorage` > defaults, so a
 * shared link always wins over whatever the visitor last had open. Both sources
 * are untrusted, so both go through {@link sanitizeSettings}.
 */
export function useSettings(): UseSettingsResult {
  const [settings, dispatch] = useReducer(settingsReducer, undefined, readInitialSettings);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Private browsing or a full quota: persistence is a nicety, not a feature.
    }
  }, [settings]);

  const set = useCallback<UseSettingsResult['set']>((key, value) => {
    dispatch({ type: 'set', key, value });
  }, []);

  const randomize = useCallback(() => {
    dispatch({ type: 'randomize' });
  }, []);

  const reset = useCallback(() => {
    dispatch({ type: 'reset' });
  }, []);

  return { settings, set, randomize, reset };
}

function readInitialSettings(): Settings {
  if (typeof window === 'undefined') {
    return { ...DEFAULT_SETTINGS };
  }

  const params = new URLSearchParams(window.location.search);

  if (params.has('seed') || params.has('palette') || params.has('segments')) {
    return settingsFromSearchParams(params);
  }

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);

    if (stored) {
      const restored = sanitizeSettings(JSON.parse(stored));

      // A photo and a camera stream cannot be restored: the file is gone and
      // reopening on `camera` would fire a permission prompt nobody asked for
      // on page load. Start on the shard field and let them choose again.
      return restored.source === 'shards' ? restored : { ...restored, source: 'shards' };
    }
  } catch {
    // Corrupt or unreadable storage falls back to the defaults below.
  }

  return { ...DEFAULT_SETTINGS };
}

/**
 * Compares every field, by iterating the keys rather than listing them.
 *
 * A hand-written list silently stops covering whatever gets added next, and a
 * field missing from the comparison makes its control dead: the reducer decides
 * nothing changed and hands back the previous state.
 */
function isEqual(a: Settings, b: Settings): boolean {
  const keys = Object.keys(a) as (keyof Settings)[];

  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}
