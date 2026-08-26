import { describe, expect, it } from 'vitest';

import { asContext, createFakeContext } from '../test/fakeCanvas';
import { CHAMBER_RADIUS, type ChamberView } from './chamber';
import { GROUND } from './color';
import { createGlassChamber } from './glassChamber';
import type { MediaElement } from './media';

/**
 * A picture for the pieces to be cut out of.
 *
 * Both pairs of dimensions, because "has it loaded" is asked of an image's
 * natural size and "how big is it to draw" of a source's own.
 */
function skin(width = 400, height = 400): MediaElement {
  return {
    naturalWidth: width,
    naturalHeight: height,
    width,
    height,
  } as unknown as MediaElement;
}

// jsdom has no canvas backend, so the piece sprites are rendered onto
// recorders instead. They still come back as drawable images, which is all the
// drawing needs.
const createCanvas = () =>
  ({
    width: 0,
    height: 0,
    getContext: () => asContext(createFakeContext()),
  }) as unknown as HTMLCanvasElement;

const view: ChamberView = {
  scale: 100,
  rotation: 0,
  pan: { x: 0, y: 0 },
  drag: { x: 0, y: 0 },
  reach: CHAMBER_RADIUS,
  light: { x: 0, y: 1, z: 1 },
};

describe('createGlassChamber', () => {
  // A cell caps the tube. There is no objective in front of it to put a bead
  // over, and this is where that decision is answered rather than asked.
  it('caps the tube rather than opening it', () => {
    expect(createGlassChamber({ seed: 'a', count: 4 }).open).toBe(false);
  });

  it('is lit against a white page, which is what makes glass read as glass', () => {
    expect(createGlassChamber({ seed: 'a', count: 4 }).ground).toBe(GROUND);
  });

  // There is no drawn piece to fall back to. Without a picture to cut them out
  // of, a chamber of nothing is a truer answer than one full of shapes nobody
  // chose.
  it('comes up empty with no pictures loaded', () => {
    const ctx = createFakeContext();

    createGlassChamber({ seed: 'a', count: 20 }).paint(asContext(ctx), view);

    expect(ctx.countOf('drawImage')).toBe(0);
  });

  it('cuts its pieces out of every picture that has loaded', () => {
    const ctx = createFakeContext();
    const chamber = createGlassChamber(
      { seed: 'a', count: 20 },
      { skins: () => [skin(), skin(0, 0)], scale: () => 1, createCanvas },
    );

    chamber.paint(asContext(ctx), view);

    // The loaded one is cut from; the one with no pixels yet is simply not in
    // the mix until it lands.
    expect(ctx.countOf('drawImage')).toBeGreaterThan(0);
  });

  // Gravity is the whole mechanism, and it arrives already worked out: the
  // chamber never asks how the tube is being held.
  it('gathers the pile on whichever side gravity points to', () => {
    const loaded = { skins: () => [skin()], scale: () => 1, createCanvas };
    const upright = createGlassChamber({ seed: 'pile', count: 24 }, loaded);
    const inverted = createGlassChamber({ seed: 'pile', count: 24 }, loaded);

    for (let frame = 0; frame < 120; frame += 1) {
      upright.update({ dt: 0.05, gravity: 0, turn: 0, touch: null });
      inverted.update({ dt: 0.05, gravity: Math.PI, turn: 0, touch: null });
    }

    expect(middleOf(upright)).toBeGreaterThan(0);
    expect(middleOf(inverted)).toBeLessThan(0);
  });

  // Glass knocks and there is no fluid in with it, so a dry cell has clinks
  // and no wash. The body never reads the pile to work this out.
  it('reports its knocks and no wash at all', () => {
    const chamber = createGlassChamber({ seed: 'noise', count: 30 });

    // Settled first, then tipped hard over: what is heard is the avalanche.
    for (let frame = 0; frame < 60; frame += 1) {
      chamber.update({ dt: 0.05, gravity: 0, turn: 0, touch: null });
    }

    chamber.listen?.();

    let loudest = 0;

    for (let frame = 0; frame < 40; frame += 1) {
      chamber.update({ dt: 0.05, gravity: Math.PI, turn: 0, touch: null });
      const sound = chamber.listen?.();

      expect(sound?.wash).toBe(0);
      loudest = Math.max(loudest, ...(sound?.impacts.map((impact) => impact.strength) ?? [0]));
    }

    expect(loudest).toBeGreaterThan(0);
  });
});

/**
 * Where the pile has gathered, down the cell.
 *
 * Read off where the pieces are drawn rather than out of the scene, because
 * the scene is the chamber's own business now — which is the whole point of
 * the fitting. The first translate is the drag; the rest are the pieces.
 */
function middleOf(chamber: ReturnType<typeof createGlassChamber>): number {
  const ctx = createFakeContext();

  chamber.paint(asContext(ctx), view);

  const [, ...pieces] = ctx.argsOf('translate') as [number, number][];

  expect(pieces.length).toBeGreaterThan(0);

  return pieces.reduce((sum, [, y]) => sum + y, 0) / pieces.length;
}
