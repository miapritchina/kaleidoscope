import { describe, expect, it } from 'vitest';

import { CHAMBER_RADIUS } from './chamber';
import { createSmoke, DYES, GRID, HOLD, paintSmoke, updateSmoke, type Smoke } from './smoke';

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

    // The cell is sealed and `conserveScalar` hands back what the trace loses,
    // so the dye that was poured in is still in there — not most of it, all of
    // it. It used to be 82% after ten seconds and 18% after two minutes, which
    // is a leak documented in ROADMAP.md and left alone for a long time.
    expect(left).toBeGreaterThan(poured * 0.95);

    let least = Infinity;
    let most = -Infinity;
    let outside = 0;

    for (let d = 0; d < DYES; d += 1) {
      for (let k = 0; k < GRID * GRID; k += 1) {
        const held = smoke.dye[d]![k]!;

        least = Math.min(least, held);
        most = Math.max(most, held);

        if (!smoke.inside[k]) {
          outside = Math.max(outside, Math.abs(held));
        }
      }
    }

    // Read off rather than asserted per cell: twenty-seven thousand
    // expectations is a slow test and says nothing three do not.
    expect(least).toBeGreaterThanOrEqual(0);
    expect(most).toBeLessThanOrEqual(HOLD);
    expect(outside).toBe(0);
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

describe('warmth', () => {
  it('opens the cell warm where the dye is', () => {
    const smoke = createSmoke(3);
    let together = 0;

    for (let k = 0; k < GRID * GRID; k += 1) {
      let dyed = 0;

      for (let d = 0; d < DYES; d += 1) {
        dyed += smoke.dye[d]![k]!;
      }

      if (dyed > 0.5) {
        expect(smoke.heat[k]).toBeGreaterThan(0);
        together += 1;
      }
    }

    expect(together).toBeGreaterThan(0);
  });

  it('lifts the fluid against gravity where the cell is warm', () => {
    const smoke = createSmoke(6);

    // Strip the dye out, leaving only the warmth, so the lift is measured on
    // its own rather than against the dye's weight.
    for (let d = 0; d < DYES; d += 1) {
      smoke.dye[d]!.fill(0);
    }

    for (let frame = 0; frame < 30; frame += 1) {
      updateSmoke(smoke, { dt: 1 / 30, thickness: 0.35, swirl: 0, angle: 0 });
    }

    // Down at angle 0 is +y, so warm fluid should on balance be moving in -y.
    let lift = 0;

    for (let k = 0; k < GRID * GRID; k += 1) {
      lift += smoke.v[k]! * smoke.heat[k]!;
    }

    expect(lift).toBeLessThan(0);
  });
});

describe('the breeze', () => {
  it('keeps an emptied cell from ever quite stopping', () => {
    const smoke = createSmoke(9);

    // No dye, no warmth, no turning: the one thing left is the breeze.
    for (let d = 0; d < DYES; d += 1) {
      smoke.dye[d]!.fill(0);
    }

    smoke.heat.fill(0);
    smoke.u.fill(0);
    smoke.v.fill(0);

    for (let frame = 0; frame < 60 * 10; frame += 1) {
      updateSmoke(smoke, { dt: 1 / 60, thickness: 0.35, swirl: 0, angle: 0 });
    }

    let moving = 0;

    for (let k = 0; k < GRID * GRID; k += 1) {
      moving += Math.hypot(smoke.u[k]!, smoke.v[k]!);
    }

    const average = moving / (GRID * GRID);

    // Alive, and a whisper: a breeze, not a gale.
    expect(average).toBeGreaterThan(0.001);
    expect(average).toBeLessThan(0.5);
  });
});
