import { describe, expect, it } from 'vitest';

import { CHAMBER_RADIUS } from './chamber';
import { createSmoke, DYES, GRID, paintSmoke, updateSmoke, type Smoke } from './smoke';

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

function run(smoke: Smoke, frames: number, swirl: number) {
  for (let frame = 0; frame < frames; frame += 1) {
    updateSmoke(smoke, { dt: 1 / 60, thickness: 0.35, swirl, angle: 0 });
  }
}

describe('createSmoke', () => {
  it('is the same ink for the same seed', () => {
    expect(Array.from(createSmoke(4).dye[0]!)).toEqual(Array.from(createSmoke(4).dye[0]!));
    expect(Array.from(createSmoke(4).dye[0]!)).not.toEqual(Array.from(createSmoke(5).dye[0]!));
  });

  it('pours more of it in when more is asked for', () => {
    const wisp = createSmoke(3, 0.1);
    const full = createSmoke(3, 1);

    expect(ink(full).total).toBeGreaterThan(ink(wisp).total * 1.5);
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
  it('carries the fluid round with the turning wall', () => {
    const smoke = createSmoke(3);

    run(smoke, 120, 2);

    // How fast the body of fluid is going round, averaged over the cell. The
    // dye's own middle is a poor witness — it sits near the centre, where a
    // rotation moves it hardly at all — so this asks the velocity field
    // directly.
    let spin = 0;
    let area = 0;

    for (let j = 0; j < GRID; j += 1) {
      for (let i = 0; i < GRID; i += 1) {
        const k = i + j * GRID;

        if (!smoke.inside[k]) {
          continue;
        }

        const x = positionOf(i);
        const y = positionOf(j);

        spin += x * smoke.v[k]! - y * smoke.u[k]!;
        area += x * x + y * y;
      }
    }

    expect(spin / area).toBeGreaterThan(0.5);
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

  // The cell has to keep moving with nobody turning it, or it is a picture
  // rather than an instrument. Nothing pushes on the fluid except the dye's own
  // weight: a heavy patch sinks, what it displaces comes up around it, and the
  // folding never quite settles.
  it('keeps folding over on itself with nothing stirring it', () => {
    const smoke = createSmoke(6);

    run(smoke, 120, 0);

    let moving = 0;

    for (let k = 0; k < GRID * GRID; k += 1) {
      if (Math.hypot(smoke.u[k]!, smoke.v[k]!) > 0.02) {
        moving += 1;
      }
    }

    expect(moving).toBeGreaterThan(GRID * GRID * 0.1);
  });

  // Stepped at its own rate rather than the frame's, with the time banked, so
  // the ink drifts at the same speed however fast the frames arrive.
  it('banks the time between steps', () => {
    const fast = createSmoke(8);
    const slow = createSmoke(8);

    for (let frame = 0; frame < 240; frame += 1) {
      updateSmoke(fast, { dt: 1 / 240, thickness: 0.35, swirl: 2, angle: 0 });
    }

    for (let frame = 0; frame < 60; frame += 1) {
      updateSmoke(slow, { dt: 1 / 60, thickness: 0.35, swirl: 2, angle: 0 });
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

  it('hands back nothing when there is nothing to see', () => {
    expect(paintSmoke(createSmoke(9), 0)).toBeNull();
  });
});
