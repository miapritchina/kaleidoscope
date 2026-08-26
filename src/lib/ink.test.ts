import { describe, expect, it } from 'vitest';

import { CHAMBER_RADIUS } from './chamber';
import { positionOf } from './flow';
import { createInk, GRID, PAINTS, paintInk, updateInk, type Ink } from './ink';

/** Where a grid cell's middle is, in cell units. */
const at = (index: number) => positionOf(GRID, index);

/** How much of one paint there is, and how far down the cell its middle sits. */
function held(ink: Ink, paint: number) {
  let total = 0;
  let down = 0;

  for (let j = 0; j < GRID; j += 1) {
    for (let i = 0; i < GRID; i += 1) {
      const much = ink.paint[paint]![i + j * GRID]!;

      total += much;
      down += much * at(j);
    }
  }

  return { total, down: total > 0 ? down / total : 0 };
}

/** Every paint together. */
function loaded(ink: Ink) {
  let total = 0;

  for (let paint = 0; paint < PAINTS; paint += 1) {
    total += held(ink, paint).total;
  }

  return total;
}

/**
 * Runs the cell for a stretch of its own life.
 *
 * Stepped at the rate the fluid actually runs at rather than at a frame rate,
 * so a minute of cell time costs a minute's worth of steps and not two.
 */
function run(ink: Ink, seconds: number, { swirl = 0, thickness = 0.35 } = {}) {
  for (let step = 0; step < seconds * 30; step += 1) {
    updateInk(ink, { dt: 1 / 30, thickness, swirl, angle: 0 });
  }
}

/**
 * A cell holding one cloud of all three paints at once, in exactly the same
 * place.
 *
 * The control for anything about settling: every paint starts with the same
 * middle of mass, so whatever gap opens between them afterwards is the paints
 * moving apart and not where they happened to be poured.
 */
function mixedCell(seed: number): Ink {
  const ink = createInk(seed, 0.8);

  for (let paint = 0; paint < PAINTS; paint += 1) {
    ink.paint[paint]!.fill(0);
  }

  for (let j = 0; j < GRID; j += 1) {
    for (let i = 0; i < GRID; i += 1) {
      const k = i + j * GRID;

      if (!ink.inside[k]) {
        continue;
      }

      const away = Math.hypot(at(i), at(j) + 0.3) / 0.55;

      if (away >= 1) {
        continue;
      }

      for (let paint = 0; paint < PAINTS; paint += 1) {
        ink.paint[paint]![k] = ink.palette.paints[paint]!.pour * (1 - away * away) ** 2;
      }
    }
  }

  return ink;
}

describe('createInk', () => {
  it('pours more of it in when more is asked for', () => {
    expect(loaded(createInk(3, 1))).toBeGreaterThan(loaded(createInk(3, 0.1)) * 1.5);
  });

  it('pours the paint inside the wall and nowhere else', () => {
    const ink = createInk(1);

    expect(loaded(ink)).toBeGreaterThan(0);

    for (let j = 0; j < GRID; j += 1) {
      for (let i = 0; i < GRID; i += 1) {
        const k = i + j * GRID;

        if (Math.hypot(at(i), at(j)) > CHAMBER_RADIUS) {
          expect(ink.inside[k]).toBe(0);

          for (let paint = 0; paint < PAINTS; paint += 1) {
            expect(ink.paint[paint]![k]).toBe(0);
          }
        }
      }
    }
  });

  // A strong paint is poured proportionally less, so a cell of Prussian and
  // potter's pink is not simply a cell of Prussian. See `pour` in
  // `lib/pigment.ts`; here it only has to reach the field.
  it('pours each paint to its own share and no further', () => {
    const ink = createInk(4, 1);

    for (let paint = 0; paint < PAINTS; paint += 1) {
      const share = ink.palette.paints[paint]!.pour;
      let most = 0;

      for (let k = 0; k < GRID * GRID; k += 1) {
        most = Math.max(most, ink.paint[paint]![k]!);
      }

      expect(most).toBeLessThanOrEqual(share + 1e-6);
      expect(most).toBeGreaterThan(share * 0.2);
    }
  });
});

describe('updateInk', () => {
  // The thing worth watching, and the reason this is not smoke with a better
  // palette. A cloud of mixed paint is one colour when it goes in; the paints
  // in it fall through the water at their own rates, so half a minute later the
  // coarse heavy one sits measurably below the fine light one and the cloud is
  // the colours it was mixed from, sorted.
  //
  // Started from one cloud holding all three, because that is the claim: they
  // begin in the same place and end in different ones. Left to the cell's own
  // clouds, each paint starts wherever it was poured, and where a cloud happens
  // to have been dropped swamps a tenth of a cell of drift.
  it('takes a mixture apart, heaviest lowest', { timeout: 60000 }, () => {
    for (const seed of [3, 11, 21]) {
      const ink = mixedCell(seed);
      const weights = ink.palette.paints.map((paint) => paint.weight);
      const heavy = weights.indexOf(Math.max(...weights));
      const light = weights.indexOf(Math.min(...weights));

      expect(held(ink, heavy).down).toBeCloseTo(held(ink, light).down, 6);

      run(ink, 25);

      expect(held(ink, heavy).down).toBeGreaterThan(held(ink, light).down + 0.1);
    }
  });

  // A liquid cell is sealed: there is no drain in it and nothing evaporates, so
  // paint that has settled against the wall is still paint. The trace does not
  // know that and loses whatever the flow crowds together — left to itself, an
  // early build held *nothing at all* after two minutes. See `conserveScalar`
  // in `lib/flow.ts`.
  it('still holds its paint after a minute and a half alone', { timeout: 60000 }, () => {
    const ink = createInk(5, 0.8);
    const poured = loaded(ink);

    run(ink, 90);

    expect(loaded(ink)).toBeGreaterThan(poured * 0.6);
  });

  it('keeps the paint in the cell and inside its range', { timeout: 60000 }, () => {
    const ink = createInk(5, 0.8);

    run(ink, 20, { swirl: 1.5 });

    for (let paint = 0; paint < PAINTS; paint += 1) {
      for (let k = 0; k < GRID * GRID; k += 1) {
        expect(ink.paint[paint]![k]).toBeGreaterThanOrEqual(0);

        if (!ink.inside[k]) {
          expect(ink.paint[paint]![k]).toBe(0);
        }
      }
    }
  });

  // Nobody is turning it and there is no warmth in it, so what keeps a cell of
  // paint alive is the suspension's own weight and the breeze. A cell that
  // comes to rest is a picture rather than an instrument.
  it('keeps moving with nothing stirring it', () => {
    const ink = createInk(6, 0.8);

    run(ink, 4);

    let moving = 0;

    for (let k = 0; k < GRID * GRID; k += 1) {
      if (Math.hypot(ink.u[k]!, ink.v[k]!) > 0.02) {
        moving += 1;
      }
    }

    expect(moving).toBeGreaterThan(GRID * GRID * 0.1);
  });

  // Stepped at its own rate rather than the frame's, with the time banked, so
  // the paint drifts at the same speed however fast the frames arrive.
  it('banks the time between steps', () => {
    const fast = createInk(8, 0.8);
    const slow = createInk(8, 0.8);

    for (let frame = 0; frame < 240; frame += 1) {
      updateInk(fast, { dt: 1 / 240, thickness: 0.35, swirl: 2, angle: 0 });
    }

    for (let frame = 0; frame < 60; frame += 1) {
      updateInk(slow, { dt: 1 / 60, thickness: 0.35, swirl: 2, angle: 0 });
    }

    expect(held(fast, 0).down).toBeCloseTo(held(slow, 0).down, 2);
  });

  // Thicker fluid holds up everything moving through it, which is the whole of
  // what the Thickness slider means. It is asked of the fluid rather than of
  // the paint's own settling, because settling is not what a still picture of
  // the cell shows: in thin fluid the overturning is fast enough to keep the
  // suspension stirred, and a paint that is sinking four times faster still
  // ends up no further down than one that is being carried back up.
  it('holds everything more still in a thicker fluid', { timeout: 60000 }, () => {
    const thin = createInk(12, 0.8);
    const gel = createInk(12, 0.8);
    const moving = (ink: Ink) => {
      let speed = 0;
      let cells = 0;

      for (let k = 0; k < GRID * GRID; k += 1) {
        if (ink.inside[k]) {
          speed += Math.hypot(ink.u[k]!, ink.v[k]!);
          cells += 1;
        }
      }

      return speed / cells;
    };

    run(thin, 20, { thickness: 0 });
    run(gel, 20, { thickness: 1 });

    expect(moving(thin)).toBeGreaterThan(moving(gel) * 2);
  });

  // Every setting of the slider, for as long as anyone would leave it running.
  // The fluid is a race between what puts energy in — the confinement, the
  // falling paint — and the drag that takes it out, and at the thin end of the
  // slider there is not enough drag to win it: an early build reached 10^33
  // cell widths a second in thirty seconds and then held nothing but NaN. See
  // `THINNEST` in `lib/ink.ts`.
  it('stays a number at every thickness', { timeout: 90000 }, () => {
    for (const thickness of [0, 0.5, 1]) {
      const ink = createInk(7, 0.8);

      run(ink, 45, { thickness });

      for (let k = 0; k < GRID * GRID; k += 1) {
        expect(Number.isFinite(ink.u[k]!)).toBe(true);
        expect(Number.isFinite(ink.v[k]!)).toBe(true);

        for (let paint = 0; paint < PAINTS; paint += 1) {
          expect(Number.isFinite(ink.paint[paint]![k]!)).toBe(true);
        }
      }

      expect(loaded(ink)).toBeGreaterThan(0);
    }
  });
});

describe('paintInk', () => {
  // jsdom has no canvas backend, so there is nothing to paint on; the caller is
  // expected to cope with that rather than the drawing being skipped upstream.
  it('hands back nothing rather than throwing where there is no canvas', () => {
    expect(paintInk(createInk(9), 1)).toBeNull();
  });

  it('hands back nothing when there is nothing to see', () => {
    expect(paintInk(createInk(9), 0)).toBeNull();
  });
});
