/**
 * The geometry of a three-mirror kaleidoscope.
 *
 * A real tube is a triangular prism of three mirrors. Reflecting in its three
 * sides generates the (3,3,3) triangle group: six equilateral triangles meet
 * around every vertex, alternating mirrored, to form a hexagon — and those
 * hexagons then repeat across the whole field by translation. What you see is a
 * tessellation filling the view, not a single rosette spun about the centre.
 *
 * The repeat is a genuine translation because composing reflections in two
 * parallel mirror lines is a translation of twice their spacing: the lines lie
 * `side * sqrt(3) / 2` apart, so the lattice steps by `side * sqrt(3)`.
 */

export interface Vector {
  x: number;
  y: number;
}

export interface HexLattice {
  /** Circumradius of the hexagon, equal to the triangle's side. */
  radius: number;
  /** Primitive translations between neighbouring hexagon centres. */
  a: Vector;
  b: Vector;
}

const SQRT3 = Math.sqrt(3);

/**
 * Lattice for hexagons of the given circumradius, vertices at 0, 60, 120...
 *
 * Neighbouring centres sit `sqrt(3) * radius` away, rotated 30 degrees from the
 * vertices, so the two primitive steps are at 30 and 90 degrees.
 */
export function hexLattice(radius: number): HexLattice {
  const span = SQRT3 * radius;

  return {
    radius,
    a: { x: (span * SQRT3) / 2, y: span / 2 },
    b: { x: 0, y: span },
  };
}

/** A hexagon in the tiling: where it sits, and which cell of the lattice it is. */
export interface HexagonCell extends Vector {
  /** Steps along the lattice's two primitive translations. */
  i: number;
  j: number;
}

export interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/**
 * Every hexagon needed to cover `bounds`, with its lattice coordinates.
 *
 * Solves the corners of the region in lattice coordinates rather than walking a
 * square grid, so a rotated or off-centre region does not drag in a ring of
 * hexagons that are never seen.
 *
 * @param margin Extra rings beyond the region, to cover partial hexagons.
 */
export function coverWithHexagons(bounds: Bounds, lattice: HexLattice, margin = 1): HexagonCell[] {
  const { a, b } = lattice;
  const determinant = a.x * b.y - a.y * b.x;

  if (determinant === 0 || !Number.isFinite(determinant)) {
    return [];
  }

  const corners: Vector[] = [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.minX, y: bounds.maxY },
    { x: bounds.maxX, y: bounds.maxY },
  ];

  let minI = Infinity;
  let maxI = -Infinity;
  let minJ = Infinity;
  let maxJ = -Infinity;

  for (const corner of corners) {
    // Inverse of the 2x2 lattice matrix, applied to the corner.
    const i = (corner.x * b.y - corner.y * b.x) / determinant;
    const j = (a.x * corner.y - a.y * corner.x) / determinant;

    minI = Math.min(minI, i);
    maxI = Math.max(maxI, i);
    minJ = Math.min(minJ, j);
    maxJ = Math.max(maxJ, j);
  }

  const centres: HexagonCell[] = [];

  for (let j = Math.floor(minJ) - margin; j <= Math.ceil(maxJ) + margin; j += 1) {
    for (let i = Math.floor(minI) - margin; i <= Math.ceil(maxI) + margin; i += 1) {
      centres.push({ x: a.x * i + b.x * j, y: a.y * i + b.y * j, i, j });
    }
  }

  return centres;
}

/**
 * Traces one of the six triangles of a hexagon, apex at the origin.
 *
 * Triangle `index` is rotated `index * 60` degrees; odd ones are reflections, so
 * that neighbours always meet mirror to mirror as the real glass does.
 */
export function traceTriangle(
  ctx: CanvasRenderingContext2D,
  side: number,
  index: number,
  bleed = 0,
): void {
  const step = Math.PI / 3;
  const reflected = index % 2 === 1;

  ctx.rotate(reflected ? (index + 1) * step : index * step);

  if (reflected) {
    ctx.scale(1, -1);
  }

  // Grown along the bisector so neighbouring triangles overlap rather than
  // leaving the backdrop showing through a hairline where two antialiased
  // edges meet.
  const grown = side + bleed;
  const apex = bleed === 0 ? 0 : bleed / Math.sin(step / 2);

  ctx.beginPath();
  ctx.moveTo(-apex * Math.cos(step / 2), -apex * Math.sin(step / 2));
  ctx.lineTo(grown, 0);
  ctx.lineTo(grown * Math.cos(step), grown * Math.sin(step));
  ctx.closePath();
}

/** Traces a hexagon of the given circumradius, centred on the origin. */
export function traceHexagon(ctx: CanvasRenderingContext2D, radius: number): void {
  ctx.beginPath();

  for (let corner = 0; corner < 6; corner += 1) {
    const angle = (corner * Math.PI) / 3;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;

    if (corner === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }

  ctx.closePath();
}
