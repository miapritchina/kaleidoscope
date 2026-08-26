import { describe, expect, it } from 'vitest';

import { CHAMBER_RADIUS } from './chamber';
import { createLava, updateLava, type Lava } from './lava';

const still = { dt: 1 / 60, thickness: 0.35, swirl: 0, angle: 0 };

function run(lava: Lava, seconds: number, over: Partial<typeof still> = {}): void {
  for (let frame = 0; frame < seconds * 60; frame += 1) {
    updateLava(lava, { ...still, ...over });
  }
}

/**
 * The picture, coarsely: how much wax is over each cell of a small grid.
 *
 * The first build of the lava alternated between two arrangements at frame
 * rate — merging and splitting were a loop, and the loop ran at whatever rate
 * the frames arrived — and every per-blob measurement was happy while it did.
 * The only thing that would have caught it is measuring the picture from one
 * frame to the next, so that is what this does, and the cap below is the test
 * that the emergent model cannot bring the stagger back.
 */
const CELLS = 24;

function pictureOf(lava: Lava): Float32Array {
  const picture = new Float32Array(CELLS * CELLS);

  for (const drop of lava.drops) {
    const i = Math.min(
      CELLS - 1,
      Math.max(0, Math.floor(((drop.x + CHAMBER_RADIUS) / (2 * CHAMBER_RADIUS)) * CELLS)),
    );
    const j = Math.min(
      CELLS - 1,
      Math.max(0, Math.floor(((drop.y + CHAMBER_RADIUS) / (2 * CHAMBER_RADIUS)) * CELLS)),
    );

    picture[i + j * CELLS] = picture[i + j * CELLS]! + 1;
  }

  return picture;
}

function pictureShift(a: Float32Array, b: Float32Array): number {
  let total = 0;

  for (let k = 0; k < a.length; k += 1) {
    total += Math.abs(a[k]! - b[k]!);
  }

  return total;
}

describe('createLava', () => {
  it('is deterministic for a seed', () => {
    expect(createLava(9, 0.5)).toEqual(createLava(9, 0.5));
    expect(createLava(9, 0.5)).not.toEqual(createLava(10, 0.5));
  });

  it('pours more wax for a larger amount', () => {
    expect(createLava(1, 1).drops.length).toBeGreaterThan(createLava(1, 0.1).drops.length);
  });

  it('starts every drop inside the wall', () => {
    for (const drop of createLava(3, 1).drops) {
      expect(Math.hypot(drop.x, drop.y)).toBeLessThanOrEqual(CHAMBER_RADIUS);
    }
  });
});

describe('updateLava', () => {
  it('keeps the wax inside the wall while the cell turns', () => {
    const lava = createLava(5, 0.8);

    for (let frame = 0; frame < 60 * 12; frame += 1) {
      updateLava(lava, { ...still, angle: frame * 0.01, swirl: 0.4 });
    }

    for (const drop of lava.drops) {
      expect(Math.hypot(drop.x, drop.y)).toBeLessThanOrEqual(CHAMBER_RADIUS + 1e-6);
    }
  });

  it('never blows up', () => {
    const lava = createLava(6, 1);

    run(lava, 20);

    for (const drop of lava.drops) {
      expect(Number.isFinite(drop.x)).toBe(true);
      expect(Number.isFinite(drop.y)).toBe(true);
      expect(Math.hypot(drop.vx, drop.vy)).toBeLessThan(5);
    }
  });

  it('circulates rather than settling', () => {
    const lava = createLava(7, 0.6);

    // Let it find its cycle, then watch: over the next stretch drops should
    // cross the middle in both directions — risers going up, sinkers coming
    // down. A cell that has converged and stopped crosses nowhere, which is
    // exactly what the spring bug looked like.
    run(lava, 8);

    const sides = lava.drops.map((drop) => Math.sign(drop.y));
    let crossings = 0;

    for (let frame = 0; frame < 60 * 20; frame += 1) {
      updateLava(lava, still);

      for (let i = 0; i < lava.drops.length; i += 1) {
        const side = Math.sign(lava.drops[i]!.y);

        if (side !== 0 && sides[i] !== 0 && side !== sides[i]) {
          crossings += 1;
          sides[i] = side;
        }
      }
    }

    expect(crossings).toBeGreaterThan(lava.drops.length / 4);
  });

  it('holds together as wax rather than spreading as a gas', () => {
    const lava = createLava(8, 0.5);

    run(lava, 10);

    // Every drop should have company within its neighbourhood: the cohesion
    // draws the wax into clumps, and a clump is what the field draws as a
    // blob.
    const h = lava.reach * 1.8;
    let accompanied = 0;

    for (const drop of lava.drops) {
      const near = lava.drops.some(
        (other) => other !== drop && Math.hypot(other.x - drop.x, other.y - drop.y) < h,
      );

      if (near) {
        accompanied += 1;
      }
    }

    expect(accompanied).toBeGreaterThan(lava.drops.length * 0.8);
  });

  it('moves the picture smoothly, never in leaps', () => {
    const lava = createLava(11, 0.6);

    run(lava, 5);

    const pictures = [pictureOf(lava)];

    for (let frame = 0; frame < 60 * 5; frame += 1) {
      updateLava(lava, still);
      pictures.push(pictureOf(lava));
    }

    let oneFrame = 0;
    let twoFrames = 0;

    for (let i = 0; i + 1 < pictures.length; i += 1) {
      oneFrame += pictureShift(pictures[i]!, pictures[i + 1]!);
    }

    for (let i = 0; i + 2 < pictures.length; i += 1) {
      twoFrames += pictureShift(pictures[i]!, pictures[i + 2]!);
    }

    // The first build's fault was a *stagger*: the cell alternated between two
    // arrangements at frame rate, so every frame moved a great deal of picture
    // and every second frame moved almost none. Measured as a size, that is
    // indistinguishable from wax that simply moves quickly — which this wax now
    // does, since the drive was raised to break bodies apart. Measured as a
    // direction it is unmistakable, and needs no threshold to be tuned: motion
    // that goes somewhere covers more ground in two frames than in one, and
    // motion that alternates covers less.
    expect(twoFrames / (pictures.length - 2)).toBeGreaterThan(
      (oneFrame / (pictures.length - 1)) * 1.2,
    );

    // And it is still wax rather than a firework: no single frame moves more
    // than a fraction of the cell's drops a whole grid square.
    let worst = 0;

    for (let i = 0; i + 1 < pictures.length; i += 1) {
      worst = Math.max(worst, pictureShift(pictures[i]!, pictures[i + 1]!));
    }

    expect(worst).toBeLessThan(lava.drops.length);
  });

  it('takes a stir', () => {
    const lava = createLava(12, 0.6);

    run(lava, 2);

    const before = lava.drops.map((drop) => ({ x: drop.x, y: drop.y }));

    for (let frame = 0; frame < 30; frame += 1) {
      updateLava(lava, { ...still, stir: { x: 0, y: 0, vx: 2, vy: 0 } });
    }

    const pushed = lava.drops.filter(
      (drop, index) =>
        drop.x - before[index]!.x > 0.05 && Math.hypot(before[index]!.x, before[index]!.y) < 0.4,
    );

    expect(pushed.length).toBeGreaterThan(0);
  });
});
