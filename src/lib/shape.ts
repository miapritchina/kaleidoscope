/**
 * What a piece of glass is, as far as the chamber is concerned.
 *
 * The pieces are drawn as polygons — the silhouettes traced out of the picture
 * they are cut from — but a polygon solver is a different machine entirely:
 * contact manifolds, several touch points per pair, a full inertia tensor. A
 * chain of circles laid along the piece gets most of the way there on the same
 * machine, because a circle against a circle is what the chamber already does.
 *
 * One circle cannot tell a needle from a pebble: it is the same in every
 * direction, so a sliver on its end and a sliver lying flat take up exactly the
 * same room, two of them cross straight through each other, and neither can
 * ever bridge a gap. Three or four along its length can do all three.
 *
 * Everything here is in multiples of the piece's own radius, so a shape can be
 * shared by every piece cut from the same object.
 */

/** One circle of the chain, in the piece's own frame. */
export interface Bead {
  x: number;
  y: number;
  radius: number;
}

/** A corner of a hull, in the same frame. */
export interface Point {
  x: number;
  y: number;
}

export interface Shape {
  readonly beads: readonly Bead[];
  /**
   * Convex hull of the traced silhouette, in multiples of the piece's radius,
   * or absent where there is no silhouette to take one of.
   *
   * Not for this solver: the chain of circles is all it can collide. It is for
   * a solver that can take a polygon — see `lib/chamberRapier.ts` — so a
   * splinter collides as the splinter that was traced rather than as the
   * circles laid along it.
   */
  readonly hull?: readonly Point[];
  /**
   * Area of the glass as a fraction of the circle it was cut to fit.
   *
   * What mass goes with. A sliver should not weigh what the pebble beside it
   * does simply because it is as long.
   */
  readonly bulk: number;
  /**
   * Radius of gyration squared, in multiples of the piece's radius squared.
   *
   * How hard the piece is to turn, which is a separate question from how hard
   * it is to shift and does not simply follow its length. A uniform disc is
   * `1/2`; a thin rod of the same reach is `1/3`, and *easier* to turn, because
   * the disc has mass out at that reach in every direction while the rod has it
   * along one line.
   */
  readonly gyration: number;
}

/**
 * Most circles a piece is broken into.
 *
 * The cost is the square of this per pair of pieces, and the gain falls away
 * quickly: two already tell an end from a middle, and four hold a twenty-to-one
 * splinter closely enough that nothing visibly passes through it.
 */
const MOST_BEADS = 4;

/** A piece as wide as it is long: one circle, filling its own. */
export const ROUND: Shape = {
  beads: [{ x: 0, y: 0, radius: 1 }],
  bulk: 1,
  gyration: 0.5,
};

/**
 * Lays a chain of circles along a piece of the given proportions.
 *
 * @param extent Half-width and half-height, the longer of them 1, as
 *   `lib/skin.ts` reports them for a traced object.
 * @param area Area of the glass in the same units, or left out for the circle.
 * @param outline The traced silhouette in the same units, for a solver that can
 *   collide a polygon. Left out, the shape carries no hull and every solver
 *   falls back to the chain.
 */
export function shapeOf(
  extent: { x: number; y: number },
  area?: number,
  outline?: readonly Point[],
): Shape {
  const long = Math.max(extent.x, extent.y);
  const short = Math.min(extent.x, extent.y);

  if (!(long > 0) || !(short > 0)) {
    return ROUND;
  }

  // One circle per width of length, so the chain is about as fine as the piece
  // is thick — capped, since past a point it is paying for detail nobody sees.
  const count = Math.min(MOST_BEADS, Math.max(1, Math.round(long / short)));
  // Wide enough to cover the length without gaps between neighbours, and never
  // narrower than the piece actually is.
  const radius = Math.max(short, long / count);
  const span = Math.max(0, long - radius);
  const alongX = extent.x >= extent.y;

  const beads = Array.from({ length: count }, (_, index) => {
    const at = count === 1 ? 0 : -span + (2 * span * index) / (count - 1);

    return { x: alongX ? at : 0, y: alongX ? 0 : at, radius };
  });

  const shape: Shape = {
    beads,
    bulk: Math.min(1, Math.max(0.02, (area ?? Math.PI) / Math.PI)),
    gyration: gyrationOf(beads),
  };

  return outline && outline.length >= 3 ? { ...shape, hull: convexHull(outline) } : shape;
}

/**
 * The convex hull of a traced outline, by Andrew's monotone chain.
 *
 * The trace is star-shaped rather than convex, so its outline can fold in on
 * itself in ways no contact solver wants to reason about; the hull is the
 * tightest shape that cannot. What it gives away is the concavities, which for
 * the compact, roughly convex objects the tracer is built for is very little.
 */
function convexHull(outline: readonly Point[]): readonly Point[] {
  const points = outline
    .slice()
    .sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x))
    .filter((point, index, all) => {
      const prior = all[index - 1];

      return prior?.x !== point.x || prior.y !== point.y;
    });

  if (points.length < 3) {
    return points;
  }

  const cross = (o: Point, a: Point, b: Point): number =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const half = (walk: readonly Point[]): Point[] => {
    const chain: Point[] = [];

    for (const point of walk) {
      while (
        chain.length >= 2 &&
        cross(chain[chain.length - 2]!, chain[chain.length - 1]!, point) <= 0
      ) {
        chain.pop();
      }

      chain.push(point);
    }

    chain.pop();

    return chain;
  };

  return [...half(points), ...half(points.slice().reverse())];
}

/**
 * How far the mass sits from the middle, squared.
 *
 * Each circle carries its share by area, and its own spread about its own
 * centre — a disc's `r^2 / 2` — by the parallel axis theorem.
 */
function gyrationOf(beads: readonly Bead[]): number {
  let mass = 0;
  let spread = 0;

  for (const bead of beads) {
    const share = bead.radius ** 2;

    mass += share;
    spread += share * (bead.x ** 2 + bead.y ** 2 + bead.radius ** 2 / 2);
  }

  return mass === 0 ? ROUND.gyration : spread / mass;
}
