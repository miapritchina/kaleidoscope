import { useCallback, useEffect, useReducer } from 'react';

import {
  DEFAULT_SETTINGS,
  hasSettingsParams,
  randomizeSeed,
  sanitizeSettings,
  settingsFromSearchParams,
  type Settings,
} from '../lib/settings';

const STORAGE_KEY = 'kaleidoscope:settings';

/**
 * Bumped when a release changes what the app should open on.
 *
 * Saved settings are otherwise kept forever, and every field in them is
 * individually valid, so nothing about them ever looks wrong: a phone that
 * opened the app once, months ago, keeps opening on the set it had then. Adding
 * new sets and pointing the default at one of them changes nothing for the only
 * people who have already been here. There is no way to tell "chose this" from
 * "was given this" after the fact — so this number says which release the saved
 * settings were formed under, and settings from any other release are let go.
 *
 * The cost is a visitor losing a mirror angle they liked, once, at a release
 * that moves this. That is why it is a number to move deliberately and not a
 * hash of the defaults: most releases should leave saved settings alone.
 */
const STORAGE_VERSION = 4;

/** How settings are written down: the release they were formed under, and them. */
interface StoredSettings {
  version: number;
  settings: Settings;
}

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
      const stored: StoredSettings = { version: STORAGE_VERSION, settings };

      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
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

  if (hasSettingsParams(params)) {
    return settingsFromSearchParams(params);
  }

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);

    if (stored) {
      const raw: unknown = JSON.parse(stored);

      // Settings from another release — including every one written before
      // there was a version to write — are not restored. See STORAGE_VERSION.
      if (!isCurrent(raw)) {
        return { ...DEFAULT_SETTINGS };
      }

      const restored = sanitizeSettings(raw.settings);

      // A photo and a camera stream cannot be restored: the file is gone and
      // reopening on `camera` would fire a permission prompt nobody asked for
      // on page load. Open on the chamber and let them choose again.
      //
      // Real gravity starts off every launch for the same kind of reason:
      // iOS only lets the sensor be asked for from inside a tap, so restoring
      // it on showed a switch that was on and a pile that was deaf. Switching
      // it on is one press of the motion button, and that press is the
      // gesture the platform wants.
      return {
        ...restored,
        source: restored.source === 'objects' ? restored.source : 'objects',
        tilt: false,
      };
    }
  } catch {
    // Corrupt or unreadable storage falls back to the defaults below.
  }

  return { ...DEFAULT_SETTINGS };
}

/**
 * Whether something read out of storage was written by this release.
 *
 * Nothing here trusts the `settings` it carries — that still goes through
 * {@link sanitizeSettings}. This only asks whether it is worth reading at all.
 */
function isCurrent(raw: unknown): raw is StoredSettings {
  return (
    typeof raw === 'object' &&
    raw !== null &&
    (raw as { version?: unknown }).version === STORAGE_VERSION
  );
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

  return keys.length === Object.keys(b).length && keys.every((key) => sameField(a[key], b[key]));
}

/**
 * One field's worth of comparison.
 *
 * Most fields are primitives and `===` is the whole of it. The chosen sets are
 * a list, though, and a fresh one built from the same ids is a different array
 * — so comparing by reference would report every unrelated change as a change
 * to the glass and defeat the no-op short-circuit above.
 */
function sameField(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((value, index) => value === (b as unknown[])[index]);
  }

  return a === b;
}
