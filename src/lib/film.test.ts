import { describe, expect, it } from 'vitest';

import { CHAMBER_RADIUS } from './chamber';
import { createFilm, filmColour, GRID, updateFilm } from './film';
import { positionOf, stirFlow } from './flow';

const still = { dt: 1 / 30, thickness: 0.35, swirl: 0, angle: 0 };

/** Total oil in the cell, which advection is meant to carry and not spend. */
function oilIn(film: ReturnType<typeof createFilm>): number {
  let total = 0;

  for (let k = 0; k < GRID * GRID; k += 1) {
    total += film.film[k]!;
  }

  return total;
}

describe('createFilm', () => {
  it('is deterministic for a seed', () => {
    expect(Array.from(createFilm(4).film)).toEqual(Array.from(createFilm(4).film));
    expect(Array.from(createFilm(4).film)).not.toEqual(Array.from(createFilm(5).film));
  });

  it('pours more oil for a larger amount', () => {
    expect(oilIn(createFilm(3, 1))).toBeGreaterThan(oilIn(createFilm(3, 0.1)));
  });

  it('keeps the oil inside the wall', () => {
    const film = createFilm(7, 1);

    for (let j = 0; j < GRID; j += 1) {
      for (let i = 0; i < GRID; i += 1) {
        const k = i + j * GRID;

        if (Math.hypot(positionOf(GRID, i), positionOf(GRID, j)) > CHAMBER_RADIUS) {
          expect(film.film[k]).toBe(0);
        }
      }
    }
  });
});

describe('updateFilm', () => {
  it('keeps the bands moving on their own', () => {
    const film = createFilm(3);
    const before = Array.from(film.film);

    for (let frame = 0; frame < 90; frame += 1) {
      updateFilm(film, still);
    }

    let changed = 0;

    for (let k = 0; k < GRID * GRID; k += 1) {
      if (Math.abs(film.film[k]! - before[k]!) > 0.01) {
        changed += 1;
      }
    }

    expect(changed).toBeGreaterThan(100);
  });

  it('carries the oil rather than spending it', () => {
    const film = createFilm(5);
    const before = oilIn(film);

    for (let frame = 0; frame < 180; frame += 1) {
      updateFilm(film, still);
    }

    // Advection loses a little at the wall and to the clamp; it must not
    // drain the cell.
    expect(oilIn(film)).toBeGreaterThan(before * 0.5);
    expect(oilIn(film)).toBeLessThan(before * 1.5);
  });

  it('takes a stir', () => {
    const film = createFilm(6);

    stirFlow(film, { x: 0, y: 0, vx: 3, vy: 0, reach: 0.4 });
    updateFilm(film, still);

    const middle = Math.floor(GRID / 2) * (GRID + 1);

    expect(Math.abs(film.u[middle]!)).toBeGreaterThan(0.2);
  });
});

describe('filmColour', () => {
  it('goes dark as the film vanishes, the way a bubble does before it pops', () => {
    const [r, g, b] = filmColour(0);

    // The half-turn phase flip at the top surface cancels every wavelength as
    // the thickness goes to nothing.
    expect(r + g + b).toBeLessThan(160 * 3 * 0.45);
  });

  it('wears different colours at different thicknesses', () => {
    const seen = new Set<string>();

    for (const at of [0.1, 0.25, 0.4, 0.55, 0.7, 0.85]) {
      seen.add(filmColour(at).join(','));
    }

    expect(seen.size).toBeGreaterThanOrEqual(5);
  });

  it('brightens each channel at its own thickness, which is what interference is', () => {
    // Somewhere in the sweep red should beat blue, and somewhere blue should
    // beat red — a pigment could not do both.
    let redWins = false;
    let blueWins = false;

    for (let at = 0; at <= 1; at += 0.02) {
      const [r, , b] = filmColour(at);

      if (r > b + 40) {
        redWins = true;
      }

      if (b > r + 40) {
        blueWins = true;
      }
    }

    expect(redWins).toBe(true);
    expect(blueWins).toBe(true);
  });
});
