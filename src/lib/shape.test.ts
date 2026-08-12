import { describe, expect, it } from 'vitest';

import { ROUND, shapeOf } from './shape';

/** Furthest any of the chain's circles reaches from the piece's middle. */
const reach = (beads: readonly { x: number; y: number; radius: number }[]) =>
  Math.max(...beads.map((bead) => Math.hypot(bead.x, bead.y) + bead.radius));

/** The largest gap left between neighbouring circles along the chain. */
const gap = (beads: readonly { x: number; y: number; radius: number }[]) =>
  Math.max(
    0,
    ...beads.slice(1).map((bead, index) => {
      const before = beads[index]!;

      return Math.hypot(bead.x - before.x, bead.y - before.y) - (bead.radius + before.radius);
    }),
  );

describe('shapeOf', () => {
  it('gives a piece as wide as it is long a single circle', () => {
    expect(shapeOf({ x: 1, y: 1 }).beads).toEqual(ROUND.beads);
  });

  it('breaks a splinter into a chain along its length', () => {
    const splinter = shapeOf({ x: 1, y: 0.2 });

    expect(splinter.beads.length).toBeGreaterThan(2);
    // Laid along the long axis and nowhere else.
    expect(splinter.beads.every((bead) => bead.y === 0)).toBe(true);
    expect(Math.max(...splinter.beads.map((bead) => bead.x))).toBeGreaterThan(0.5);
  });

  it('lays the chain along whichever axis is the long one', () => {
    const tall = shapeOf({ x: 0.2, y: 1 });

    expect(tall.beads.every((bead) => bead.x === 0)).toBe(true);
    expect(Math.max(...tall.beads.map((bead) => bead.y))).toBeGreaterThan(0.5);
  });

  // The chain has to be the length of the piece and have no holes in it: short
  // and the ends pass through things, gapped and so does the middle.
  it('covers the piece end to end without holes', () => {
    for (const thin of [1, 0.5, 0.3, 0.15, 0.05]) {
      const shape = shapeOf({ x: 1, y: thin });

      expect(reach(shape.beads), `${String(thin)} thick`).toBeCloseTo(1, 6);
      expect(gap(shape.beads), `${String(thin)} thick`).toBeLessThan(1e-9);
    }
  });

  // The cost of a pair of pieces is the square of this, and the gain falls away
  // quickly once the chain is finer than the piece is thick.
  it('never uses more circles than it needs to', () => {
    expect(shapeOf({ x: 1, y: 0.01 }).beads.length).toBeLessThanOrEqual(4);
    expect(shapeOf({ x: 1, y: 0.6 }).beads).toHaveLength(2);
  });

  // A sliver should not weigh what the pebble beside it does simply because it
  // is as long.
  it('weighs the glass rather than the circle it was cut from', () => {
    expect(shapeOf({ x: 1, y: 0.2 }, Math.PI * 0.2).bulk).toBeCloseTo(0.2, 6);
    expect(shapeOf({ x: 1, y: 1 }, Math.PI).bulk).toBe(1);
    // Never nothing, whatever a picture claims: a weightless piece divides by
    // zero everywhere in the solver.
    expect(shapeOf({ x: 1, y: 0.2 }, 0).bulk).toBeGreaterThan(0);
  });

  // How hard a piece is to turn is not how hard it is to shift, and it does not
  // follow its length either: a thin rod is *easier* to turn than a disc of the
  // same reach, because a disc has mass out at that reach in every direction
  // while a rod has it along one line. A rod about its middle is `L^2 / 3`
  // against a disc's `r^2 / 2`.
  it('makes a splinter a rod rather than a disc', () => {
    expect(shapeOf({ x: 1, y: 0.05 }).gyration).toBeCloseTo(1 / 3, 1);
    expect(shapeOf({ x: 1, y: 0.05 }).gyration).toBeLessThan(ROUND.gyration);
  });

  it('agrees with a uniform disc for a round piece', () => {
    expect(shapeOf({ x: 1, y: 1 }).gyration).toBeCloseTo(0.5, 9);
  });

  it('falls back to the circle for proportions that are not ones', () => {
    expect(shapeOf({ x: 0, y: 0 })).toBe(ROUND);
    expect(shapeOf({ x: Number.NaN, y: 1 })).toBe(ROUND);
  });
});
