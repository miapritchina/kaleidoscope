import { CHAMBER_RADIUS } from './chamber';
import { mulberry32, randomBetween } from './random';

/**
 * A lava lamp in the object cell.
 *
 * Not glass in a liquid — liquid instead of glass. What is in the cell is a
 * second fluid that will not mix with the first: blobs of it climb, flatten
 * against the top, cool, sink, gather at the bottom and go round again, running
 * into each other on the way and coming apart when they get too big. Every one
 * of those is in here, and none of it is a picture of a blob — the shapes are
 * whatever the arithmetic gives.
 *
 * Two things do the work.
 *
 * **The heat cycle**, which is what a lava lamp actually is. A blob near the
 * bottom warms, and warm means lighter than what it is floating in, so it
 * rises; near the top it cools and turns heavy again and comes back down. That
 * one loop is the whole motion, and it is why the cell never settles: the
 * bottom is always making new risers.
 *
 * **Metaballs**, which is what makes it read as liquid rather than as a bag of
 * circles. Each blob lays down a soft field around itself, the fields add up,
 * and the surface is drawn where the total crosses {@link SURFACE}. Two blobs
 * approaching therefore *reach* for each other and pinch into one shape before
 * their circles ever touch, and one coming apart necks in the middle first.
 * That is the shape a real one makes, and it is the sum rather than the parts
 * that makes it.
 *
 * Coordinates are in cell units, centred on the chamber, and gravity arrives in
 * the cell's own frame — so turning the tube sweeps the whole circulation round
 * with it and the blobs set off in a new direction.
 */
export interface Blob {
  /** Where it is, in cell units. */
  x: number;
  y: number;
  /** How fast, in cell units per second. */
  vx: number;
  vy: number;
  /**
   * How far its field reaches, in cell units.
   *
   * Not the size it looks: the surface is drawn where the fields sum to
   * {@link SURFACE}, which for a blob on its own is a little over half of this.
   */
  reach: number;
  /** How warm it is: 0 cold and sinking, 1 warm and climbing. */
  heat: number;
  /**
   * What colour it is, as red, green and blue.
   *
   * Carried rather than looked up, because two blobs that run together make one
   * blob of the mixture — a real lamp with two colours of wax in it ends up
   * with the blend, and watching that happen is half of what there is to watch.
   */
  colour: [number, number, number];
}

export interface Lava {
  blobs: Blob[];
  /** What the blobs are cut from, so a split keeps its parent's colour. */
  readonly seed: number;
}

/**
 * Cells across the chamber the surface is worked out on.
 *
 * The field is smooth, so this is not resolving detail — it is deciding how
 * accurately the *edge* lands, because the surface is a contour through it and
 * a coarse grid puts that contour a cell's width out. A hundred and twenty
 * eight is enough that a blob's rim is straight where it should be straight at
 * the sizes a phone shows it at.
 */
export const GRID = 128;

/**
 * Where the surface is, as a sum of the blobs' fields.
 *
 * A blob's own field peaks at 1 in its middle, so on its own it comes out
 * {@link SEEN} of its reach across. Where two overlap the sum crosses this well
 * outside either of them, which is the pinch.
 */
const SURFACE = 0.5;

/**
 * How much of the cell the blobs cover between them.
 *
 * Measured as if each were alone, which is why it is lower than it sounds: the
 * fields *add*, so a cell of blobs at arm's length already crosses the surface
 * in the gaps between them and covers far more than the sum of their own areas.
 * Half was tried on the isolated arithmetic and filled the entire cell with one
 * shape.
 */
const COVER = 0.22;

/**
 * How wide a blob looks against how far its field reaches.
 *
 * A blob on its own is drawn where its own field crosses {@link SURFACE}, and
 * `(1 - d²/r²)² = 0.5` puts that at 0.54 of its reach. Everything about how big
 * a blob *looks* has to go through this — leave it out of the sizing and the
 * cell comes out a third full of dots when it was asked for half full of lava,
 * which is exactly what happened the first time.
 */
const SEEN = 0.54;

/**
 * Blobs at nothing and at everything.
 *
 * Few, because lava is *blobs*: a couple of dozen of anything reads as a
 * scatter of dots however it is drawn, and what makes this substance itself is
 * two or three big ones climbing past each other and merging.
 */
const FEWEST = 2;
const MOST = 10;

/** Downward acceleration, matched to the chamber's own. */
const GRAVITY = 6;

/** How hard the heat cycle drives, as a share of gravity. */
const BUOYANCY = 0.55;

/** How fast a blob takes the temperature of the end of the cell it is at. */
const EXCHANGE = 0.22;

/** Speed lost per second, before the fluid is thickened. */
const DRAG = 2.6;

/** How much thicker the far end of the Thickness slider is. */
const THICKEST = 4;

/** Nearer than this share of their reaches, two blobs are one blob. */
const MERGE = 0.55;

/** Past this much of the cell across, a blob comes apart. */
const SPLIT = 0.42;

/** How hard two blobs that are merely touching hold each other off. */
const JOSTLE = 2.2;

/**
 * What the wax is coloured with.
 *
 * A real lamp holds one colour. This one holds a few, because two of them
 * running together make one of the mixture and watching that happen is half of
 * what there is to watch.
 *
 * All four are warm, and that is the whole of why they are these four. Blobs
 * merge, merging averages, and averaging colours from opposite sides of the
 * wheel gives mud — a first go at this had rose, amber, violet and teal in it,
 * and a minute later the cell was uniformly the colour of a puddle. Neighbours
 * on the wheel average to neighbours on the wheel, so every mixture these can
 * make is another warm one.
 */
const TINTS: readonly [number, number, number][] = [
  [244, 63, 94],
  [251, 113, 43],
  [250, 176, 46],
  [219, 39, 119],
];

/** Builds a cell of lava, deterministically. */
export function createLava(seed: number, amount: number, scale = 1): Lava {
  const rng = mulberry32(seed);
  const count = Math.max(1, Math.round(FEWEST + (MOST - FEWEST) * clamp(amount)));
  // Shared out so the blobs cover the same share of the cell however many there
  // are: more of them is a busier cell, not a fuller one.
  const reach = CHAMBER_RADIUS * Math.sqrt(COVER / (SEEN * SEEN * count)) * Math.max(0.2, scale);
  const blobs: Blob[] = [];

  for (let i = 0; i < count; i += 1) {
    const angle = rng() * Math.PI * 2;
    const distance = Math.sqrt(rng()) * CHAMBER_RADIUS * 0.75;

    blobs.push({
      x: Math.cos(angle) * distance,
      y: Math.sin(angle) * distance,
      vx: 0,
      vy: 0,
      reach: reach * randomBetween(rng, 0.75, 1.3),
      // Spread across the cycle, so the cell opens mid-circulation rather than
      // with everything at the bottom waiting to be warmed.
      heat: rng(),
      colour: [...TINTS[Math.min(TINTS.length - 1, Math.floor(rng() * TINTS.length))]!],
    });
  }

  return { blobs, seed };
}

export interface LavaUpdate {
  /** Seconds to advance. */
  dt: number;
  /** How thick the fluid is, 0 thin to 1 gel. */
  thickness: number;
  /** How fast the fluid is turning within the cell, radians per second. */
  swirl: number;
  /** Which way is down in the cell's own frame, radians. */
  angle: number;
}

/** Advances the lava in place: the cycle, then the contacts, then the wall. */
export function updateLava(lava: Lava, { dt, thickness, swirl, angle }: LavaUpdate): void {
  if (dt <= 0 || lava.blobs.length === 0) {
    return;
  }

  const step = Math.min(dt, 1 / 20);
  const downX = Math.sin(angle);
  const downY = Math.cos(angle);
  const damping = Math.max(0, 1 - DRAG * (1 + THICKEST * clamp(thickness)) * step);

  for (const blob of lava.blobs) {
    // How far down the cell it is, from -1 at the top to 1 at the bottom, in
    // whichever direction down currently happens to be.
    const along = (blob.x * downX + blob.y * downY) / CHAMBER_RADIUS;
    // The bottom warms it and the top cools it. Everything else follows.
    const wanted = clamp(0.5 + along * 0.75);

    blob.heat += (wanted - blob.heat) * Math.min(1, EXCHANGE * step * 3);

    // Warm is lighter than what it floats in and climbs; cold is heavier and
    // sinks. Nothing else lifts a blob, which is why the cell circulates
    // instead of settling.
    const lift = (0.5 - blob.heat) * 2 * BUOYANCY;
    const flowX = -swirl * blob.y;
    const flowY = swirl * blob.x;

    blob.vx = flowX + (blob.vx + downX * GRAVITY * lift * step - flowX) * damping;
    blob.vy = flowY + (blob.vy + downY * GRAVITY * lift * step - flowY) * damping;
    blob.x += blob.vx * step;
    blob.y += blob.vy * step;
  }

  jostle(lava, step);
  coalesce(lava);
  divide(lava);

  for (const blob of lava.blobs) {
    confine(blob);
  }
}

/**
 * Holds blobs that are merely touching apart from each other.
 *
 * Without it every pair that met would sink into one another and the cell would
 * be a single lump inside a minute. What a second fluid actually does is hold
 * its own surface: two blobs press together, flatten where they touch, and only
 * give way and join when they are pushed properly into each other — which is
 * what {@link coalesce} then does.
 */
function jostle(lava: Lava, step: number): void {
  const { blobs } = lava;

  for (let i = 0; i < blobs.length; i += 1) {
    const a = blobs[i]!;

    for (let j = i + 1; j < blobs.length; j += 1) {
      const b = blobs[j]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const apart = Math.hypot(dx, dy);
      const touching = (a.reach + b.reach) * 0.75;

      if (apart >= touching || apart === 0) {
        continue;
      }

      // Shared out by size: a small blob bounces off a big one rather than
      // shoving it aside.
      const push = ((touching - apart) / touching) * JOSTLE * step;
      const mass = a.reach * a.reach + b.reach * b.reach;
      const share = mass > 0 ? (b.reach * b.reach) / mass : 0.5;

      a.vx -= (dx / apart) * push * share;
      a.vy -= (dy / apart) * push * share;
      b.vx += (dx / apart) * push * (1 - share);
      b.vy += (dy / apart) * push * (1 - share);
    }
  }
}

/**
 * Runs two blobs together into one.
 *
 * Area adds rather than radius, so a merge conserves how much wax there is —
 * two of a size make one about 1.4 across, not 2. Everything else is carried
 * over in proportion: where the pair was, how fast it was going, how warm, and
 * the colour of whichever of them was bigger.
 */
function coalesce(lava: Lava): void {
  const { blobs } = lava;

  for (let i = 0; i < blobs.length; i += 1) {
    const a = blobs[i]!;

    for (let j = i + 1; j < blobs.length; j += 1) {
      const b = blobs[j]!;

      if (Math.hypot(b.x - a.x, b.y - a.y) > (a.reach + b.reach) * MERGE) {
        continue;
      }

      const areaA = a.reach * a.reach;
      const areaB = b.reach * b.reach;
      const total = areaA + areaB;

      a.x = (a.x * areaA + b.x * areaB) / total;
      a.y = (a.y * areaA + b.y * areaB) / total;
      a.vx = (a.vx * areaA + b.vx * areaB) / total;
      a.vy = (a.vy * areaA + b.vy * areaB) / total;
      a.heat = (a.heat * areaA + b.heat * areaB) / total;
      a.colour = [
        (a.colour[0] * areaA + b.colour[0] * areaB) / total,
        (a.colour[1] * areaA + b.colour[1] * areaB) / total,
        (a.colour[2] * areaA + b.colour[2] * areaB) / total,
      ];
      a.reach = Math.sqrt(total);
      blobs.splice(j, 1);
      j -= 1;
    }
  }
}

/**
 * Pulls a blob that has grown too big into two.
 *
 * Something has to, or every cell ends as one lump: merging only ever runs one
 * way. A real lamp does this by stretching — a climbing blob leaves a tail
 * behind and the tail necks off — so the two halves are set going along the way
 * it was already travelling, and the metaballs draw the neck between them for
 * as long as they are close.
 */
function divide(lava: Lava): void {
  const { blobs } = lava;
  const largest = CHAMBER_RADIUS * SPLIT;
  // Gathered and added afterwards rather than as they are made: a half is
  // already half the size, so it cannot split again this pass, and there is no
  // reason to walk over the ones just born.
  const halves: Blob[] = [];

  for (const blob of blobs) {
    if (blob.reach <= largest) {
      continue;
    }

    const speed = Math.hypot(blob.vx, blob.vy);
    const alongX = speed > 0 ? blob.vx / speed : 1;
    const alongY = speed > 0 ? blob.vy / speed : 0;
    const half = blob.reach / Math.SQRT2;
    const gap = half * 0.7;

    blob.reach = half;
    blob.x -= alongX * gap;
    blob.y -= alongY * gap;

    halves.push({
      x: blob.x + alongX * gap * 2,
      y: blob.y + alongY * gap * 2,
      // The leading half keeps the momentum; the trailing half is what is left.
      vx: blob.vx * 1.15,
      vy: blob.vy * 1.15,
      reach: half,
      heat: blob.heat,
      colour: [...blob.colour],
    });
  }

  blobs.push(...halves);
}

/** Keeps a blob inside the wall, and takes the speed that carried it there. */
function confine(blob: Blob): void {
  const distance = Math.hypot(blob.x, blob.y);
  // Its own surface, not its reach: a blob rests against the wall where it
  // looks like it does.
  const limit = Math.max(0, CHAMBER_RADIUS - blob.reach * SEEN);

  if (distance <= limit || distance === 0) {
    return;
  }

  const outX = blob.x / distance;
  const outY = blob.y / distance;

  blob.x = outX * limit;
  blob.y = outY * limit;

  const into = blob.vx * outX + blob.vy * outY;

  if (into > 0) {
    blob.vx -= into * outX;
    blob.vy -= into * outY;
  }
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Paints the lava onto a small canvas, one pixel per grid cell.
 *
 * The fields are summed per cell and the colour with them, so where two blobs
 * overlap the colour is the mixture in proportion — which is what stops a merge
 * looking like one shape sliding over another. Drawn scaled up with smoothing,
 * which is a bilinear filter over a field that is smooth to begin with.
 *
 * @returns The canvas, or null where there is no canvas to be had.
 */
export function paintLava(lava: Lava): HTMLCanvasElement | null {
  const surface = lavaSurface();

  if (!surface) {
    return null;
  }

  const { canvas, ctx, image } = surface;
  const pixels = image.data;
  const width = (2 * CHAMBER_RADIUS) / GRID;

  // Summed in floats and not in the picture's own bytes. The whole of the
  // metaball trick is that the fields *add* past the surface — two blobs
  // overlapping reach two and more — and a canvas's bytes stop at one, which
  // would flatten every overlap to the same value and take the pinch with it.
  field.fill(0);

  for (const blob of lava.blobs) {
    const [red, green, blue] = blob.colour;
    // Only the square the blob's field actually reaches into. The cell is
    // mostly empty of any one blob, and the whole cost of this is here.
    const from = Math.max(0, Math.floor((blob.x - blob.reach + CHAMBER_RADIUS) / width));
    const to = Math.min(GRID - 1, Math.ceil((blob.x + blob.reach + CHAMBER_RADIUS) / width));
    const start = Math.max(0, Math.floor((blob.y - blob.reach + CHAMBER_RADIUS) / width));
    const end = Math.min(GRID - 1, Math.ceil((blob.y + blob.reach + CHAMBER_RADIUS) / width));
    const span = blob.reach * blob.reach;

    for (let j = start; j <= end; j += 1) {
      const y = -CHAMBER_RADIUS + (j + 0.5) * width - blob.y;

      for (let i = from; i <= to; i += 1) {
        const x = -CHAMBER_RADIUS + (i + 0.5) * width - blob.x;
        const away = (x * x + y * y) / span;

        if (away >= 1) {
          continue;
        }

        const much = (1 - away) * (1 - away);
        const at = (i + j * GRID) * 4;

        field[at] = field[at]! + much * red;
        field[at + 1] = field[at + 1]! + much * green;
        field[at + 2] = field[at + 2]! + much * blue;
        field[at + 3] = field[at + 3]! + much;
      }
    }
  }

  // The surface: where the sum crosses SURFACE, softened over a little either
  // side so the edge is a liquid's and not a cut-out's.
  // Narrow. The field is smooth and the grid is read bilinearly, so a tight
  // band still comes out as a clean curve — and a wide one is what made the
  // first attempt look like out-of-focus dots rather than a liquid with a
  // surface.
  const edge = 0.07;
  const low = SURFACE - edge;
  const high = SURFACE + edge;

  for (let k = 0; k < GRID * GRID; k += 1) {
    const at = k * 4;
    const much = field[at + 3]!;

    if (much <= low) {
      pixels.fill(0, at, at + 4);
      continue;
    }

    // The colour is the average of what is here rather than the sum, or a deep
    // overlap would come out white — and the average is what makes two colours
    // running together mix along the seam between them.
    pixels[at] = Math.min(255, field[at]! / much);
    pixels[at + 1] = Math.min(255, field[at + 1]! / much);
    pixels[at + 2] = Math.min(255, field[at + 2]! / much);
    pixels[at + 3] = much >= high ? 255 : Math.round(smooth((much - low) / (high - low)) * 255);
  }

  ctx.putImageData(image, 0, 0);

  return canvas;
}

/** Where the fields are summed, before any of it is a colour. */
const field = new Float32Array(GRID * GRID * 4);

/** Smoothstep, for an edge that eases in and out rather than ramping. */
function smooth(at: number): number {
  return at * at * (3 - 2 * at);
}

/** The one surface the lava is drawn on, built once. */
let surface: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; image: ImageData } | null =
  null;
let surfaceTried = false;

function lavaSurface() {
  if (surfaceTried) {
    return surface;
  }

  surfaceTried = true;

  if (typeof document === 'undefined') {
    return null;
  }

  const canvas = document.createElement('canvas');
  canvas.width = GRID;
  canvas.height = GRID;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  if (!ctx) {
    return null;
  }

  const image = ctx.createImageData(GRID, GRID);

  if (!image.data.length) {
    return null;
  }

  surface = { canvas, ctx, image };

  return surface;
}
