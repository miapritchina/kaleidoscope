import { describe, expect, it } from 'vitest';

import { chamberCut, createChamber, isSameInstrument, sameCut } from './chambers';
import { DEFAULT_SETTINGS, SOURCES, type Settings } from './settings';

const inputs = {
  settings: () => DEFAULT_SETTINGS,
  media: () => null,
  skins: () => [],
  tilt: () => 0,
};

const at = (over: Partial<Settings>) => chamberCut({ ...DEFAULT_SETTINGS, ...over });

describe('createChamber', () => {
  // The switch in this file is the only place in the program that knows there
  // is more than one kind of chamber. Every source has to reach one.
  it('builds a chamber for every source there is', () => {
    for (const source of SOURCES) {
      const chamber = createChamber(at({ source }), inputs);

      expect(chamber.ground, source).toMatch(/^#|^rgb/);
      expect(typeof chamber.update, source).toBe('function');
      expect(typeof chamber.paint, source).toBe('function');
    }
  });

  // A cell caps the tube and there is no objective in front of it; an open end
  // is the teleidoscope, and the only place a bead belongs.
  it('opens the tube only for the sources that look out of it', () => {
    expect(createChamber(at({ source: 'objects' }), inputs).open).toBe(false);
    expect(createChamber(at({ source: 'liquid' }), inputs).open).toBe(false);
    expect(createChamber(at({ source: 'image' }), inputs).open).toBe(true);
    expect(createChamber(at({ source: 'camera' }), inputs).open).toBe(true);
  });

  // A photograph and the camera are the same chamber with a different element
  // handed to it, which is the whole argument for the fitting: a video would
  // be the third.
  it('shows a photograph and the camera through one and the same chamber', () => {
    const photo = createChamber(at({ source: 'image' }), inputs);
    const camera = createChamber(at({ source: 'camera' }), inputs);

    expect(photo.ground).toBe(camera.ground);
    expect(photo.open).toBe(camera.open);
    expect(photo.listen).toBe(camera.listen);
  });
});

describe('chamberCut', () => {
  // Only what a rebuild actually depends on. Everything answerable by drawing
  // is read live, and moving it must not cost a settled pile.
  it('leaves out everything that can be answered by drawing', () => {
    const cut = at({});

    expect(Object.keys(cut).sort()).toEqual(
      ['amount', 'scale', 'seed', 'shards', 'source', 'substance', 'variety'].sort(),
    );
  });

  it('is unmoved by the optics, the sound and the overlay', () => {
    expect(sameCut(at({}), at({ zoom: 3, angle: 40, bead: 1, sound: true, debug: true }))).toBe(
      true,
    );
  });

  it('notices anything that would settle into a different pile', () => {
    expect(sameCut(at({}), at({ seed: 'other' }))).toBe(false);
    expect(sameCut(at({}), at({ shards: 7 }))).toBe(false);
    expect(sameCut(at({}), at({ sourceScale: 2 }))).toBe(false);
    expect(sameCut(at({}), at({ variety: 0 }))).toBe(false);
    expect(sameCut(at({}), at({ amount: 0.9 }))).toBe(false);
  });
});

describe('isSameInstrument', () => {
  // Switching tabs or substances should hand back the other instrument at
  // once; only a hand on a slider is worth making wait.
  it('holds a slider back and lets a tab through', () => {
    expect(isSameInstrument(at({}), at({ shards: 7 }))).toBe(true);
    expect(isSameInstrument(at({}), at({ source: 'liquid' }))).toBe(false);
    expect(
      isSameInstrument(at({ source: 'liquid' }), at({ source: 'liquid', substance: 'smoke' })),
    ).toBe(false);
  });
});
