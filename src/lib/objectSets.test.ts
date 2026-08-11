import { describe, expect, it } from 'vitest';

import {
  CUSTOM,
  DEFAULT_OBJECTS,
  isObjectSetId,
  OBJECT_SETS,
  objectSetUrl,
  PRESET_SETS,
} from './objectSets';

describe('object sets', () => {
  // The one that is not a picture. Everything else is discovered from the
  // files, so there is nothing here to assert about which ones exist.
  it('always offers a set to upload', () => {
    expect(isObjectSetId(CUSTOM)).toBe(true);
    expect(objectSetUrl(CUSTOM)).toBeNull();
  });

  // There is no drawn field any more: a chamber is loaded with objects out of
  // a picture, or it is empty.
  it('offers nothing that is not a picture but the upload', () => {
    expect(isObjectSetId('generated')).toBe(false);
    expect(OBJECT_SETS.filter((set) => set.url === null)).toHaveLength(1);
  });

  it('rejects anything else, so a hand-edited link cannot name one', () => {
    expect(isObjectSetId('nonsense')).toBe(false);
    expect(isObjectSetId(42)).toBe(false);
    expect(isObjectSetId(undefined)).toBe(false);
    expect(objectSetUrl('nonsense')).toBeNull();
  });

  it('lists every bundled set, and the upload after them', () => {
    expect(OBJECT_SETS).toHaveLength(PRESET_SETS.length + 1);
    expect(OBJECT_SETS.at(-1)?.id).toBe(CUSTOM);
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

  it('opens on a bundled set, or on the upload prompt when there are none', () => {
    expect(DEFAULT_OBJECTS).toBe(PRESET_SETS[0]?.id ?? CUSTOM);
    expect(isObjectSetId(DEFAULT_OBJECTS)).toBe(true);
  });
});
