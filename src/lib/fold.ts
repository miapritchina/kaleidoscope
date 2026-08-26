/**
 * Folding the plane back into the one triangle the source is painted in.
 *
 * The 2D renderer builds the figure by *drawing* it: six clipped triangles into
 * a hexagon, that hexagon stamped across the field. This is the same figure
 * approached from the other end. Given any point on the screen, it answers
 * where in the source triangle that point is looking, and how it got there.
 *
 * That inversion is what a fragment shader needs, and it is also strictly more
 * informative. Drawing knows where it put each triangle; folding knows, for
 * every pixel, how many mirrors the light crossed to reach it and how close it
 * is to a join. Both are quantities the 2D path has to approximate with a
 * radial gradient and a stroked line, because it never has them per pixel.
 *
 * ## The coordinates
 *
 * Everything happens in a skewed frame where the tiling is made of whole
 * numbers. With the source triangle at `(0, 0)`, `(side, 0)` and
 * `(side/2, side*sqrt(3)/2)`, put
 *
 *     u = x/side - y/(side*sqrt(3))
 *     v = 2y/(side*sqrt(3))
 *     w = 1 - u - v
 *
 * and `(w, u, v)` are barycentric coordinates for the triangle's three corners.
 * The source triangle is exactly `u >= 0, v >= 0, w >= 0`, and the mirrors of
 * the whole tiling are exactly the lines where any one of them is a whole
 * number — three families, sixty degrees apart, which is what makes the cells
 * triangles.
 *
 * Written that way the three interesting quantities are arithmetic:
 *
 * - **Which mirror to reflect in** is whichever coordinate went negative.
 * - **How many mirrors were crossed** is how many whole numbers lie between the
 *   point and the source. In a reflection group the number of walls separating
 *   two chambers *is* the length of the element taking one to the other, so
 *   this is the exact bounce count and not a stand-in for it.
 * - **How far the nearest join is** is the distance to the nearest whole number
 *   in any of the three, scaled back into pixels.
 *
 * ## Why the lattice step comes first
 *
 * Reflecting until every coordinate is positive does terminate, but it takes
 * one step per mirror crossed, and the corner of a phone screen is thirty-odd
 * mirrors out. So the point is first moved by a whole number of lattice steps —
 * one jump, in closed form — which lands it in the hexagon around the origin.
 * From there the six triangles are a dihedral group of order six and no point
 * is more than three reflections from home.
 */

import { type Vector } from './tiling';

const SQRT3 = Math.sqrt(3);

/** A sixth of a turn: the angle one triangle subtends at a hexagon's centre. */
const SIXTH = Math.PI / 3;

/**
 * Most reflections the fold will make after the lattice step.
 *
 * Three is the longest word in a dihedral group of order six, which is what the
 * six triangles around a vertex are. Twice that so a point sitting exactly on a
 * mirror, where floating point can disagree with itself about which side it is
 * on, cannot spin.
 */
const MOST_REFLECTIONS = 6;

/** Where a screen point is looking, and what the light did on the way. */
export interface Folded {
  /** The point in the source triangle, in the same pixels as `side`. */
  readonly point: Vector;
  /**
   * How many mirrors the light bounced off.
   *
   * Exact, not estimated: it is the number of mirror lines between this point
   * and the source triangle.
   */
  readonly bounces: number;
  /** Which of the six cells of its hexagon, `0` to `5`, numbered as `traceTriangle` does. */
  readonly facet: number;
  /** Which hexagon, in the same lattice coordinates as `coverWithHexagons`. */
  readonly cell: { readonly i: number; readonly j: number };
  /** Distance to the nearest mirror join, in the same pixels as `side`. */
  readonly seam: number;
}

/**
 * Folds a point of the field into the source triangle.
 *
 * The point is in the field's own frame — the one where the source triangle has
 * its apex at the origin — so a caller working in screen pixels has to undo the
 * view's placement first. See `placeField` in the renderer.
 */
export function foldIntoTriangle(point: Vector, side: number): Folded {
  if (!(side > 0) || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    return {
      point: { x: 0, y: 0 },
      bounces: 0,
      facet: 0,
      cell: { i: 0, j: 0 },
      seam: 0,
    };
  }

  const u = point.x / side - point.y / (side * SQRT3);
  const v = (2 * point.y) / (side * SQRT3);
  const w = 1 - u - v;

  // Both of these are read off the point where it stands, before anything is
  // folded — they describe the journey, and the folded point has forgotten it.
  const bounces = Math.abs(Math.floor(u)) + Math.abs(Math.floor(v)) + Math.abs(Math.floor(w));
  const seam = nearestJoin(u, v, w) * ((side * SQRT3) / 2);

  const cell = nearestHexagon(u, v);
  // The lattice steps, in this frame, are (2, -1) and (-1, 2); a hexagon at
  // lattice (i, j) sits at i*(1, 1) + j*(-1, 2), which is i of the first step
  // and i + j of the second.
  const originU = 2 * cell.i - (cell.i + cell.j);
  const originV = -cell.i + 2 * (cell.i + cell.j);

  const facet = facetAround(u - originU, v - originV);

  let foldU = u - originU;
  let foldV = v - originV;
  let foldW = 1 - foldU - foldV;

  for (let step = 0; step < MOST_REFLECTIONS; step += 1) {
    // Reflecting in a side leaves the corner opposite it alone and hands that
    // corner's share to the other two — which in these coordinates is the
    // whole of the reflection.
    if (foldU < 0) {
      foldV += foldU;
      foldW += foldU;
      foldU = -foldU;
    } else if (foldV < 0) {
      foldU += foldV;
      foldW += foldV;
      foldV = -foldV;
    } else if (foldW < 0) {
      foldU += foldW;
      foldV += foldW;
      foldW = -foldW;
    } else {
      break;
    }
  }

  return {
    point: { x: side * (foldU + foldV / 2), y: (side * foldV * SQRT3) / 2 },
    bounces,
    facet,
    cell,
    seam,
  };
}

/** Distance to the nearest mirror, as a fraction of the spacing between them. */
function nearestJoin(u: number, v: number, w: number): number {
  return Math.min(
    Math.abs(u - Math.round(u)),
    Math.abs(v - Math.round(v)),
    Math.abs(w - Math.round(w)),
  );
}

/**
 * Which hexagon a point belongs to.
 *
 * The hexagon centres are the lattice, so this is a nearest-lattice-point
 * question, and a hexagonal lattice does not answer that by rounding: the cell
 * is a hexagon, not a parallelogram, and rounding gives the parallelogram. So
 * the four corners of the parallelogram the point lands in are measured and the
 * nearest wins, which is the same answer for one more line of arithmetic.
 */
function nearestHexagon(u: number, v: number): { i: number; j: number } {
  // In units of the two lattice steps.
  const along = (2 * u + v) / 3;
  const across = (u + 2 * v) / 3;

  let bestI = 0;
  let bestJ = 0;
  let bestDistance = Infinity;

  for (let stepAlong = 0; stepAlong < 2; stepAlong += 1) {
    for (let stepAcross = 0; stepAcross < 2; stepAcross += 1) {
      const m = Math.floor(along) + stepAlong;
      const n = Math.floor(across) + stepAcross;
      const centreU = 2 * m - n;
      const centreV = -m + 2 * n;
      // Measured on the plane rather than in the skewed frame, where a corner
      // that is two steps away can look nearer than one that is one step away.
      const dx = u - centreU + (v - centreV) / 2;
      const dy = ((v - centreV) * SQRT3) / 2;
      const distance = dx * dx + dy * dy;

      if (distance < bestDistance) {
        bestDistance = distance;
        bestI = m;
        bestJ = n - m;
      }
    }
  }

  return { i: bestI, j: bestJ };
}

/**
 * Which of the six triangles around a hexagon's centre a point is in.
 *
 * Numbered as `traceTriangle` numbers them, so the two renderers give the same
 * cell the same exposure: triangle `k` is the sixty-degree sector from `k/6` to
 * `(k + 1)/6` of a turn.
 */
function facetAround(u: number, v: number): number {
  const x = u + v / 2;
  const y = (v * SQRT3) / 2;
  const turn = Math.atan2(y, x);
  const sixth = Math.floor(turn / SIXTH);

  return ((sixth % 6) + 6) % 6;
}

/**
 * A fixed, evenly spread value in `[0, 1)` for the hexagon at `(i, j)`.
 *
 * Shared with the shader, which runs the same integer hash on the same
 * coordinates, so the two renderers vary the same hexagons by the same amount.
 * An integer hash rather than a seeded generator: this is wanted per hexagon per
 * frame, in any order, and it has to give the same answer for the same cell
 * every time or the field would shimmer as it is panned across.
 *
 * The two coordinates are folded in one after the other, and the seed is not
 * decoration. Both are here because the obvious form of this —
 * `imul(i, a) ^ imul(j, b)`, avalanched once — has two faults that are
 * invisible in a histogram and perfectly visible on screen:
 *
 * - **A fixed point at zero.** Every step of a multiply-xor-shift takes 0 to
 *   0, so the hexagon at the origin came back as exactly 0 while its
 *   neighbours averaged a half. That hexagon is the middle of the view, and
 *   the exposure this feeds only ever *darkens* — so the one hexagon nobody
 *   can look away from was the one hexagon never dimmed. Against the white
 *   ground a liquid cell is lit on, it read as a hole punched in the middle of
 *   the figure. The seed breaks it; any odd constant would, and this is the
 *   golden ratio's.
 * - **A symmetry through the origin.** Negating both coordinates left the
 *   xor of the two products unchanged for about a third of the lattice, so a
 *   third of all hexagons wore exactly the exposure of their opposite number
 *   through the middle of the view. A field with a half-turn symmetry in it is
 *   the same tell this variation exists to remove, one step subtler. Mixing
 *   `i` before `j` meets it, because there is no longer a pair of independent
 *   products for the negation to cancel across.
 *
 * Two multiplies rather than one. It runs per hexagon per frame in the 2D path
 * and per pixel in the shader, and neither could measure the difference.
 */
export function cellNoise(i: number, j: number): number {
  let hash = Math.imul(i, 0x27d4eb2d) ^ 0x9e3779b9;
  hash = Math.imul(hash ^ (hash >>> 15), 0x85ebca6b) ^ Math.imul(j, 0x165667b1);
  hash = Math.imul(hash ^ (hash >>> 13), 0x2545f491);
  hash ^= hash >>> 16;

  return (hash >>> 0) / 4294967296;
}
