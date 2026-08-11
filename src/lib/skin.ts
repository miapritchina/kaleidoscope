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
}

export interface SkinPatchOptions {
  /** Side of one patch, as a fraction of the picture's shorter side. */
  patch: number;
  createCanvas?: () => HTMLCanvasElement;
}

/** Candidate positions across each axis. */
const GRID = 10;

/** Side the picture is scored at. Coarse on purpose — this is not a thumbnail. */
const SAMPLE = 48;

/**
 * How far a pixel must sit from the backdrop colour to count as content.
 *
 * In channel units summed across the three, so roughly "a tenth of the way
 * across the cube". Low enough to keep a shadowed edge, high enough to reject
 * the compression noise in a flat white.
 */
const CONTENT_DISTANCE = 78;

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

  return { pick: (draw) => choose(weights, draw) };
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

/** 1 where a pixel carries something, 0 where it is backdrop. */
function contentMask(pixels: ImageData, backdrop: [number, number, number]): Float32Array {
  const { width, height, data } = pixels;
  const mask = new Float32Array(width * height);

  for (let p = 0; p < mask.length; p += 1) {
    const i = p * 4;
    const distance =
      Math.abs(data[i]! - backdrop[0]) +
      Math.abs(data[i + 1]! - backdrop[1]) +
      Math.abs(data[i + 2]! - backdrop[2]);
    // Fully transparent pixels are backdrop whatever colour they claim to be.
    mask[p] = data[i + 3]! < 128 || distance < CONTENT_DISTANCE ? 0 : 1;
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
