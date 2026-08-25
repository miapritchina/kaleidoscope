import { describe, expect, it } from 'vitest';

import { CHAMBER_RADIUS } from './chamber';
import { createLava, paintLava, updateLava, type Blob, type Lava } from './lava';

const still = { dt: 1 / 60, thickness: 0.35, swirl: 0, angle: 0 };

function run(lava: Lava, seconds: number, over = still) {
  for (let frame = 0; frame < seconds * 60; frame += 1) {
    updateLava(lava, over);
  }
}

/** How much wax there is, which merging and splitting are both meant to keep. */
const wax = (lava: Lava) => lava.blobs.reduce((sum, blob) => sum + blob.reach * blob.reach, 0);

function one(reach: number, at: Partial<Blob> = {}): Blob {
  return {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    reach,
    heat: 0.5,
    colour: [255, 0, 0],
    ...at,
  };
}

describe('createLava', () => {
  it('is the same lamp for the same seed', () => {
    expect(createLava(4, 0.5)).toEqual(createLava(4, 0.5));
    expect(createLava(4, 0.5)).not.toEqual(createLava(5, 0.5));
  });

  // More of it is a busier cell rather than a fuller one: the blobs are shared
  // out so they cover the same part of the chamber however many there are.
  it('makes more and smaller blobs the more it is asked for', () => {
    const few = createLava(1, 0);
    const many = createLava(1, 1);

    expect(many.blobs.length).toBeGreaterThan(few.blobs.length);
    expect(many.blobs[0]!.reach).toBeLessThan(few.blobs[0]!.reach);
    expect(wax(many) / wax(few)).toBeGreaterThan(0.6);
    expect(wax(many) / wax(few)).toBeLessThan(1.6);
  });

  it('sizes the blobs with the pinch', () => {
    expect(createLava(2, 0.5, 2).blobs[0]!.reach).toBeCloseTo(
      createLava(2, 0.5, 1).blobs[0]!.reach * 2,
      9,
    );
  });
});

describe('the heat cycle', () => {
  // What a lava lamp is. Nothing else lifts a blob, so if this does not work
  // the cell is a bag of sinking circles.
  it('warms what is at the bottom and cools what is at the top', () => {
    const lava: Lava = {
      seed: 1,
      blobs: [one(0.3, { y: 0.9, heat: 0.5 }), one(0.3, { y: -0.9, heat: 0.5 })],
    };
    const [low, high] = lava.blobs as [Blob, Blob];

    run(lava, 2);

    // Down the screen is +y, so the first is at the bottom.
    expect(low.heat).toBeGreaterThan(0.7);
    expect(high.heat).toBeLessThan(0.3);
  });

  it('sends the warm up and the cold down', () => {
    const lava: Lava = { seed: 1, blobs: [one(0.25, { heat: 1 }), one(0.25, { x: 0.6, heat: 0 })] };
    const [warm, cold] = lava.blobs as [Blob, Blob];

    // A short run, before either has had time to change temperature much.
    run(lava, 0.5);

    expect(warm.y).toBeLessThan(0);
    expect(cold.y).toBeGreaterThan(0);
  });

  it('keeps every blob inside the wall', () => {
    const lava = createLava(3, 0.8);

    run(lava, 20, { ...still, swirl: 3, angle: 1 });

    for (const blob of lava.blobs) {
      expect(Math.hypot(blob.x, blob.y)).toBeLessThanOrEqual(CHAMBER_RADIUS + 1e-9);
    }
  });
});

describe('running together and coming apart', () => {
  it('makes one blob of two that meet, keeping the wax', () => {
    const lava: Lava = { seed: 1, blobs: [one(0.2), one(0.2, { x: 0.05 })] };
    const before = wax(lava);

    run(lava, 0.1);

    expect(lava.blobs).toHaveLength(1);
    // Area adds rather than radius: two of a size make one about 1.4 across.
    expect(wax(lava)).toBeCloseTo(before, 6);
    expect(lava.blobs[0]!.reach).toBeCloseTo(0.2 * Math.SQRT2, 6);
  });

  it('mixes their colours in proportion rather than picking one', () => {
    const lava: Lava = {
      seed: 1,
      blobs: [one(0.2, { colour: [200, 0, 0] }), one(0.2, { x: 0.05, colour: [0, 200, 0] })],
    };

    run(lava, 0.1);

    expect(lava.blobs[0]!.colour[0]).toBeCloseTo(100, 0);
    expect(lava.blobs[0]!.colour[1]).toBeCloseTo(100, 0);
  });

  // Merging only runs one way, so without this every cell ends as one lump.
  it('pulls a blob that has grown too big into two', () => {
    const lava: Lava = { seed: 1, blobs: [one(CHAMBER_RADIUS, { vx: 0.4 })] };
    const before = wax(lava);

    run(lava, 0.1);

    expect(lava.blobs.length).toBeGreaterThan(1);
    expect(wax(lava)).toBeCloseTo(before, 6);
  });

  it('settles at neither one lump nor a hundred', () => {
    const lava = createLava(6, 0.6);

    run(lava, 60);

    expect(lava.blobs.length).toBeGreaterThan(1);
    expect(lava.blobs.length).toBeLessThan(40);
  });
});

describe('paintLava', () => {
  // jsdom has no canvas backend, so there is nothing to paint on; the caller is
  // expected to cope with that rather than the drawing being skipped upstream.
  it('hands back nothing rather than throwing where there is no canvas', () => {
    expect(paintLava(createLava(7, 0.5))).toBeNull();
  });
});
