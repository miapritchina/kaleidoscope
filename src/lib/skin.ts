/**
 * Choosing where in a picture each piece is cut from.
 *
 * Cutting every piece from a uniformly random spot works on a photograph that
 * is interesting all over, and fails badly on the kind of picture anyone
 * actually reaches for. A stock shot of gemstones is a handful of subjects on a
 * plain backdrop; cut at random, most pieces come out as blank backdrop and the
 * gems land on two of them.
 *
 * So the picture is scored once, coarsely, and the pieces are drawn from the
 * parts of it that carry something. On a photograph with no plain backdrop the
 * scores come out flat and this reduces to the uniform choice it replaced.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * One object cut out of a picture: its shape, and where it came from.
 *
 * The outline and the source rectangle are in the same normalised frame, so
 * drawing the rectangle into a box `2r` across and clipping to the outline
 * scaled by `r` lines the two up exactly.
 */
export interface SkinCut {
  /** The object's shape, scaled so its furthest point is 1 from the centre. */
  readonly outline: readonly Point[];
  /** Where in the picture it is, in the picture's own pixels. */
  readonly source: Rect;
  /** The object's proportions, longest side 1. Keeps a splinter a splinter. */
  readonly extent: Point;
  /**
   * Area of the traced silhouette, in the outline's own units.
   *
   * A circle of the size the object was cut to fit has area `pi`, so this over
   * `pi` is how much of that circle is glass. Mass goes with it: a sliver
   * should not weigh what the pebble beside it does simply because it is as
   * long.
   */
  readonly area: number;
}

export interface SkinPatches {
  /**
   * Where to cut one piece from.
   *
   * @param draw The piece's own fixed pair of numbers in `[0, 1)`. The same
   *   pair always maps to the same patch, which is what lets a piece keep its
   *   scrap of picture while it tumbles.
   * @returns Position along the available travel, each axis in `[0, 1]`.
   */
  pick(draw: Point): Point;
  /**
   * The objects found in the picture, largest first. Empty when it has no
   * plain backdrop to separate them from, or too few to be worth using.
   */
  readonly cuts: readonly SkinCut[];
  /** One of those objects, fixed for a given piece. `null` when there are none. */
  cut(draw: Point): SkinCut | null;
}

export interface SkinPatchOptions {
  /** Side of one patch, as a fraction of the picture's shorter side. */
  patch: number;
  createCanvas?: () => HTMLCanvasElement;
}

/** Candidate positions across each axis. */
const GRID = 10;

/**
 * Side the picture is worked at.
 *
 * Coarse on purpose — this is not a thumbnail — but the objects are traced off
 * this raster, so it sets how well their edges come out. At 96 a photograph of
 * nine beads left each one about twenty pixels across, and a silhouette traced
 * at twenty pixels and then drawn two hundred wide is visibly scalloped: the
 * beads came out as flowers. This is scored once per picture, so the cost of
 * being finer is paid once and is a few milliseconds.
 */
const SAMPLE = 160;

/** Corners on a traced outline. Enough for a crystal, few enough to clip cheaply. */
const OUTLINE_CORNERS = 28;

/**
 * Halvings used to pin down where a ray leaves an object.
 *
 * Six takes the half-pixel the search ends on down to under a hundredth of one,
 * which is far below anything the raster itself can say.
 */
const EDGE_PASSES = 6;

/** Smallest object worth cutting out, as a share of the picture. */
const MIN_OBJECT = 0.002;

/**
 * Largest, as a share of the picture.
 *
 * Past this the "object" is the whole photograph — which is what a picture with
 * no plain backdrop gives — and cutting every piece to that one silhouette
 * would be a chamber of identical shapes.
 */
const MAX_OBJECT = 0.55;

/** Fewest objects worth switching to. Below this the patch path reads better. */
const MIN_OBJECTS = 3;

/** Most objects kept, largest first. A busy picture can label hundreds. */
const MAX_OBJECTS = 24;

/**
 * How far the traced outline is pulled in, as a fraction.
 *
 * The picture is scored small, so the ring of pixels where an object meets the
 * backdrop is a blend of the two — far enough from the backdrop colour to count
 * as the object, and pale enough to read as a halo drawn round it. Taking the
 * silhouette in by a few percent cuts inside that ring.
 */
const OUTLINE_TRIM = 0.93;

/**
 * How far a pixel must sit from the backdrop colour to count as content.
 *
 * In channel units summed across the three, so roughly "a tenth of the way
 * across the cube". Low enough to keep a shadowed edge, high enough to reject
 * the compression noise in a flat white.
 */
const CONTENT_DISTANCE = 78;

/** Alpha at which a pixel counts as part of an object rather than its fringe. */
const ALPHA_SOLID = 128;

/**
 * How much of a picture must be transparent before its alpha is trusted alone.
 *
 * A photograph has none, and a stray transparent corner is not a cut-out. A
 * genuine one is mostly nothing.
 */
const ALPHA_SHARE = 0.05;

/**
 * How sharply the choice favours the better patches.
 *
 * Squared: a patch twice as full of content is four times as likely. Enough to
 * empty out the plain backdrop without collapsing onto the single best spot,
 * which would put the identical crop on every piece.
 */
const BIAS = 2;

/** The weight every patch keeps, so nowhere is impossible and nothing divides by zero. */
const FLOOR = 0.02;

/**
 * Scores a picture and returns a patch chooser for it.
 *
 * Returns `null` when the picture cannot be measured or read — a video with no
 * frames yet, a canvas with no context — and the caller should fall back to
 * cutting at random.
 */
export function createSkinPatches(
  source: CanvasImageSource,
  { patch, createCanvas = () => document.createElement('canvas') }: SkinPatchOptions,
): SkinPatches | null {
  const size = measureSource(source);

  if (size.width <= 0 || size.height <= 0) {
    return null;
  }

  const pixels = samplePicture(source, createCanvas);

  if (!pixels) {
    return null;
  }

  const backdrop = borderColor(pixels);
  const content = contentMask(pixels, backdrop);
  const weights = scorePatches(content, size, patch);
  const cuts = cutOutObjects(content, size);

  return {
    pick: (draw) => choose(weights, draw),
    cuts,
    cut: (draw) => (cuts.length === 0 ? null : cuts[index(draw.x, cuts.length)]!),
  };
}

/**
 * Finds the separate objects in a picture and traces each one.
 *
 * A photograph of a handful of things on a plain backdrop is a handful of
 * islands in the content mask, so they come out of a flood fill. What comes
 * back are shapes to cut pieces to — the picture's own objects rather than
 * generated polygons — which only works when the picture really is a few
 * separate things; the guards below are what decide that.
 */
function cutOutObjects(content: Float32Array, size: Size): SkinCut[] {
  const labels = new Int32Array(content.length).fill(-1);
  const blobs: { pixels: number[]; area: number }[] = [];
  const queue: number[] = [];

  for (let start = 0; start < content.length; start += 1) {
    if (content[start] === 0 || labels[start] !== -1) {
      continue;
    }

    const label = blobs.length;
    const pixels: number[] = [];
    labels[start] = label;
    queue.length = 0;
    queue.push(start);

    // Iterative: a photograph-sized region would blow a recursive fill's stack.
    while (queue.length > 0) {
      const at = queue.pop()!;
      pixels.push(at);

      const x = at % SAMPLE;
      const y = Math.floor(at / SAMPLE);

      for (const [dx, dy] of NEIGHBOURS) {
        const nx = x + dx;
        const ny = y + dy;

        if (nx < 0 || ny < 0 || nx >= SAMPLE || ny >= SAMPLE) {
          continue;
        }

        const next = ny * SAMPLE + nx;

        if (content[next] !== 0 && labels[next] === -1) {
          labels[next] = label;
          queue.push(next);
        }
      }
    }

    blobs.push({ pixels, area: pixels.length / content.length });
  }

  const kept = blobs
    .filter((blob) => blob.area >= MIN_OBJECT && blob.area <= MAX_OBJECT)
    .sort((a, b) => b.area - a.area)
    .slice(0, MAX_OBJECTS);

  if (kept.length < MIN_OBJECTS) {
    return [];
  }

  return kept.map((blob) => traceObject(blob.pixels, size)).filter((cut) => cut !== null);
}

/** The four-way neighbourhood. Diagonals would bridge objects that merely touch. */
const NEIGHBOURS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * Turns one blob of pixels into an outline and a source rectangle.
 *
 * Traced by casting rays out from the middle and taking the furthest pixel of
 * the blob along each: a star-shaped approximation. Exact for the compact,
 * roughly convex things this is for — crystals, pebbles, beads — and it cannot
 * produce the self-intersecting mess a contour walk gives on a ragged edge.
 */
function traceObject(pixels: readonly number[], size: Size): SkinCut | null {
  let left = SAMPLE;
  let right = 0;
  let top = SAMPLE;
  let bottom = 0;
  let sumX = 0;
  let sumY = 0;

  const inside = new Set(pixels);

  for (const at of pixels) {
    const x = at % SAMPLE;
    const y = Math.floor(at / SAMPLE);

    left = Math.min(left, x);
    right = Math.max(right, x + 1);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y + 1);
    sumX += x + 0.5;
    sumY += y + 0.5;
  }

  const width = right - left;
  const height = bottom - top;

  if (width < 2 || height < 2) {
    return null;
  }

  // Everything is measured from the bounding box's middle rather than the
  // blob's, so the outline and the source rectangle share an origin.
  const middleX = (left + right) / 2;
  const middleY = (top + bottom) / 2;
  // Rays are cast from the blob's own middle, which for a crescent is the only
  // point that can see all of it.
  const fromX = sumX / pixels.length;
  const fromY = sumY / pixels.length;
  const half = Math.max(width, height) / 2;
  const reach = Math.hypot(width, height);

  // Bilinear between pixel centres, which turns the blob's staircase edge into
  // a ramp that crosses a half exactly where the edge really is. Reading whole
  // pixels instead rounds every ray to the raster, independently — which on an
  // object twenty pixels across is five percent each way, and is the difference
  // between a bead and a flower.
  const cover = (x: number, y: number): number => {
    const atX = x - 0.5;
    const atY = y - 0.5;
    const left = Math.floor(atX);
    const top = Math.floor(atY);
    const acrossX = atX - left;
    const acrossY = atY - top;
    const solid = (column: number, row: number) =>
      column >= 0 &&
      row >= 0 &&
      column < SAMPLE &&
      row < SAMPLE &&
      inside.has(row * SAMPLE + column)
        ? 1
        : 0;

    return (
      solid(left, top) * (1 - acrossX) * (1 - acrossY) +
      solid(left + 1, top) * acrossX * (1 - acrossY) +
      solid(left, top + 1) * (1 - acrossX) * acrossY +
      solid(left + 1, top + 1) * acrossX * acrossY
    );
  };

  const hits: number[] = [];

  for (let corner = 0; corner < OUTLINE_CORNERS; corner += 1) {
    const angle = (corner / OUTLINE_CORNERS) * Math.PI * 2;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    let hit = 0;
    let outside = reach;

    for (let step = reach; step >= 0; step -= 0.5) {
      if (cover(fromX + dx * step, fromY + dy * step) >= 0.5) {
        hit = step;
        break;
      }

      outside = step;
    }

    // Then narrow the gap between the last step outside and the first inside,
    // which is where the edge actually falls.
    for (let pass = 0; pass < EDGE_PASSES; pass += 1) {
      const middle = (hit + outside) / 2;

      if (cover(fromX + dx * middle, fromY + dy * middle) >= 0.5) {
        hit = middle;
      } else {
        outside = middle;
      }
    }

    hits.push(hit);
  }

  const outline: Point[] = round(hits).map((hit, corner) => {
    const angle = (corner / OUTLINE_CORNERS) * Math.PI * 2;

    // Pulled in along the ray, so the silhouette erodes towards the object's
    // own middle rather than towards the corner of its bounding box.
    return {
      x: (fromX + Math.cos(angle) * hit * OUTLINE_TRIM - middleX) / half,
      y: (fromY + Math.sin(angle) * hit * OUTLINE_TRIM - middleY) / half,
    };
  });

  const acrossX = size.width / SAMPLE;
  const acrossY = size.height / SAMPLE;

  return {
    outline,
    source: {
      x: left * acrossX,
      y: top * acrossY,
      width: width * acrossX,
      height: height * acrossY,
    },
    extent: { x: width / (half * 2), y: height / (half * 2) },
    area: polygonArea(outline),
  };
}

/**
 * Takes the raster's jitter out of a ring of ray lengths.
 *
 * Each ray stops at the last whole pixel of the blob it passes through, so
 * neighbouring rays land a pixel apart on a shape that has no such step in it.
 * On an object twenty pixels across that is five percent, and every ray is
 * wrong independently — which is the difference between a bead and a flower.
 * A three-tap average around the ring removes what varies ray to ray and keeps
 * what does not, so a real corner survives while the noise does not.
 */
function round(radii: readonly number[]): number[] {
  return radii.map((radius, index) => {
    const before = radii[(index - 1 + radii.length) % radii.length]!;
    const after = radii[(index + 1) % radii.length]!;

    return (before + 2 * radius + after) / 4;
  });
}

/** Area enclosed by a closed polygon, by the shoelace formula. */
function polygonArea(outline: readonly Point[]): number {
  let twice = 0;

  for (const [index, at] of outline.entries()) {
    const next = outline[(index + 1) % outline.length]!;
    twice += at.x * next.y - next.x * at.y;
  }

  return Math.abs(twice) / 2;
}

/** A stable index into a list from a piece's fixed number. */
function index(draw: number, length: number): number {
  return Math.min(length - 1, Math.max(0, Math.floor(clampUnit(draw) * length)));
}

/** Redraws the picture small enough to score in a few thousand reads. */
function samplePicture(
  source: CanvasImageSource,
  createCanvas: () => HTMLCanvasElement,
): ImageData | null {
  const canvas = createCanvas();
  canvas.width = SAMPLE;
  canvas.height = SAMPLE;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  if (!ctx) {
    return null;
  }

  try {
    ctx.drawImage(source, 0, 0, SAMPLE, SAMPLE);

    return ctx.getImageData(0, 0, SAMPLE, SAMPLE);
  } catch {
    // A cross-origin picture taints the canvas and cannot be read back. Not a
    // reason to refuse to draw it — only a reason to cut it at random.
    return null;
  }
}

/**
 * The backdrop colour: the median of the border pixels.
 *
 * The median rather than the mean, so a subject that runs off one edge shifts
 * it not at all rather than a little. Taken per channel, which can name a
 * colour that is not in the picture — near enough for a threshold.
 */
function borderColor(pixels: ImageData): [number, number, number] {
  const edge: [number[], number[], number[]] = [[], [], []];
  const { width, height, data } = pixels;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x !== 0 && y !== 0 && x !== width - 1 && y !== height - 1) {
        continue;
      }

      const i = (y * width + x) * 4;
      edge[0].push(data[i]!);
      edge[1].push(data[i + 1]!);
      edge[2].push(data[i + 2]!);
    }
  }

  return [median(edge[0]), median(edge[1]), median(edge[2])];
}

/**
 * 1 where a pixel carries something, 0 where it is backdrop.
 *
 * A cut-out PNG has already been segmented by whoever made it, and its alpha
 * channel says exactly what is object and what is nothing. Where there is one,
 * it is used on its own and the colour is not consulted at all — a diamond with
 * near-black facets against a transparent ground reads as backdrop by colour,
 * which punches holes through the middle of it and breaks one gem into several.
 *
 * Only where there is no useful alpha does the backdrop colour decide, which is
 * the case for a photograph.
 */
function contentMask(pixels: ImageData, backdrop: [number, number, number]): Float32Array {
  const { width, height, data } = pixels;
  const mask = new Float32Array(width * height);
  let clear = 0;

  for (let p = 0; p < mask.length; p += 1) {
    if (data[p * 4 + 3]! < ALPHA_SOLID) {
      clear += 1;
    }
  }

  const keyed = clear / mask.length >= ALPHA_SHARE;

  for (let p = 0; p < mask.length; p += 1) {
    const i = p * 4;

    // Half-covered edge pixels — which is what downsampling a cut-out makes of
    // its outline — count as backdrop, so the silhouette lands inside the fringe.
    if (data[i + 3]! < ALPHA_SOLID) {
      mask[p] = 0;
      continue;
    }

    if (keyed) {
      mask[p] = 1;
      continue;
    }

    const distance =
      Math.abs(data[i]! - backdrop[0]) +
      Math.abs(data[i + 1]! - backdrop[1]) +
      Math.abs(data[i + 2]! - backdrop[2]);

    mask[p] = distance < CONTENT_DISTANCE ? 0 : 1;
  }

  return mask;
}

/**
 * Cumulative weight over the grid of candidate positions.
 *
 * Cumulative rather than a plain list so a piece's single number picks one in a
 * search rather than a scan, and so the weights need no normalising.
 */
function scorePatches(content: Float32Array, size: Size, patch: number): Float32Array {
  const side = Math.min(size.width, size.height) * patch;
  // The patch is square in picture pixels, so it covers a different fraction of
  // each axis whenever the picture is not.
  const across = Math.min(1, side / size.width) * SAMPLE;
  const down = Math.min(1, side / size.height) * SAMPLE;
  const cumulative = new Float32Array(GRID * GRID);
  let running = 0;

  for (let row = 0; row < GRID; row += 1) {
    for (let column = 0; column < GRID; column += 1) {
      const left = (column / (GRID - 1)) * (SAMPLE - across);
      const top = (row / (GRID - 1)) * (SAMPLE - down);
      running += FLOOR + fraction(content, left, top, across, down) ** BIAS;
      cumulative[row * GRID + column] = running;
    }
  }

  return cumulative;
}

/** What share of one patch carries content. */
function fraction(
  content: Float32Array,
  left: number,
  top: number,
  across: number,
  down: number,
): number {
  const x0 = Math.max(0, Math.round(left));
  const y0 = Math.max(0, Math.round(top));
  const x1 = Math.min(SAMPLE, Math.round(left + across));
  const y1 = Math.min(SAMPLE, Math.round(top + down));
  let carried = 0;
  let counted = 0;

  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      carried += content[y * SAMPLE + x]!;
      counted += 1;
    }
  }

  return counted === 0 ? 0 : carried / counted;
}

/** Turns a piece's fixed pair of numbers into a position in the picture. */
function choose(cumulative: Float32Array, draw: Point): Point {
  const total = cumulative[cumulative.length - 1] ?? 0;

  if (!(total > 0)) {
    return { x: clampUnit(draw.x), y: clampUnit(draw.y) };
  }

  const target = clampUnit(draw.x) * total;
  let index = cumulative.length - 1;

  for (let i = 0; i < cumulative.length; i += 1) {
    if (cumulative[i]! > target) {
      index = i;
      break;
    }
  }

  const column = index % GRID;
  const row = Math.floor(index / GRID);
  const cell = 1 / (GRID - 1);

  // The second number jitters within the chosen cell, decorrelated across the
  // two axes so the patches do not all sit on a diagonal.
  return {
    x: clampUnit(column * cell + (frac(draw.y * 7.13) - 0.5) * cell),
    y: clampUnit(row * cell + (frac(draw.y * 13.77) - 0.5) * cell),
  };
}

/**
 * Natural size of whatever the skin is: an image, a video, or a canvas.
 *
 * A video reports its layout size on `width`, which is not the size of the
 * frames it is playing, so it is asked separately.
 */
export function measureSource(source: CanvasImageSource): Size {
  if (typeof HTMLVideoElement !== 'undefined' && source instanceof HTMLVideoElement) {
    return { width: source.videoWidth, height: source.videoHeight };
  }

  const sized = source as { width?: number; height?: number };

  return { width: sized.width ?? 0, height: sized.height ?? 0 };
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);

  return sorted[Math.floor(sorted.length / 2)]!;
}

function frac(value: number): number {
  return value - Math.floor(value);
}

function clampUnit(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}
