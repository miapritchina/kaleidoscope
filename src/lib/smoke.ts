import { CHAMBER_RADIUS } from './chamber';
import {
  advectField,
  carryFlow,
  confineFlow,
  createFlow,
  driveFlow,
  neighbour,
  positionOf as flowPositionOf,
  projectFlow,
  type Flow,
} from './flow';
import { mulberry32 } from './random';

/**
 * A cell of smoke.
 *
 * The whole content, not a tint over something else: what is in the chamber is
 * moving fluid and the colour carried in it, and the mirrors repeat that. One
 * of the substances this instrument's object cell can hold instead of loose
 * pieces — see `lib/lava.ts`, `lib/glitter.ts` and `lib/film.ts` for the
 * others.
 *
 * The fluid itself — velocity, the wall's drag, viscosity, projection,
 * stirring — lives in `lib/flow.ts` now, extracted from here because every
 * substance rides the same fluid. What stays in this module is what makes the
 * fluid *smoke*: the dye carried on it, the dye's weight (the one force that
 * keeps an unattended cell alive), the vorticity confinement pointed at
 * smoke's scales, and the MacCormack correction that keeps ribbons from
 * blurring into fog. The history of what was tried here and failed — the
 * comb-teeth, the unsharp-mask checkerboard, the wall-cell fast path that
 * measured slower — is in the comments below and in ROADMAP.md, and it all
 * still applies to the extracted code.
 *
 * Three dyes rather than one, and subtractive: each takes its own primary out
 * of the light, the way real dye in a lit cell does, so where two of them fold
 * together the colour is the mixture and not the brighter of the pair.
 */

/**
 * Cells across the chamber.
 *
 * Smoke is all structure — the whole of what it looks like is ribbons folding
 * into finer ribbons — so unlike a dye tinting something else it does want the
 * resolution. Sixty-four was tried while this was a tint over glass and reads
 * as blur when it is the only thing on screen. The grid is drawn scaled up with
 * smoothing, which is a bilinear filter over the same field the solver samples
 * bilinearly, so the seam between what is simulated and what is shown never
 * shows.
 */
export const GRID = 96;

/** How many dyes there are. One per primary the light can lose. */
export const DYES = 3;

/**
 * Steps of the fluid per second.
 *
 * Half the frame rate on a phone, and it costs nothing to look at: ink has no
 * fast motion in it. The ribbons move at the speed of the fluid carrying them,
 * which is a fraction of a cell width a second, so the field is the same
 * picture whether it is stepped sixty times a second or thirty — and stepping
 * it thirty halves the most expensive thing the chamber does. Time is banked
 * rather than dropped, so the ink drifts at the same rate however fast the
 * frames arrive.
 */
const RATE = 30;

/**
 * How hard the small swirls are pushed back in, per second.
 *
 * Vorticity confinement, after Fedkiw, Stam and Jensen (SIGGRAPH 2001), and it
 * is the difference between smoke and fog. Tracing backwards and sampling
 * bilinearly is stable precisely because it *averages*, and what an average
 * takes out first is the smallest swirls — which are the ones the eye reads as
 * smoke. So the curl is measured, the direction that would sharpen each swirl
 * is worked out from where the curl is strongest, and a little push is added
 * back along it. It puts back energy the method should not have lost rather
 * than inventing any: without it a cell of smoke is a cell of coloured blur,
 * which is exactly what a first go at this looked like.
 *
 * It has to be pointed at something smooth, though — see `confineFlow` in
 * `lib/flow.ts`, which blurs the curl's size first so the push follows the
 * swirl rather than the grid. Taken straight it drew a row of grid-aligned
 * comb teeth along the edge of every ribbon, plainly enough to see in a
 * screenshot.
 */
const CONFINE = 6;

/**
 * How much heavier the dye is than what it hangs in.
 *
 * This is the whole of what keeps the cell alive. Nothing else pushes on the
 * fluid unless the tube is turned, and a fluid with nothing pushing on it stops
 * — so the dye falls through itself, the fluid it displaces comes up around it,
 * and the folding never quite settles.
 */
const INK_WEIGHT = 1.2;

/** Downward acceleration, matched to the chamber's own. */
const GRAVITY = 6;

/** How much thicker fluid holds the falling dye up, on top of the flow's own drag. */
const THICKEST = 6;

/**
 * How strongly the dye takes its colour out of the light.
 *
 * Above one, and deliberately. Advection conserves the dye but spreads it, so
 * the concentration anywhere falls as the ribbons draw out — and a cell that
 * started saturated is a pale wash a minute later even though every drop of it
 * is still in there. A strong dye is the honest fix: real ink is strong enough
 * that a tenth of a cell's worth still colours what is behind it.
 */
const STRENGTH = 1.9;

/**
 * How much of the trace's own error is corrected, 0 to 1.
 *
 * MacCormack, and it is the second half of getting smoke rather than fog.
 * Tracing backwards and sampling bilinearly blurs the field a little every
 * step, and over a minute that turns ribbons into a flat wash. The trick is to
 * measure the blur rather than guess at it: carry the field forwards again from
 * where it landed, and wherever that does not arrive back at what was there to
 * begin with is the error the trace introduced. Half of it is then taken off.
 *
 * An unsharp mask was tried first — take a little of the local average back out
 * of every cell — and it is a trap. Sharpening by amplifying the difference
 * from the neighbours amplifies the *shortest* wavelength hardest, and the
 * shortest wavelength a grid has is a checkerboard, so after a minute every
 * ribbon had a row of grid-aligned comb teeth along its edge. This does not:
 * the correction is clamped to the range the plain trace already found, so it
 * can sharpen what is there and cannot invent anything that was not.
 */
const CORRECT = 0.9;

export interface Smoke extends Flow {
  /** How much of each dye is in each cell, 0 to 1. */
  dye: Float32Array[];
  dye0: Float32Array[];
}

/** Where a cell's middle is, in cell units. */
function positionOf(index: number): number {
  return flowPositionOf(GRID, index);
}

/** Builds a cell of smoke, deterministically, in a few clouds of each dye. */
export function createSmoke(seed: number, amount = 1): Smoke {
  const rng = mulberry32(seed);
  const smoke: Smoke = {
    ...createFlow(GRID),
    dye: Array.from({ length: DYES }, () => new Float32Array(GRID * GRID)),
    dye0: Array.from({ length: DYES }, () => new Float32Array(GRID * GRID)),
  };

  // Two clouds of each dye, placed anywhere in the cell. Round and soft, so
  // the first stir draws them out into ribbons rather than tearing an edge.
  for (let d = 0; d < DYES; d += 1) {
    const field = smoke.dye[d]!;

    // More of it is more clouds and bigger ones: a cell can hold a wisp or be
    // full of the stuff.
    const clouds = Math.max(1, Math.round(1 + 2 * Math.min(1, Math.max(0, amount))));

    for (let blob = 0; blob < clouds; blob += 1) {
      const angle = rng() * Math.PI * 2;
      const distance = Math.sqrt(rng()) * CHAMBER_RADIUS * 0.8;
      const atX = Math.cos(angle) * distance;
      const atY = Math.sin(angle) * distance;
      const reach =
        CHAMBER_RADIUS * (0.16 + 0.16 * Math.min(1, Math.max(0, amount)) + rng() * 0.16);

      for (let j = 0; j < GRID; j += 1) {
        for (let i = 0; i < GRID; i += 1) {
          const k = i + j * GRID;

          if (!smoke.inside[k]) {
            continue;
          }

          const away = Math.hypot(positionOf(i) - atX, positionOf(j) - atY) / reach;

          if (away < 1) {
            field[k] = Math.min(1, field[k]! + (1 - away * away) ** 2);
          }
        }
      }
    }
  }

  // And a few swirls to start it off. Left perfectly still, the only thing
  // pushing on the fluid is the dye's own weight straight down, and round
  // clouds falling straight down stay round for a long time — the cell needs a
  // reason to be asymmetric before it can fold over on itself.
  for (let swirl = 0; swirl < 5; swirl += 1) {
    const angle = rng() * Math.PI * 2;
    const distance = Math.sqrt(rng()) * CHAMBER_RADIUS * 0.7;
    const atX = Math.cos(angle) * distance;
    const atY = Math.sin(angle) * distance;
    const reach = CHAMBER_RADIUS * (0.25 + rng() * 0.3);
    const spin = (rng() * 2 - 1) * 1.6;

    for (let j = 0; j < GRID; j += 1) {
      for (let i = 0; i < GRID; i += 1) {
        const k = i + j * GRID;

        if (!smoke.inside[k]) {
          continue;
        }

        const x = positionOf(i) - atX;
        const y = positionOf(j) - atY;
        const much = Math.exp((-(x * x + y * y) / (reach * reach)) * 2);

        smoke.u[k] = smoke.u[k]! - y * spin * much;
        smoke.v[k] = smoke.v[k]! + x * spin * much;
      }
    }
  }

  return smoke;
}

export interface SmokeUpdate {
  /** Seconds to advance. */
  dt: number;
  /** How thick the fluid is, 0 thin to 1 gel. */
  thickness: number;
  /** How fast the fluid is turning within the cell, radians per second. */
  swirl: number;
  /** Which way is down in the cell's own frame, radians. */
  angle: number;
}

/**
 * Advances the ink in place.
 *
 * The order is Stam's: put the forces in, make the field divergence-free,
 * carry the field along itself, make it divergence-free again, and only then
 * carry the dye. Projecting after the advection as well as before is what
 * keeps a swirl from slowly collapsing into its own middle.
 */
export function updateSmoke(smoke: Smoke, { dt, thickness, swirl, angle }: SmokeUpdate): void {
  if (dt <= 0) {
    return;
  }

  smoke.due += dt;

  if (smoke.due < 1 / RATE) {
    return;
  }

  const step = Math.min(smoke.due, 1 / 20);

  smoke.due = 0;

  // The dye's own weight, which is the only thing keeping the cell alive when
  // nobody is turning it. Thicker fluid holds it up more. Applied before the
  // shared drive, so the wall's grip and the viscosity act on the pushed
  // field the way they always did.
  fall(smoke, step, thickness, angle);
  driveFlow(smoke, { step, thickness, swirl });
  confineFlow(smoke, step, CONFINE);
  projectFlow(smoke);
  carryFlow(smoke, step);
  projectFlow(smoke);

  for (let d = 0; d < DYES; d += 1) {
    const from = smoke.dye[d]!;
    const into = smoke.dye0[d]!;

    carryDye(smoke, from, into, step);
    smoke.dye[d] = into;
    smoke.dye0[d] = from;
  }
}

/** The dye falling through the fluid that carries it. See {@link INK_WEIGHT}. */
function fall(smoke: Smoke, step: number, thickness: number, angle: number): void {
  const { u, v, inside } = smoke;
  const thick = 1 + THICKEST * Math.min(1, Math.max(0, thickness));
  const drop = (GRAVITY * INK_WEIGHT * step) / thick;
  const downX = Math.sin(angle) * drop;
  const downY = Math.cos(angle) * drop;

  for (let j = 0; j < GRID; j += 1) {
    for (let i = 0; i < GRID; i += 1) {
      const k = i + j * GRID;

      if (!inside[k]) {
        continue;
      }

      let dyed = 0;

      for (let d = 0; d < DYES; d += 1) {
        dyed += smoke.dye[d]![k]!;
      }

      u[k] = u[k]! + downX * dyed;
      v[k] = v[k]! + downY * dyed;
    }
  }
}

/**
 * Carries the dye along the fluid, and takes the trace's own blurring back off.
 *
 * Three passes. Back down the flow, which is the plain trace and is where the
 * blur comes from; forward again from there, which lands somewhere near where
 * the dye started and misses by however much the first pass smeared; and then
 * the first result with half that miss corrected out of it.
 *
 * The clamp at the end is what makes it safe. A correction can overshoot, and
 * an overshoot in a dye field is a value that was never in it — which is a new
 * extreme, and new extremes on a grid are what turn into grid-shaped noise. So
 * the corrected value is held inside the range the plain trace already found
 * nearby: it may sharpen what is there, and it may not invent.
 */
function carryDye(smoke: Smoke, from: Float32Array, into: Float32Array, step: number): void {
  const { inside } = smoke;

  advectField(smoke, from, back, step);
  advectField(smoke, back, forward, -step);

  for (let j = 0; j < GRID; j += 1) {
    for (let i = 0; i < GRID; i += 1) {
      const k = i + j * GRID;

      if (!inside[k]) {
        into[k] = 0;
        continue;
      }

      const traced = back[k]!;
      const corrected = traced + ((from[k]! - forward[k]!) * CORRECT) / 2;
      let least = traced;
      let most = traced;

      for (const near of [
        neighbour(back, inside, GRID, traced, i + 1, j),
        neighbour(back, inside, GRID, traced, i - 1, j),
        neighbour(back, inside, GRID, traced, i, j + 1),
        neighbour(back, inside, GRID, traced, i, j - 1),
      ]) {
        least = Math.min(least, near);
        most = Math.max(most, near);
      }

      into[k] = Math.min(1, Math.max(0, Math.min(most, Math.max(least, corrected))));
    }
  }
}

/** Where the two halves of the correction are worked out. */
const back = new Float32Array(GRID * GRID);
const forward = new Float32Array(GRID * GRID);

/**
 * Paints the ink onto a small canvas, one pixel per cell.
 *
 * Subtractive: each dye takes its own primary out of the light, so the canvas
 * is white where the cell is clear and the drawing is composited with
 * `multiply`. That is what a dye does — it does not add colour to a lit cell,
 * it takes colour out of what is coming through — and it is why two dyes
 * folded together read as the mixture rather than as a highlight.
 *
 * @param strength How strong the ink is. See {@link STRENGTH}.
 * @returns The canvas, or null where there is no canvas to be had.
 */
export function paintSmoke(smoke: Smoke, strength = STRENGTH): HTMLCanvasElement | null {
  const surface = inkSurface();

  if (!surface || strength <= 0) {
    return null;
  }

  const { canvas, ctx, image } = surface;
  const pixels = image.data;

  for (let k = 0; k < GRID * GRID; k += 1) {
    const at = k * 4;

    for (let d = 0; d < DYES; d += 1) {
      const taken = Math.min(1, Math.max(0, smoke.dye[d]![k]! * strength));

      pixels[at + d] = Math.round(255 * (1 - taken));
    }

    pixels[at + 3] = 255;
  }

  ctx.putImageData(image, 0, 0);

  return canvas;
}

/** The one surface the ink is drawn on, built once. */
let surface: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; image: ImageData } | null =
  null;
let surfaceTried = false;

function inkSurface() {
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
