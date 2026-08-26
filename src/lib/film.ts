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
  RATE,
  type Flow,
} from './flow';
import { mulberry32 } from './random';

/**
 * A film of oil in the cell.
 *
 * The one substance whose colour is not a colour. Oil on water is a few
 * hundred nanometres thick, and light reflecting off the film's top surface
 * meets light reflecting off its bottom surface after a delay set by the
 * thickness — where the two arrive in phase a wavelength is brightened, and
 * where they arrive opposed it is cancelled. Which wavelengths survive is
 * purely a function of how thick the film is *right there*, so the colour
 * bands you see on a puddle are contour lines of thickness, and they slide as
 * the film flows. That is the whole of what this module simulates: a
 * thickness field riding the shared fluid, coloured by the interference
 * arithmetic and nothing else.
 *
 * The reflected share of each wavelength goes as `cos²(2πnd/λ + φ)` for film
 * thickness `d` and refractive index `n` — two-beam interference, with the
 * half-turn phase flip at the top surface folded into `φ`. It is evaluated
 * once per representable thickness into a small table ({@link filmColour}),
 * because the shape never changes and the painting is per cell per frame.
 *
 * What keeps it moving is the film's own weight. A real slick is heavier than
 * nothing: thick regions sag through the fluid the way the smoke's dye does,
 * the fluid they displace comes up around them, and the bands never quite
 * stop sliding. It is the same one-force trick that keeps the smoke cell
 * alive, at a fraction of the strength — a film is nanometres, not a cloud.
 */

/**
 * Cells across the chamber. The smoke's own resolution, for the same reason:
 * the colour bands are contour lines, and a contour line is all edge.
 */
export const GRID = 96;

/** Refractive index of a light oil. */
const OIL = 1.33;

/**
 * The thickness a full cell of the field maps to, in nanometres.
 *
 * Zero to about a micron sweeps the interference through several full orders
 * — the classic slick sequence of gold, magenta, blue, green and round again
 * — which is what makes the bands read as an oil film rather than as a
 * gradient that happens to be colourful. The sweep starts at a true zero, so
 * the edge of a slick wears the *black film* a soap bubble shows just before
 * it pops: at nothing the top surface's phase flip cancels every wavelength.
 */
const THICKEST_NM = 950;
const THINNEST_NM = 0;

/** How much heavier the film is than what it floats in. See the module note. */
const FILM_WEIGHT = 0.45;

/** Downward acceleration, matched to the chamber's own. */
const GRAVITY = 6;

/** How much thicker fluid holds the sagging film up. */
const THICKEST = 6;

/**
 * How hard the small swirls are pushed back in, per second.
 *
 * Lower than the smoke's: the bands are broad contour lines, not fine
 * ribbons, and over-confined they crinkle.
 */
const CONFINE = 3;

/** How much of the trace's error MacCormack takes back off. See `lib/smoke.ts`. */
const CORRECT = 0.9;

export interface Film extends Flow {
  /** How much oil is over each cell, 0 to 1 of {@link THICKEST_NM}. */
  film: Float32Array;
  film0: Float32Array;
}

/** Where a cell's middle is, in cell units. */
function positionOf(index: number): number {
  return flowPositionOf(GRID, index);
}

/** Builds a cell of oil film, deterministically, in a few pooled patches. */
export function createFilm(seed: number, amount = 1): Film {
  const rng = mulberry32(seed);
  const film: Film = {
    ...createFlow(GRID),
    film: new Float32Array(GRID * GRID),
    film0: new Float32Array(GRID * GRID),
  };
  const much = Math.min(1, Math.max(0, amount));

  // Pools of oil, soft-edged, so the first flow draws them into bands rather
  // than tearing a cliff. More of it is more pools and deeper ones.
  const pools = Math.max(2, Math.round(2 + 3 * much));

  for (let pool = 0; pool < pools; pool += 1) {
    const angle = rng() * Math.PI * 2;
    const distance = Math.sqrt(rng()) * CHAMBER_RADIUS * 0.8;
    const atX = Math.cos(angle) * distance;
    const atY = Math.sin(angle) * distance;
    const reach = CHAMBER_RADIUS * (0.25 + 0.25 * much + rng() * 0.2);
    const depth = 0.35 + 0.55 * much * rng();

    for (let j = 0; j < GRID; j += 1) {
      for (let i = 0; i < GRID; i += 1) {
        const k = i + j * GRID;

        if (!film.inside[k]) {
          continue;
        }

        const away = Math.hypot(positionOf(i) - atX, positionOf(j) - atY) / reach;

        if (away < 1) {
          film.film[k] = Math.min(1, film.film[k]! + depth * (1 - away * away) ** 2);
        }
      }
    }
  }

  // And a few swirls to open mid-motion, exactly as the smoke does: pools
  // sagging straight down stay round for a long time, and the bands only
  // appear once the film has been sheared.
  for (let swirl = 0; swirl < 4; swirl += 1) {
    const angle = rng() * Math.PI * 2;
    const distance = Math.sqrt(rng()) * CHAMBER_RADIUS * 0.7;
    const atX = Math.cos(angle) * distance;
    const atY = Math.sin(angle) * distance;
    const reach = CHAMBER_RADIUS * (0.25 + rng() * 0.3);
    const spin = (rng() * 2 - 1) * 1.4;

    for (let j = 0; j < GRID; j += 1) {
      for (let i = 0; i < GRID; i += 1) {
        const k = i + j * GRID;

        if (!film.inside[k]) {
          continue;
        }

        const x = positionOf(i) - atX;
        const y = positionOf(j) - atY;
        const strength = Math.exp((-(x * x + y * y) / (reach * reach)) * 2);

        film.u[k] = film.u[k]! - y * spin * strength;
        film.v[k] = film.v[k]! + x * spin * strength;
      }
    }
  }

  return film;
}

export interface FilmUpdate {
  /** Seconds to advance. */
  dt: number;
  /** How thick the carrier fluid is, 0 thin to 1 gel. */
  thickness: number;
  /** How fast the fluid is turning within the cell, radians per second. */
  swirl: number;
  /** Which way is down in the cell's own frame, radians. */
  angle: number;
}

/** Advances the film in place: the smoke's order, with the film for a dye. */
export function updateFilm(film: Film, { dt, thickness, swirl, angle }: FilmUpdate): void {
  if (dt <= 0) {
    return;
  }

  film.due += dt;

  if (film.due < 1 / RATE) {
    return;
  }

  const step = Math.min(film.due, 1 / 20);

  film.due = 0;

  sag(film, step, thickness, angle);
  driveFlow(film, { step, thickness, swirl });
  confineFlow(film, step, CONFINE);
  projectFlow(film);
  carryFlow(film, step);
  projectFlow(film);
  carryFilm(film, step);
}

/** The film's own weight: thick oil sags, and the sagging keeps the bands alive. */
function sag(film: Film, step: number, thickness: number, angle: number): void {
  const { u, v, inside } = film;
  const thick = 1 + THICKEST * Math.min(1, Math.max(0, thickness));
  const drop = (GRAVITY * FILM_WEIGHT * step) / thick;
  const downX = Math.sin(angle) * drop;
  const downY = Math.cos(angle) * drop;

  for (let j = 0; j < GRID; j += 1) {
    for (let i = 0; i < GRID; i += 1) {
      const k = i + j * GRID;

      if (!inside[k]) {
        continue;
      }

      u[k] = u[k]! + downX * film.film[k]!;
      v[k] = v[k]! + downY * film.film[k]!;
    }
  }
}

/**
 * Carries the film along the fluid, MacCormack-corrected and clamped exactly
 * as the smoke's dye is — a colour band with a blurred edge is a puddle, and
 * a correction allowed to invent a new extreme is grid noise. See `carryDye`
 * in `lib/smoke.ts` for the full account.
 */
function carryFilm(film: Film, step: number): void {
  const { inside } = film;
  const from = film.film;
  const into = film.film0;

  advectField(film, from, back, step);
  advectField(film, back, forward, -step);

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

  film.film = into;
  film.film0 = from;
}

/** Where the two halves of the correction are worked out. */
const back = new Float32Array(GRID * GRID);
const forward = new Float32Array(GRID * GRID);

/**
 * What each thickness reflects, per channel, 0 to 255.
 *
 * The interference arithmetic, run once per representable thickness: for each
 * of three wavelengths — a red, a green and a blue the eye's cones roughly
 * stand at — the reflected share is `cos²(2πnd/λ + π/2)`, the half-turn being
 * the phase flip light picks up reflecting off the denser medium at the top
 * surface. It is why a vanishing film goes *dark* rather than white: at
 * `d → 0` the two reflections cancel at every wavelength, which is the black
 * film a soap bubble shows just before it pops.
 */
const WAVELENGTHS = [610, 545, 465] as const;

const LUT_SIZE = 256;

const lut = new Uint8ClampedArray(LUT_SIZE * 3);

for (let at = 0; at < LUT_SIZE; at += 1) {
  const depth = THINNEST_NM + (at / (LUT_SIZE - 1)) * (THICKEST_NM - THINNEST_NM);

  for (let channel = 0; channel < 3; channel += 1) {
    const phase = (2 * Math.PI * OIL * depth) / WAVELENGTHS[channel]! + Math.PI / 2;

    lut[at * 3 + channel] = Math.round(255 * Math.cos(phase) ** 2);
  }
}

/** The interference colour for a film amount in `[0, 1]`, from the table. */
export function filmColour(amount: number): [number, number, number] {
  const at = Math.min(LUT_SIZE - 1, Math.max(0, Math.round(amount * (LUT_SIZE - 1))));

  return [lut[at * 3]!, lut[at * 3 + 1]!, lut[at * 3 + 2]!];
}

/**
 * Paints the film onto a small canvas, one pixel per cell.
 *
 * The colour is the table's; the alpha is how much film is there at all, so
 * the bare fluid shows the cell's dark ground through it. Dark, because these
 * colours are reflections — an oil slick is vivid on wet asphalt and
 * invisible on a white page, for the same reason the glitter's flashes are.
 *
 * @returns The canvas, or null where there is no canvas to be had.
 */
export function paintFilm(film: Film): HTMLCanvasElement | null {
  const surface = filmSurface();

  if (!surface) {
    return null;
  }

  const { canvas, ctx, image } = surface;
  const pixels = image.data;

  for (let k = 0; k < GRID * GRID; k += 1) {
    const at = k * 4;
    const amount = film.film[k]!;
    const colour = filmColour(amount);

    pixels[at] = colour[0];
    pixels[at + 1] = colour[1];
    pixels[at + 2] = colour[2];
    // Eased in over the thinnest films, so the slick has a shore rather than
    // a cliff where it runs out.
    pixels[at + 3] = Math.round(255 * Math.min(1, amount * 8));
  }

  ctx.putImageData(image, 0, 0);

  return canvas;
}

/** The one surface the film is drawn on, built once. */
let surface: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; image: ImageData } | null =
  null;
let surfaceTried = false;

function filmSurface() {
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
