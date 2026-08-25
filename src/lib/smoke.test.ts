import { describe, expect, it } from 'vitest';

import { AIR, CHAMBER_RADIUS, liquidCell } from './chamber';
import type { Shard } from './scene';
import { ROUND } from './shape';
import { createSmoke, DYES, GRID, paintSmoke, updateSmoke, type Smoke } from './smoke';

const OIL = liquidCell(0.35);

/** Where a grid cell's middle is, in cell units. */
const positionOf = (index: number) => -CHAMBER_RADIUS + ((index + 0.5) * 2 * CHAMBER_RADIUS) / GRID;

/** How much dye there is altogether, and where its middle of mass is. */
function ink(smoke: Smoke) {
  let total = 0;
  let x = 0;
  let y = 0;

  for (let d = 0; d < DYES; d += 1) {
    for (let j = 0; j < GRID; j += 1) {
      for (let i = 0; i < GRID; i += 1) {
        const much = smoke.dye[d]![i + j * GRID]!;

        total += much;
        x += much * positionOf(i);
        y += much * positionOf(j);
      }
    }
  }

  return { total, x: total > 0 ? x / total : 0, y: total > 0 ? y / total : 0 };
}

function run(smoke: Smoke, frames: number, swirl: number, shards: readonly Shard[] = []) {
  for (let frame = 0; frame < frames; frame += 1) {
    updateSmoke(smoke, { dt: 1 / 60, medium: OIL, swirl, angle: 0, shards });
  }
}

describe('createSmoke', () => {
  it('is the same ink for the same seed', () => {
    expect(Array.from(createSmoke(4).dye[0]!)).toEqual(Array.from(createSmoke(4).dye[0]!));
    expect(Array.from(createSmoke(4).dye[0]!)).not.toEqual(Array.from(createSmoke(5).dye[0]!));
  });

  it('pours the dye inside the wall and nowhere else', () => {
    const smoke = createSmoke(1);
    const poured = ink(smoke);

    expect(poured.total).toBeGreaterThan(0);

    for (let j = 0; j < GRID; j += 1) {
      for (let i = 0; i < GRID; i += 1) {
        const k = i + j * GRID;

        if (Math.hypot(positionOf(i), positionOf(j)) > CHAMBER_RADIUS) {
          expect(smoke.inside[k]).toBe(0);

          for (let d = 0; d < DYES; d += 1) {
            expect(smoke.dye[d]![k]).toBe(0);
          }
        }
      }
    }
  });
});

describe('updateSmoke', () => {
  // Ink needs something to be loose in. There is no fluid in a dry cell, so
  // there is nothing for it to do there.
  it('does nothing at all in a dry cell', () => {
    const smoke = createSmoke(2);
    const before = Array.from(smoke.dye[0]!);

    for (let frame = 0; frame < 60; frame += 1) {
      updateSmoke(smoke, { dt: 1 / 60, medium: AIR, swirl: 2, angle: 0, shards: [] });
    }

    expect(Array.from(smoke.dye[0]!)).toEqual(before);
  });

  it('carries the dye round with the swirl', () => {
    const smoke = createSmoke(3);
    const before = ink(smoke);

    run(smoke, 120, 2);

    const after = ink(smoke);
    // The middle of the ink has swung about the cell rather than sitting where
    // it was poured, and it has gone the way the fluid is turning.
    const swept = Math.atan2(after.y, after.x) - Math.atan2(before.y, before.x);

    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeGreaterThan(0.05);
    expect(Math.atan2(Math.sin(swept), Math.cos(swept))).toBeGreaterThan(0);
  });

  it('keeps the dye in the cell, and keeps most of it', () => {
    const smoke = createSmoke(5);
    const poured = ink(smoke).total;

    run(smoke, 600, 1.5);

    const left = ink(smoke).total;

    // Semi-Lagrangian advection is not conservative, so some is lost at the
    // wall and some to the sharpening; what matters is that the cell does not
    // quietly drain, which is what a fluid with sources and sinks in it does.
    expect(left).toBeGreaterThan(poured * 0.5);

    for (let d = 0; d < DYES; d += 1) {
      for (let k = 0; k < GRID * GRID; k += 1) {
        expect(smoke.dye[d]![k]).toBeGreaterThanOrEqual(0);
        expect(smoke.dye[d]![k]).toBeLessThanOrEqual(1);

        if (!smoke.inside[k]) {
          expect(smoke.dye[d]![k]).toBe(0);
        }
      }
    }
  });

  // The part that makes the ink belong to this chamber rather than to a
  // screensaver: a piece sinking through the fluid pulls a wake behind it.
  it('lets the falling glass stir it', () => {
    const still = createSmoke(6);
    const stirred = createSmoke(6);
    const shard: Shard = {
      kind: 'bead',
      variant: 0,
      x: 0,
      y: 0,
      vx: 1.2,
      vy: 0,
      radius: 0.08,
      shape: ROUND,
      rotation: 0,
      spin: 0,
      skin: { x: 0.5, y: 0.5 },
    };

    run(still, 30, 0);
    run(stirred, 30, 0, [shard]);

    const middle = GRID / 2 + (GRID / 2) * GRID;

    expect(Math.abs(stirred.u[middle]!)).toBeGreaterThan(Math.abs(still.u[middle]!) + 0.05);
  });

  // Glass that has come to rest must not hold the fluid still with it: a cell
  // packed with settled shards would stop the ink dead everywhere at once.
  it('is not held still by glass that has stopped', () => {
    const smoke = createSmoke(7);
    const settled: Shard[] = Array.from({ length: 40 }, (_, index) => ({
      kind: 'bead',
      variant: 0,
      x: -0.8 + (index % 8) * 0.22,
      y: -0.5 + Math.floor(index / 8) * 0.22,
      vx: 0,
      vy: 0,
      radius: 0.08,
      shape: ROUND,
      rotation: 0,
      spin: 0,
      skin: { x: 0.5, y: 0.5 },
    }));

    run(smoke, 60, 2, settled);

    const middle = GRID / 2 + (GRID / 2) * GRID;

    expect(Math.hypot(smoke.u[middle]!, smoke.v[middle]!)).toBeGreaterThan(0.05);
  });

  // Stepped at its own rate rather than the frame's, with the time banked, so
  // the ink drifts at the same speed however fast the frames arrive.
  it('banks the time between steps', () => {
    const fast = createSmoke(8);
    const slow = createSmoke(8);

    for (let frame = 0; frame < 240; frame += 1) {
      updateSmoke(fast, { dt: 1 / 240, medium: OIL, swirl: 2, angle: 0, shards: [] });
    }

    for (let frame = 0; frame < 60; frame += 1) {
      updateSmoke(slow, { dt: 1 / 60, medium: OIL, swirl: 2, angle: 0, shards: [] });
    }

    const quick = ink(fast);
    const steady = ink(slow);

    expect(quick.x).toBeCloseTo(steady.x, 2);
    expect(quick.y).toBeCloseTo(steady.y, 2);
  });
});

describe('paintSmoke', () => {
  // jsdom has no canvas backend, so there is nothing to paint on; the caller is
  // expected to cope with that rather than the drawing being skipped upstream.
  it('hands back nothing rather than throwing where there is no canvas', () => {
    expect(paintSmoke(createSmoke(9), 1)).toBeNull();
  });

  it('hands back nothing when the cell is clear', () => {
    expect(paintSmoke(createSmoke(9), 0)).toBeNull();
  });
});
