import { CHAMBER_RADIUS } from './chamber';
import {
  capFlow,
  carryFlow,
  carryScalar,
  confineFlow,
  conserveScalar,
  createFlow,
  driveFlow,
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

/** What the fluid under the film gives back where the interference cancels. */
const SHEEN = 0.09;

/**
 * The thickness a full cell of the field maps to, in nanometres.
 *
 * Enough to sweep the interference through about three orders — the classic
 * slick sequence of grey, gold, magenta, blue and pale green — which is what
 * makes the bands read as an oil film rather than as a gradient that happens
 * to be colourful. The sweep starts at a true zero, so the edge of a slick
 * wears the *black film* a soap bubble shows just before it pops: at nothing
 * the top surface's phase flip cancels every wavelength.
 *
 * It was a micron, which is six orders in the blue, and the eye cannot tell
 * the fifth from the third: past about the third the fringes are closer
 * together than the eye's own bands are wide, so the colour washes out to
 * pearl and all the extra thickness buys is a crowd of tight rings in the
 * middle of every slick. Fewer, wider orders is both the prettier picture and
 * the more ordinary film — a slick on a puddle is a few hundred nanometres,
 * not a micron.
 */
const THICKEST_NM = 620;
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
  const pools = Math.max(3, Math.round(3 + 4 * much));

  for (let pool = 0; pool < pools; pool += 1) {
    const angle = rng() * Math.PI * 2;
    const distance = Math.sqrt(rng()) * CHAMBER_RADIUS * 0.8;
    const atX = Math.cos(angle) * distance;
    const atY = Math.sin(angle) * distance;
    // Broad and overlapping, so the cell opens as one slick with thick and
    // thin places in it rather than as a handful of separate spots on a dark
    // ground — a slick is a sheet, and what is worth watching is the bands
    // sliding across the whole of it.
    const reach = CHAMBER_RADIUS * (0.4 + 0.3 * much + rng() * 0.25);
    const depth = 0.3 + 0.7 * much * rng();

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
  capFlow(film);
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
 * a correction allowed to invent a new extreme is grid noise. See
 * `carryScalar` in `lib/flow.ts` for the full account.
 *
 * And then the oil that the trace lost is handed back, because a sealed cell
 * does not drain. This was the film's own version of the fault ROADMAP.md
 * recorded against the smoke, and it was worse here: measured, a cell left to
 * itself held **a fifth of its oil after a minute** at the thin end of the
 * slider. What that looks like is not an empty cell — it is a slick shrinking
 * to a few small rings on a black ground while the colours run backwards down
 * the orders, which is what the screenshots of this substance kept showing and
 * nobody had named.
 */
function carryFilm(film: Film, step: number): void {
  const from = film.film;
  const into = film.film0;

  carryScalar(film, from, into, { step, correct: CORRECT, high: HOLD });
  conserveScalar(film, from, into, HOLD);

  film.film = into;
  film.film0 = from;
}

/**
 * The most oil one cell may hold, in full films.
 *
 * Headroom over the thickness the table's colours run out at, so that where
 * the flow crowds the oil it can pile up rather than being clipped — and a
 * clipped cell is a cell that cannot take back what the conservation hands
 * it. The colours simply carry on into the next order up there, which is what
 * a thicker film does.
 */
const HOLD = 1.35;

/**
 * What each thickness reflects, per channel, 0 to 255.
 *
 * The interference is the same arithmetic it always was — the reflected share
 * of a wavelength is `cos²(2πnd/λ + π/2)`, the half-turn being the phase flip
 * light picks up reflecting off the denser medium at the top surface, which is
 * why a vanishing film goes *dark* rather than white — but **what it is
 * evaluated at** has changed entirely, and that is the whole of why this
 * substance used to look like a screensaver.
 *
 * It was evaluated at three wavelengths, one per channel, on the reasoning
 * that the eye has three kinds of cone standing at about those places. The eye
 * does not work that way and neither does a colour: a cone answers to a wide
 * *band* of wavelengths, and what the band does to a fringe pattern is average
 * it. Sample it at three points instead and every fringe survives at full
 * contrast however tightly they are packed, so the fifth order comes out as
 * saturated as the first — a hard rainbow of pure red, green and blue rings,
 * which is not a colour any oil slick has ever shown.
 *
 * Done properly it is an integral: the film's reflectance across the whole
 * visible spectrum, weighed by the eye's three colour-matching functions, and
 * that integral does for free the thing that makes a slick look like a slick.
 * A thin film's fringes are far apart in wavelength and survive the averaging,
 * so the first orders are the vivid gold, magenta and blue everyone knows; a
 * thicker film's fringes crowd together, the average washes them out, and by
 * the fourth or fifth order the colour has faded to a pale pearl. Which is
 * exactly what a real slick does as it thickens, and it comes out of the
 * arithmetic rather than being drawn in.
 *
 * The colour-matching functions are the multi-lobe Gaussian fit of Wyman,
 * Sloan and Shirley, _Simple Analytic Approximations to the CIE XYZ Color
 * Matching Functions_ (JCGT 2013) — three or two lobes each, accurate to
 * about a per cent, and it saves carrying a table of measurements.
 */
const LUT_SIZE = 512;

const lut = new Uint8ClampedArray(LUT_SIZE * 3);

/** One lobe of the fit: a Gaussian with a different width either side. */
function lobe(at: number, peak: number, below: number, above: number): number {
  const t = (at - peak) * (at < peak ? 1 / below : 1 / above);

  return Math.exp(-0.5 * t * t);
}

/** The eye's three colour-matching functions at one wavelength, in nanometres. */
function matching(nm: number): [number, number, number] {
  return [
    1.056 * lobe(nm, 599.8, 37.9, 31.0) +
      0.362 * lobe(nm, 442.0, 16.0, 26.7) -
      0.065 * lobe(nm, 501.1, 20.4, 26.2),
    0.821 * lobe(nm, 568.8, 46.9, 40.5) + 0.286 * lobe(nm, 530.9, 16.3, 31.1),
    1.217 * lobe(nm, 437.0, 11.8, 36.0) + 0.681 * lobe(nm, 459.0, 26.0, 13.8),
  ];
}

/** Building the table: the spectrum, at 5 nm, over the range the eye answers to. */
const FROM_NM = 385;
const TO_NM = 715;
const NM_STEP = 5;

/** Screen gamma, for the one place linear light has to become a pixel. */
const GAMMA = 2.2;

{
  // The eye's own weights, and what a flat reflector comes to under them — so
  // that a film reflecting everything equally comes out white rather than
  // whatever colour the sampling happens to lean.
  const bands: { x: number; y: number; z: number; nm: number }[] = [];
  let whiteY = 0;

  for (let nm = FROM_NM; nm <= TO_NM; nm += NM_STEP) {
    const [x, y, z] = matching(nm);

    bands.push({ x, y, z, nm });
    whiteY += y;
  }

  for (let at = 0; at < LUT_SIZE; at += 1) {
    // Up to the headroom the field is allowed, so a crowded cell simply shows
    // the next order up rather than sticking at the top of the table.
    const depth = THINNEST_NM + (at / (LUT_SIZE - 1)) * HOLD * (THICKEST_NM - THINNEST_NM);
    let bigX = 0;
    let bigY = 0;
    let bigZ = 0;

    for (const band of bands) {
      const phase = (2 * Math.PI * OIL * depth) / band.nm + Math.PI / 2;
      // The interference, over what the fluid under the film returns anyway.
      // A film whose two reflections cancel is the *black film* a bubble shows
      // before it pops — but the liquid beneath is water and not a hole, and a
      // slick with a floor of nothing turns every shore of every patch into a
      // band of pure black, which is a hole in the picture and not a colour.
      const reflected = SHEEN + (1 - SHEEN) * Math.cos(phase) ** 2;

      bigX += reflected * band.x;
      bigY += reflected * band.y;
      bigZ += reflected * band.z;
    }

    bigX /= whiteY;
    bigY /= whiteY;
    bigZ /= whiteY;

    // XYZ to linear sRGB, then the screen's gamma. Negative components are
    // colours outside what the screen can show; clipped, which desaturates
    // them towards the nearest thing it can.
    const red = 3.2406 * bigX - 1.5372 * bigY - 0.4986 * bigZ;
    const green = -0.9689 * bigX + 1.8758 * bigY + 0.0415 * bigZ;
    const blue = 0.0557 * bigX - 0.204 * bigY + 1.057 * bigZ;

    lut[at * 3] = Math.round(255 * onScreen(red));
    lut[at * 3 + 1] = Math.round(255 * onScreen(green));
    lut[at * 3 + 2] = Math.round(255 * onScreen(blue));
  }
}

/** One channel of linear light, as the screen wants it. */
function onScreen(light: number): number {
  return Math.min(1, Math.max(0, light)) ** (1 / GAMMA);
}

/** The interference colour for a film amount in `[0, 1]`, from the table. */
export function filmColour(amount: number): [number, number, number] {
  const at = Math.min(LUT_SIZE - 1, Math.max(0, Math.round((amount / HOLD) * (LUT_SIZE - 1))));

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
  const across = GRID * FINE;
  const held = film.film;

  // The middle of the picture and how far the wall is, in painted pixels, so
  // the fifth of the square that lies outside the round cell is cleared rather
  // than being read, interpolated and coloured to nothing.
  const middle = (across - 1) / 2;
  const wall = (GRID * FINE) / 2 + FINE;
  const walled = wall * wall;

  for (let j = 0; j < across; j += 1) {
    // Where this pixel sits in the field, in cells, at the cell centres.
    const y = j / FINE - 0.5;
    const downBy = j - middle;
    const downSquared = downBy * downBy;
    const j0 = Math.floor(y);
    const j1 = Math.min(GRID - 1, Math.max(0, j0 + 1));
    const downTo = Math.min(GRID - 1, Math.max(0, j0));
    const fy = smooth(y - j0);
    const rowUp = downTo * GRID;
    const rowDown = j1 * GRID;

    for (let i = 0; i < across; i += 1) {
      const alongBy = i - middle;

      if (alongBy * alongBy + downSquared > walled) {
        const clear = (i + j * across) * 4;

        pixels[clear] = 0;
        pixels[clear + 1] = 0;
        pixels[clear + 2] = 0;
        pixels[clear + 3] = 0;
        continue;
      }

      const x = i / FINE - 0.5;
      const i0 = Math.floor(x);
      const i1 = Math.min(GRID - 1, Math.max(0, i0 + 1));
      const leftAt = Math.min(GRID - 1, Math.max(0, i0));
      const fx = smooth(x - i0);
      // Bilinear, but on eased weights: a straight bilinear read is a plane
      // within each cell and kinks at every cell boundary, and a contour
      // through a field of kinks *is* a staircase — which is what the colour
      // bands of this substance came out as, plainly enough to see in a
      // screenshot at any zoom. Easing the weights makes the reconstruction
      // smooth across the boundary as well as within it, so a band edge is a
      // curve at whatever size the cell is drawn.
      const amount =
        (1 - fy) * ((1 - fx) * held[rowUp + leftAt]! + fx * held[rowUp + i1]!) +
        fy * ((1 - fx) * held[rowDown + leftAt]! + fx * held[rowDown + i1]!);
      const at = (i + j * across) * 4;
      const shade = Math.min(LUT_SIZE - 1, Math.round((amount / HOLD) * (LUT_SIZE - 1))) * 3;

      pixels[at] = lut[shade]!;
      pixels[at + 1] = lut[shade + 1]!;
      pixels[at + 2] = lut[shade + 2]!;
      // Eased in over the thinnest films, so the slick has a shore rather than
      // a cliff where it runs out.
      pixels[at + 3] = amount >= 0.125 ? 255 : Math.round(255 * amount * 8);
    }
  }

  ctx.putImageData(image, 0, 0);

  return canvas;
}

/**
 * How many pixels the film is painted at, per cell of the fluid it rides.
 *
 * The fluid is smooth and does not want a finer grid — but the *picture* does,
 * because interference colour is a violently non-linear function of thickness
 * and the bands it draws are all edge. Painted one pixel per cell and scaled
 * up, a band's edge was the grid's own staircase at any zoom past about half.
 * Three pixels a cell puts the film's own resolution at the lava's, which has
 * been measured as under the eye's for an edge.
 */
const FINE = 3;

/** Smoothstep, for a reconstruction with no kink at a cell boundary. */
function smooth(at: number): number {
  return at * at * (3 - 2 * at);
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
  canvas.width = GRID * FINE;
  canvas.height = GRID * FINE;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  if (!ctx) {
    return null;
  }

  const image = ctx.createImageData(GRID * FINE, GRID * FINE);

  if (!image.data.length) {
    return null;
  }

  surface = { canvas, ctx, image };

  return surface;
}
