import { CHAMBER_RADIUS } from './chamber';
import {
  advectField,
  breatheFlow,
  capFlow,
  carryFlow,
  carryScalar,
  confineFlow,
  conserveScalar,
  createFlow,
  driveFlow,
  positionOf as flowPositionOf,
  projectFlow,
  type Flow,
} from './flow';
import { createNoise, type Noise } from './noise';
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
 * The thinnest the fluid is ever taken to be, for the dye's weight.
 *
 * `lib/ink.ts` floors its own the same way and for the same reason: at a
 * literal nought there is nothing at all to spend the falling on, and a cell
 * that accelerates without limit is not a thin fluid, it is a missing one. It
 * is low enough that the thin end of the slider still reads as thin.
 */
const THINNEST = 0.12;

/**
 * The most dye one cell's water is taken to be carrying, for its weight.
 *
 * See {@link fall}. Sinking crowds and crowding is heavier, so uncapped the
 * weight is a feedback loop with the fluid's drag for its only brake — and at
 * the thin end there is hardly any. `lib/ink.ts` calls the same number
 * `SOAKED`.
 */
const SOAKED = 2;

/**
 * How strongly the dye takes its colour out of the light.
 *
 * Above one, and deliberately. Advection conserves the dye but spreads it, so
 * the concentration anywhere falls as the ribbons draw out — and a cell that
 * started saturated is a pale wash a minute later even though every drop of it
 * is still in there. A strong dye is the honest fix: real ink is strong enough
 * that a tenth of a cell's worth still colours what is behind it.
 *
 * Lower than it was, because the cell no longer leaks: the old 1.9 was partly
 * standing in for the dye the trace was losing, and with the total conserved
 * the same number came out as three slabs of saturated colour with nothing to
 * see through.
 */
const STRENGTH = 1.35;

/**
 * The most dye one cell may hold, in cloud-fulls.
 *
 * Headroom above the one a cloud is poured at, and it is what lets the cell be
 * sealed. Where the flow crowds, dye piles up — that is what crowding is — and
 * a field clamped at exactly what it was filled to cannot take the pile: the
 * conservation hands the loss back and the clamp throws it straight away
 * again, which is a leak with an extra step in it. With room above, a crowded
 * cell simply holds more, and a fold where two ribbons stack reads darker than
 * either, which is what stacked dye does. `lib/ink.ts` carries the same number
 * for the same reason.
 */
export const HOLD = 2.5;

/**
 * What the three dyes are, as the share of each primary that gets through a
 * unit depth of the dye at full strength.
 *
 * The first version was not a colour at all: dye *d* was written straight into
 * channel *d*, so the three were a printer's cyan, magenta and yellow at full
 * chroma and the cell came out looking like a test page — a red so pure it has
 * no red in the ground it is over, a cyan the eye cannot find a name for. Real
 * dye does not take out a primary, it takes out a *band*: a rose ink leaves
 * plenty of blue and a little green, which is why two of them folded together
 * make a colour a painter would recognise instead of one of six corners of the
 * cube.
 *
 * So each dye carries a transmittance per channel and the light is multiplied
 * through all three — Beer and Lambert, exactly as the liquid timer's beads
 * are shaded: what comes through a depth `d` is the tint raised to `d`, so a
 * ribbon is dark where it is thick and shows its own hue where it is drawn out
 * thin. Nothing chooses what an overlap looks like; ink over ink is the
 * product, which is what two transparent things in front of each other do.
 *
 * The three are a **triad an ink-maker would sell**: a peacock blue-green, a
 * quinacridone rose and a turmeric gold. They are far enough apart on the
 * wheel to make a full range between them and none of them sits on a primary,
 * so no pair of them can mix to the flat mud a pair of opposites gives.
 */
const DYE_TINTS: readonly (readonly [number, number, number])[] = [
  // Peacock: keeps its green, loses most of its red.
  [0.1, 0.62, 0.72],
  // Rose: keeps red, keeps a good deal of blue, loses green.
  [0.95, 0.16, 0.5],
  // Turmeric: keeps red and green, loses blue almost entirely.
  [0.98, 0.7, 0.06],
];

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

/** How hard warmth lifts, against gravity, per unit of heat. */
const FIRE = 1.1;

/**
 * The breeze, so a cell nobody is turning never quite comes to rest. Curl
 * noise, and how it works is in `breatheFlow` in `lib/flow.ts`; this is only
 * how hard smoke's own is.
 */
const BREEZE = 0.32;

/** Noise cells across the chamber: the breeze's spatial grain. */
const BREEZE_GRAIN = 2.6;

/** How fast the breeze wanders, in noise cells per second of its own time. */
const BREEZE_TEMPO = 0.22;

export interface Smoke extends Flow {
  /** How much of each dye is in each cell, 0 to 1. */
  dye: Float32Array[];
  dye0: Float32Array[];
  /**
   * How warm each cell is, 0 to 1.
   *
   * The other half of what makes smoke go up. The dye's weight alone makes
   * sinking curtains; warmth makes rising plumes, and the shear between a
   * plume and the cool air beside it is what rolls the top of it into the
   * mushroom cap everyone recognises as smoke (Fedkiw, Stam and Jensen,
   * 2001). Born where the dye is born — the clouds arrive warm — carried on
   * the same fluid, and spent by rising.
   */
  heat: Float32Array;
  heat0: Float32Array;
  /** Seconds the cell has been alive, for the breeze's slow wandering. */
  elapsed: number;
  /** The cell's own draught. See {@link BREEZE}. */
  draught: Noise;
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
    heat: new Float32Array(GRID * GRID),
    heat0: new Float32Array(GRID * GRID),
    elapsed: 0,
    draught: createNoise(seed),
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

  // The clouds arrive warm: heat everywhere the dye is, so the cell opens
  // with plumes about to rise rather than curtains about to fall.
  for (let k = 0; k < GRID * GRID; k += 1) {
    let dyed = 0;

    for (let d = 0; d < DYES; d += 1) {
      dyed += smoke.dye[d]![k]!;
    }

    smoke.heat[k] = Math.min(1, dyed * 0.55);
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
  smoke.elapsed += step;
  fall(smoke, step, thickness, angle);
  breatheFlow(smoke, {
    draught: smoke.draught,
    elapsed: smoke.elapsed,
    step,
    strength: BREEZE,
    grain: BREEZE_GRAIN,
    tempo: BREEZE_TEMPO,
  });
  driveFlow(smoke, { step, thickness, swirl });
  confineFlow(smoke, step, CONFINE);
  projectFlow(smoke);
  carryFlow(smoke, step);
  projectFlow(smoke);
  capFlow(smoke);

  // The warmth rides the same fluid as the dye. A plain trace is enough: heat
  // is a force, not a picture, and a slightly blurred force is still a force.
  advectField(smoke, smoke.heat, smoke.heat0, step);

  const swap = smoke.heat;

  smoke.heat = smoke.heat0;
  smoke.heat0 = swap;

  for (let d = 0; d < DYES; d += 1) {
    const from = smoke.dye[d]!;
    const into = smoke.dye0[d]!;

    carryScalar(smoke, from, into, { step, correct: CORRECT, high: HOLD });
    // A sealed cell keeps its dye. Tracing backwards does not know that — see
    // `conserveScalar` — and a cell of smoke was quietly evaporating: 82% of
    // it left after ten seconds, 33% after a minute, 18% after two. It was
    // documented in ROADMAP.md and left alone because the look had been tuned
    // around the fading; the look is being re-cut here anyway, and a cell that
    // empties itself is not a look, it is a leak.
    conserveScalar(smoke, from, into, HOLD);
    smoke.dye[d] = into;
    smoke.dye0[d] = from;
  }
}

/**
 * The dye falling and the warmth lifting, through the fluid that carries
 * both. See {@link INK_WEIGHT} and {@link FIRE}: the two pull opposite ways
 * along the same axis, and the shear where they disagree is the folding.
 *
 * Two things about how it is weighed matter more than either constant, and
 * both were wrong here while `lib/ink.ts` — which is the same fluid with paint
 * on it instead of dye — had them right from the day it was written.
 *
 * **It is weighed against the cell's own average**, which is the Boussinesq
 * way of putting it: water is heavy only *compared with the water beside it*.
 * Take the average out and what is left is the overturning, which is a plume;
 * leave it in and every cell holding dye is pushed at once, which is the whole
 * body of it sliding to the floor.
 *
 * **And the load is capped**, because sinking is a feedback loop — heavy fluid
 * sinks, sinking fluid crowds, crowded fluid is heavier — and at the thin end
 * of the Thickness slider there is almost no drag to spend the energy on.
 * Measured before this: a cell of smoke at Thickness 0 held a median speed of
 * 156 cell units a second after five, and NaN by thirty. Water saturated with
 * dye is not much heavier for holding more of it.
 */
function fall(smoke: Smoke, step: number, thickness: number, angle: number): void {
  const { u, v, inside } = smoke;
  const thick = 1 + THICKEST * Math.max(THINNEST, Math.min(1, Math.max(0, thickness)));
  const drop = (GRAVITY * INK_WEIGHT * step) / thick;
  // Warmth enters as a *negative* load, at its own strength against the dye's,
  // so that the two are weighed against the same average.
  const warmth = FIRE / INK_WEIGHT;
  const downX = Math.sin(angle);
  const downY = Math.cos(angle);
  let carried = 0;
  let cells = 0;

  for (let k = 0; k < GRID * GRID; k += 1) {
    if (!inside[k]) {
      continue;
    }

    let dyed = 0;

    for (let d = 0; d < DYES; d += 1) {
      dyed += smoke.dye[d]![k]!;
    }

    loads[k] = Math.min(SOAKED, dyed) - smoke.heat[k]! * warmth;
    carried += loads[k]!;
    cells += 1;
  }

  const even = cells > 0 ? carried / cells : 0;

  for (let k = 0; k < GRID * GRID; k += 1) {
    if (!inside[k]) {
      continue;
    }

    const pull = drop * (loads[k]! - even);

    u[k] = u[k]! + downX * pull;
    v[k] = v[k]! + downY * pull;
  }
}

/** How much dye and warmth each cell's water is carrying, for its weight. */
const loads = new Float32Array(GRID * GRID);

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

  shadeFor(strength);

  for (let k = 0; k < GRID * GRID; k += 1) {
    const at = k * 4;
    let red = 1;
    let green = 1;
    let blue = 1;

    for (let d = 0; d < DYES; d += 1) {
      const held = smoke.dye[d]![k]!;

      if (held <= 0) {
        continue;
      }

      // Beer and Lambert, read off the table: each unit of dye passes a fixed
      // share of what reaches it, so the depth is an exponent and not a scale.
      // See DYE_TINTS and {@link shades}.
      const deep = held >= HOLD ? SHADES - 1 : Math.round((held / HOLD) * (SHADES - 1));
      const shade = (d * SHADES + deep) * 3;

      red *= shades[shade]!;
      green *= shades[shade + 1]!;
      blue *= shades[shade + 2]!;
    }

    pixels[at] = Math.round(255 * red);
    pixels[at + 1] = Math.round(255 * green);
    pixels[at + 2] = Math.round(255 * blue);
    pixels[at + 3] = 255;
  }

  ctx.putImageData(image, 0, 0);

  return canvas;
}

/**
 * Steps in each dye's depth table.
 *
 * The exponential a dye's depth wants is a `pow` per channel per dye per cell,
 * which is eighty thousand of them for one frame of a cell this size. The
 * answer depends on nothing but how much of that one dye is here, so it is
 * solved once for each representable amount and read back — the same trick the
 * paint's colour table and the film's interference table are.
 */
const SHADES = 129;

/** What each dye passes at each depth, per channel. See {@link shadeFor}. */
const shades = new Float32Array(DYES * SHADES * 3);

/** Which strength {@link shades} currently holds. */
let shadedAt = -1;

/** Fills {@link shades} for a dye strength, if it is not already filled. */
function shadeFor(strength: number): void {
  if (shadedAt === strength) {
    return;
  }

  shadedAt = strength;

  for (let d = 0; d < DYES; d += 1) {
    const tint = DYE_TINTS[d]!;

    for (let k = 0; k < SHADES; k += 1) {
      const held = (k / (SHADES - 1)) * HOLD * strength;
      const at = (d * SHADES + k) * 3;

      shades[at] = tint[0] ** held;
      shades[at + 1] = tint[1] ** held;
      shades[at + 2] = tint[2] ** held;
    }
  }
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
