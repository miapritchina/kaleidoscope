import { describe, expect, it } from 'vitest';

import { cellNoise, foldIntoTriangle } from './fold';
import { type Vector } from './tiling';

const SQRT3 = Math.sqrt(3);
const SIDE = 90;

/** The same skewed frame the fold works in, so a test can name a mirror. */
function toSkew({ x, y }: Vector, side = SIDE): { u: number; v: number } {
  return { u: x / side - y / (side * SQRT3), v: (2 * y) / (side * SQRT3) };
}

function toPlane({ u, v }: { u: number; v: number }, side = SIDE): Vector {
  return { x: side * (u + v / 2), y: (side * v * SQRT3) / 2 };
}

/**
 * Reflects a point in one of the three mirrors bounding the source triangle.
 *
 * `which` picks the side: 0 is `u = 0`, 1 is `v = 0`, 2 is `w = 0`. These
 * generate the whole group, so composing them reaches every image of the
 * source triangle in the tiling.
 */
function mirror(point: Vector, which: number): Vector {
  const { u, v } = toSkew(point);
  const w = 1 - u - v;

  if (which === 0) {
    return toPlane({ u: -u, v: v + u });
  }

  if (which === 1) {
    return toPlane({ u: u + v, v: -v });
  }

  return toPlane({ u: u + w, v: v + w });
}

/** A point well inside the source triangle, given in barycentric shares. */
function inside(u: number, v: number): Vector {
  return toPlane({ u, v });
}

function near(a: Vector, b: Vector, tolerance = 1e-6): boolean {
  return Math.abs(a.x - b.x) < tolerance && Math.abs(a.y - b.y) < tolerance;
}

/** A repeatable spread of points, so a failure can be reproduced. */
function* scatter(count: number): Generator<Vector> {
  let seed = 12345;

  for (let n = 0; n < count; n += 1) {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    const x = ((seed / 4294967296) * 2 - 1) * SIDE * 12;
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    const y = ((seed / 4294967296) * 2 - 1) * SIDE * 12;

    yield { x, y };
  }
}

describe('foldIntoTriangle', () => {
  it('leaves a point in the source triangle where it is', () => {
    const point = inside(0.3, 0.4);
    const folded = foldIntoTriangle(point, SIDE);

    expect(near(folded.point, point)).toBe(true);
    expect(folded.bounces).toBe(0);
  });

  it('always lands inside the source triangle', () => {
    for (const point of scatter(400)) {
      const { u, v } = toSkew(foldIntoTriangle(point, SIDE).point);

      expect(u).toBeGreaterThan(-1e-9);
      expect(v).toBeGreaterThan(-1e-9);
      expect(u + v).toBeLessThan(1 + 1e-9);
    }
  });

  // The whole contract in one property: two points related by a symmetry of the
  // tiling are looking at the same place in the source. Everything else the
  // fold reports is decoration on top of this.
  it('sends every image of a point to the same place', () => {
    for (const point of scatter(120)) {
      const home = foldIntoTriangle(point, SIDE).point;

      for (const which of [0, 1, 2]) {
        const reflected = foldIntoTriangle(mirror(point, which), SIDE).point;

        expect(near(reflected, home, 1e-5)).toBe(true);
      }
    }
  });

  it('sends a point and its lattice translations to the same place', () => {
    // The two primitive steps, in the skewed frame: (2, -1) and (-1, 2).
    const steps = [
      { u: 2, v: -1 },
      { u: -1, v: 2 },
      { u: 1, v: 1 },
    ];

    for (const point of scatter(80)) {
      const home = foldIntoTriangle(point, SIDE).point;

      for (const step of steps) {
        const { u, v } = toSkew(point);
        const moved = toPlane({ u: u + step.u, v: v + step.v });

        expect(near(foldIntoTriangle(moved, SIDE).point, home, 1e-5)).toBe(true);
      }
    }
  });

  it('counts one bounce into each neighbour of the source', () => {
    const middle = inside(1 / 3, 1 / 3);

    for (const which of [0, 1, 2]) {
      expect(foldIntoTriangle(mirror(middle, which), SIDE).bounces).toBe(1);
    }
  });

  it('counts bounces up as the point walks away', () => {
    // Straight out along the x axis, which crosses a mirror every half-side.
    const seen = new Set<number>();

    for (let step = 0; step < 30; step += 1) {
      seen.add(foldIntoTriangle({ x: step * SIDE * 0.5, y: SIDE * 0.2 }, SIDE).bounces);
    }

    // Monotone and unbounded is the point: a radial gradient can fake the
    // first, but only a real count keeps up over a whole screen.
    expect(Math.max(...seen)).toBeGreaterThan(20);
  });

  it('puts the joins where the mirrors are', () => {
    // On a mirror, and a little off it.
    expect(foldIntoTriangle(toPlane({ u: 2, v: 0.4 }), SIDE).seam).toBeCloseTo(0, 6);

    const spacing = (SIDE * SQRT3) / 2;
    const off = foldIntoTriangle(toPlane({ u: 2.25, v: 0.4 }), SIDE).seam;

    expect(off).toBeCloseTo(spacing * 0.25, 4);
  });

  it('never claims a join is further than half the spacing', () => {
    const half = (SIDE * SQRT3) / 4;

    for (const point of scatter(200)) {
      expect(foldIntoTriangle(point, SIDE).seam).toBeLessThanOrEqual(half + 1e-9);
    }
  });

  it('numbers the six facets the way the triangles are traced', () => {
    // Triangle k is the sector from k sixths of a turn to the next, measured
    // at the hexagon's centre — which for these points is the origin.
    for (let facet = 0; facet < 6; facet += 1) {
      const turn = (facet + 0.5) * (Math.PI / 3);
      const reach = SIDE * 0.4;
      const point = { x: Math.cos(turn) * reach, y: Math.sin(turn) * reach };

      expect(foldIntoTriangle(point, SIDE).facet).toBe(facet);
    }
  });

  it('gives the six cells of a hexagon six different facets', () => {
    const facets = new Set<number>();

    for (let facet = 0; facet < 6; facet += 1) {
      const turn = (facet + 0.5) * (Math.PI / 3);
      facets.add(
        foldIntoTriangle({ x: Math.cos(turn) * SIDE * 0.5, y: Math.sin(turn) * SIDE * 0.5 }, SIDE)
          .facet,
      );
    }

    expect(facets.size).toBe(6);
  });

  it('keeps a hexagon together and tells it from its neighbours', () => {
    // Everything within the middle hexagon is cell (0, 0)...
    for (let facet = 0; facet < 6; facet += 1) {
      const turn = (facet + 0.5) * (Math.PI / 3);
      const cell = foldIntoTriangle(
        { x: Math.cos(turn) * SIDE * 0.4, y: Math.sin(turn) * SIDE * 0.4 },
        SIDE,
      ).cell;

      expect(cell).toEqual({ i: 0, j: 0 });
    }

    // ...and a step along the lattice is a different one. The steps are the
    // same `a` and `b` as `hexLattice`, whose span is side * sqrt(3).
    const span = SIDE * SQRT3;

    expect(foldIntoTriangle({ x: (span * SQRT3) / 2, y: span / 2 }, SIDE).cell).toEqual({
      i: 1,
      j: 0,
    });
    expect(foldIntoTriangle({ x: 0, y: span }, SIDE).cell).toEqual({ i: 0, j: 1 });
  });

  it('survives a degenerate side and a point that is not a number', () => {
    expect(foldIntoTriangle({ x: 1, y: 1 }, 0).point).toEqual({ x: 0, y: 0 });
    expect(foldIntoTriangle({ x: Number.NaN, y: 1 }, SIDE).point).toEqual({ x: 0, y: 0 });
  });
});

describe('cellNoise', () => {
  it('gives the same cell the same value', () => {
    expect(cellNoise(3, -7)).toBe(cellNoise(3, -7));
  });

  it('stays inside the unit interval', () => {
    for (let i = -20; i <= 20; i += 1) {
      for (let j = -20; j <= 20; j += 1) {
        const value = cellNoise(i, j);

        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(1);
      }
    }
  });

  it('spreads evenly enough to break up the field', () => {
    const buckets = [0, 0, 0, 0];

    for (let i = -30; i <= 30; i += 1) {
      for (let j = -30; j <= 30; j += 1) {
        buckets[Math.min(3, Math.floor(cellNoise(i, j) * 4))]! += 1;
      }
    }

    const total = buckets.reduce((sum, count) => sum + count, 0);

    for (const count of buckets) {
      expect(count / total).toBeGreaterThan(0.2);
      expect(count / total).toBeLessThan(0.3);
    }
  });
});
