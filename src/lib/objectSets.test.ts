import { describe, expect, it } from 'vitest';

import {
  CUSTOM,
  DEFAULT_OBJECTS,
  GENERATED,
  isObjectSetId,
  OBJECT_SETS,
  objectSetUrl,
  PRESET_SETS,
} from './objectSets';

describe('object sets', () => {
  // The two that are not pictures. Everything else is discovered from the
  // files, so there is nothing here to assert about which ones exist.
  it('always offers a set to upload and a set to generate', () => {
    expect(isObjectSetId(CUSTOM)).toBe(true);
    expect(isObjectSetId(GENERATED)).toBe(true);
    expect(objectSetUrl(CUSTOM)).toBeNull();
    expect(objectSetUrl(GENERATED)).toBeNull();
  });

  it('rejects anything else, so a hand-edited link cannot name one', () => {
    expect(isObjectSetId('nonsense')).toBe(false);
    expect(isObjectSetId(42)).toBe(false);
    expect(isObjectSetId(undefined)).toBe(false);
    expect(objectSetUrl('nonsense')).toBeNull();
  });

  it('lists every bundled set, and those two after them', () => {
    expect(OBJECT_SETS).toHaveLength(PRESET_SETS.length + 2);
    expect(OBJECT_SETS.at(-2)?.id).toBe(CUSTOM);
    expect(OBJECT_SETS.at(-1)?.id).toBe(GENERATED);
  });

  // A picture dropped into the folder is the whole of adding a preset, so the
  // things derived from its name have to be right without anyone checking.
  it('names each bundled set from its file, and gives it a picture', () => {
    for (const set of PRESET_SETS) {
      expect(set.id, 'lowercase, hyphenated').toMatch(/^[a-z0-9-]+$/);
      expect(set.name.charAt(0)).toBe(set.name.charAt(0).toUpperCase());
      expect(set.name).not.toContain('-');
      expect(set.url).toBeTruthy();
      expect(objectSetUrl(set.id)).toBe(set.url);
      expect(isObjectSetId(set.id)).toBe(true);
    }
  });

  it('has no two sets sharing an id', () => {
    expect(new Set(OBJECT_SETS.map((set) => set.id)).size).toBe(OBJECT_SETS.length);
  });

  // The drawn shapes are a fallback for a build with no pictures in it, not the
  // thing on show: a bundled set opens the app when there is one.
  it('opens on a bundled set when the build has any', () => {
    expect(DEFAULT_OBJECTS).toBe(PRESET_SETS[0]?.id ?? GENERATED);
    expect(isObjectSetId(DEFAULT_OBJECTS)).toBe(true);
  });
});
