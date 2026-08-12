import { describe, expect, it } from 'vitest';

import { asContext, createFakeContext } from '../test/fakeCanvas';
import {
  coverWithHexagons,
  hexLattice,
  latticePeriod,
  traceHexagon,
  traceTriangle,
} from './tiling';

const SQRT3 = Math.sqrt(3);

describe('hexLattice', () => {
  // Composing reflections in two parallel mirrors translates by twice their
  // spacing, and the mirror lines of a triangle of side s lie s*sqrt(3)/2 apart.
  it('steps between centres by sqrt(3) times the triangle side', () => {
    const { a, b } = hexLattice(10);

    expect(Math.hypot(a.x, a.y)).toBeCloseTo(10 * SQRT3, 6);
    expect(Math.hypot(b.x, b.y)).toBeCloseTo(10 * SQRT3, 6);
  });

  it('places the two steps 60 degrees apart, as a hexagonal lattice does', () => {
    const { a, b } = hexLattice(10);
    const angle = Math.abs(Math.atan2(a.y, a.x) - Math.atan2(b.y, b.x));

    expect(angle).toBeCloseTo(Math.PI / 3, 6);
  });
});

describe('latticePeriod', () => {
  const radius = 12;
  const { a, b } = hexLattice(radius);

  /** How many steps of each primitive translation the vector is, if whole. */
  const stepsFor = ({ x, y }: { x: number; y: number }) => {
    const determinant = a.x * b.y - a.y * b.x;

    return {
      i: (x * b.y - y * b.x) / determinant,
      j: (a.x * y - a.y * x) / determinant,
    };
  };

  const isLatticeVector = (vector: { x: number; y: number }) => {
    const { i, j } = stepsFor(vector);

    return Math.abs(i - Math.round(i)) < 1e-9 && Math.abs(j - Math.round(j)) < 1e-9;
  };

  // The whole seamless tile rests on this: a rectangle of these proportions cut
  // out of the field is a period of it, so a copy laid beside it continues the
  // pattern rather than merely matching along the join.
  it('is a translation the tiling repeats by, both ways', () => {
    const { x: width, y: height } = latticePeriod(radius);

    expect(isLatticeVector({ x: width, y: 0 })).toBe(true);
    expect(isLatticeVector({ x: 0, y: height })).toBe(true);
  });

  it('is the smallest such rectangle', () => {
    const { x: width, y: height } = latticePeriod(radius);

    // Anything shorter in either direction lands between lattice points.
    for (const fraction of [1 / 2, 1 / 3, 2 / 3, 3 / 4]) {
      expect(isLatticeVector({ x: width * fraction, y: 0 })).toBe(false);
      expect(isLatticeVector({ x: 0, y: height * fraction })).toBe(false);
    }
  });

  // Which is why the tile cannot be square, and why it used to be built out of
  // four mirrored quarters instead.
  it('is sqrt(3) to 1, a ratio no whole number of steps can square up', () => {
    const { x: width, y: height } = latticePeriod(radius);

    expect(width / height).toBeCloseTo(SQRT3, 12);
  });
});

describe('coverWithHexagons', () => {
  const lattice = hexLattice(20);

  it('covers every point of the region', () => {
    const bounds = { minX: -100, maxX: 100, minY: -80, maxY: 80 };
    const centres = coverWithHexagons(bounds, lattice);

    // Every sampled point must fall inside some hexagon, or the field would
    // show gaps of bare backdrop between tiles.
    for (let x = bounds.minX; x <= bounds.maxX; x += 7) {
      for (let y = bounds.minY; y <= bounds.maxY; y += 7) {
        const nearest = Math.min(...centres.map((c) => Math.hypot(c.x - x, c.y - y)));

        // A point by a hexagon's corner is a full circumradius from its centre,
        // so that — not the inradius — is the covering bound.
        expect(nearest).toBeLessThanOrEqual(20 + 1e-6);
      }
    }
  });

  it('scales the count with the area rather than a fixed grid', () => {
    const small = coverWithHexagons({ minX: 0, maxX: 40, minY: 0, maxY: 40 }, lattice);
    const large = coverWithHexagons({ minX: 0, maxX: 400, minY: 0, maxY: 400 }, lattice);

    expect(large.length).toBeGreaterThan(small.length * 10);
  });

  it('follows the region rather than always sitting at the origin', () => {
    const far = coverWithHexagons({ minX: 900, maxX: 1000, minY: 900, maxY: 1000 }, lattice);

    expect(far.every((centre) => centre.x > 500 && centre.y > 500)).toBe(true);
  });

  it('returns nothing for a degenerate lattice', () => {
    expect(
      coverWithHexagons(
        { minX: 0, maxX: 10, minY: 0, maxY: 10 },
        { radius: 0, a: { x: 0, y: 0 }, b: { x: 0, y: 0 } },
      ),
    ).toEqual([]);
  });
});

describe('traceTriangle', () => {
  it('reflects every other triangle, so neighbours meet mirror to mirror', () => {
    const even = createFakeContext();
    const odd = createFakeContext();

    traceTriangle(asContext(even), 10, 0);
    traceTriangle(asContext(odd), 10, 1);

    expect(even.countOf('scale')).toBe(0);
    expect(odd.argsOf('scale')[0]).toEqual([1, -1]);
  });

  it('rotates each triangle into its own sixth of the hexagon', () => {
    const context = createFakeContext();

    traceTriangle(asContext(context), 10, 2);

    expect(context.argsOf('rotate')[0]).toEqual([(2 * Math.PI) / 3]);
  });

  it('grows the triangle when bled, so neighbours overlap instead of showing a seam', () => {
    const tight = createFakeContext();
    const bled = createFakeContext();

    traceTriangle(asContext(tight), 10, 0);
    traceTriangle(asContext(bled), 10, 0, 2);

    const [tightApex] = tight.argsOf('moveTo');
    const [bledApex] = bled.argsOf('moveTo');

    // Unbled, the apex sits exactly on the hexagon centre (allowing for -0).
    expect(Math.hypot(tightApex![0] as number, tightApex![1] as number)).toBe(0);
    // Pulled back along the bisector, off the hexagon centre.
    expect(Math.hypot(bledApex![0] as number, bledApex![1] as number)).toBeGreaterThan(0);
  });
});

describe('traceHexagon', () => {
  it('closes a six-sided path', () => {
    const context = createFakeContext();

    traceHexagon(asContext(context), 10);

    expect(context.countOf('moveTo')).toBe(1);
    expect(context.countOf('lineTo')).toBe(5);
    expect(context.countOf('closePath')).toBe(1);
  });
});
