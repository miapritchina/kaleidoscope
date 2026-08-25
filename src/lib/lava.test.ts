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
    settled: 0,
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

/** The metaball field on a coarse grid: what is drawn, without needing a canvas. */
function field(lava: Lava, n = 48): Float32Array {
  const out = new Float32Array(n * n);
  const width = (2 * CHAMBER_RADIUS) / n;

  for (const blob of lava.blobs) {
    for (let j = 0; j < n; j += 1) {
      const y = -CHAMBER_RADIUS + (j + 0.5) * width - blob.y;

      for (let i = 0; i < n; i += 1) {
        const x = -CHAMBER_RADIUS + (i + 0.5) * width - blob.x;
        const away = (x * x + y * y) / (blob.reach * blob.reach);

        if (away < 1) {
          out[i + j * n] = out[i + j * n]! + (1 - away) * (1 - away);
        }
      }
    }
  }

  return out;
}

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

  // The bug this replaced: aiming every blob at a temperature read off its own
  // height, everywhere, makes lift point at the middle from both directions.
  // That is a spring and not a cycle — the cell converges on its own centre and
  // stops, and what motion is left is blobs merging and splitting.
  it('carries a blob from one end of the cell to the other and back', () => {
    const lava: Lava = { seed: 1, blobs: [one(0.3, { y: 0.9, heat: 0.5 })] };
    const [blob] = lava.blobs as [Blob];
    let highest = blob.y;
    let lowest = blob.y;

    // Long enough for a full circuit: measured, one takes about ten seconds.
    for (let frame = 0; frame < 60 * 14; frame += 1) {
      updateLava(lava, still);
      highest = Math.min(highest, blob.y);
      lowest = Math.max(lowest, blob.y);
    }

    // Warmed at the bottom, gone all the way up, cooled, and come back —
    // rather than stalling half way where the temperature it is aiming at
    // happens to match its own.
    expect(highest).toBeLessThan(-0.7);
    expect(lowest).toBeGreaterThan(0.7);
  });

  it('does not gather the whole cell at its middle', () => {
    const lava = createLava(11, 0.55);

    run(lava, 40);

    const spread =
      Math.max(...lava.blobs.map((blob) => blob.y)) - Math.min(...lava.blobs.map((blob) => blob.y));

    expect(spread).toBeGreaterThan(CHAMBER_RADIUS * 0.4);
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

// What a stagger looks like from the inside, and it is worth measuring because
// every other test in this file was happy while it was happening: every blob was
// inside the wall, the wax was conserved, the colours mixed and the count held
// steady the whole time.
//
// Merging makes a blob bigger and splitting makes it smaller, so the two are a
// loop, and with nothing to break it the loop ran at whatever rate the frames
// arrived — the cell alternating between two arrangements sixty times a second.
// Of the two below it is the second that fires on the code that shipped; the
// first is the plainer statement of the same thing and is kept as a floor.
describe('the picture from one frame to the next', () => {
  const churn = (lava: Lava, seconds: number, drawn = false) => {
    const look = drawn ? (at: Lava) => surface(field(at)) : field;
    let previous = look(lava);
    const changes: number[] = [];

    for (let frame = 0; frame < seconds * 60; frame += 1) {
      updateLava(lava, still);

      const now = look(lava);
      let moved = 0;
      let most = 0;

      for (let k = 0; k < now.length; k += 1) {
        const step = Math.abs(now[k]! - previous[k]!);

        moved += step;
        most = Math.max(most, step);
      }

      changes.push(drawn ? moved / now.length : most);
      previous = now;
    }

    return changes.sort((a, b) => a - b);
  };

  it('moves a little each frame rather than flipping between two of them', () => {
    for (const seed of [9, 21, 44]) {
      const changes = churn(createLava(seed, 0.55), 20);
      const median = changes[Math.floor(changes.length / 2)]!;

      // A blob's field peaks at 1, so a typical frame moving the field by a
      // tenth of that anywhere would already be a lurch. The flicker measured
      // 1.2 — more than a whole blob's worth, every frame.
      expect(median, `seed ${String(seed)}`).toBeLessThan(0.1);
    }
  });

  // Measured on what is drawn rather than on the field, and that distinction
  // matters here: most of a blob's field is well inside its own surface, where
  // a change of a whole unit moves nothing anybody can see. Merging and
  // splitting are discontinuous by nature; what matters is whether either of
  // them is a *pop*.
  it('has no frame that throws the picture about', () => {
    for (const seed of [9, 21, 44]) {
      const changes = churn(createLava(seed, 0.55), 20, true);
      const median = changes[Math.floor(changes.length / 2)]!;

      // Placed just clear of each other, the halves of a split moved as much of
      // the picture in one frame as two hundred ordinary frames do. Left
      // overlapping, the shape necks instead, and the worst frame is worth a
      // few dozen — which is a fast blob, not a jump.
      expect(changes[changes.length - 1]! / median, `seed ${String(seed)}`).toBeLessThan(60);
    }
  });
});

/** The field thresholded into what is actually painted. See SURFACE in lava.ts. */
function surface(of: Float32Array): Float32Array {
  const out = new Float32Array(of.length);

  for (let k = 0; k < of.length; k += 1) {
    const at = (of[k]! - 0.43) / 0.14;

    out[k] = at <= 0 ? 0 : at >= 1 ? 1 : at * at * (3 - 2 * at);
  }

  return out;
}

describe('paintLava', () => {
  // jsdom has no canvas backend, so there is nothing to paint on; the caller is
  // expected to cope with that rather than the drawing being skipped upstream.
  it('hands back nothing rather than throwing where there is no canvas', () => {
    expect(paintLava(createLava(7, 0.5))).toBeNull();
  });
});
