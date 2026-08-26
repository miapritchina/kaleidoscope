import { CHAMBER_RADIUS } from './chamber';
import {
  breatheFlow,
  carryFlow,
  carryScalar,
  conserveScalar,
  createFlow,
  driveFlow,
  positionOf as flowPositionOf,
  projectFlow,
  type Flow,
} from './flow';
import { createNoise, type Noise } from './noise';
import {
  createFlocs,
  createPalette,
  paintPigment,
  stirFlocs,
  type Flocs,
  type Palette,
} from './pigment';
import { mulberry32 } from './random';

/**
 * A cell of watercolour let into water.
 *
 * One of the substances the liquid cell holds instead of loose pieces — see
 * `lib/lava.ts`, `lib/smoke.ts`, `lib/glitter.ts` and `lib/film.ts` for the
 * others. The fluid is the shared one in `lib/flow.ts`. What this module adds
 * is that what rides it is **paint**, and paint is not a colour: it is a solid
 * ground from a rock or a dyestuff, held in water, and everything worth
 * watching here follows from that one fact.
 *
 * Smoke is the near neighbour and the contrast is the point of having both.
 * Smoke carries three dyes, which is to say three colours: dissolved, weightless
 * relative to the water, mixed once and mixed for good, and taking their own
 * primary out of the light one each. This carries three real paints out of a
 * paint box — measured ones, by Colour Index number — and they behave the way
 * their pigments do:
 *
 * - **They mix as paint, not as light.** Kubelka-Munk over the whole mixture
 *   rather than three primaries subtracted one each, so ultramarine and a
 *   green-gold yellow give a green, that green over quinacridone gives the grey
 *   a painter would mix, and no pair of them ever gives the flat mud that
 *   averaging colours gives. See `lib/pigment.ts`.
 * - **They come apart.** Each paint falls through the water at its own rate —
 *   quinacridone is milled to a fraction of a micron and magnetite black is a
 *   coarse grit, better than five to one between them — so a mixture does not
 *   stay a mixture. A green ribbon sinks and separates, the blue trailing below
 *   the yellow, and the cell is never the colour it started as. This is the
 *   thing to watch, and it is one term in the advection: see {@link SETTLE}.
 * - **They clump.** Coarse pigment flocculates rather than staying evenly
 *   spread, and the clumps are the mottle a granulating wash is loved for.
 *   Ultramarine does it violently and phthalo not at all.
 * - **They have edges.** Where a wash's boundary sits, pigment gathers along
 *   it and dries as a dark line. Nothing dries in a sealed cell, so the rim is
 *   drawn rather than deposited — the same shortcut paintwheel takes.
 *
 * Lifted from `paintwheel`, a wet-watercolour simulator built on Curtis,
 * Anderson, Seims, Fleischer and Salesin, _Computer-Generated Watercolor_
 * (SIGGRAPH 1997). Everything that model does with *paper* — deposition,
 * lifting, staining, drying, backruns, the tooth that granulation settles into
 * — is gone, because there is no paper in an object cell. There is a round
 * glass wall and water, and paint that stays in suspension for as long as
 * anyone is watching. That is the one case a watercolour model never has to
 * work for and the only case this one does.
 */

/**
 * Cells across the chamber.
 *
 * The same as smoke's, and for the same reason: what there is to look at is
 * ribbons folding into finer ribbons, and at half this it reads as blur. The
 * grid is drawn scaled up with smoothing, which is a bilinear filter over the
 * same field the solver samples bilinearly, so the seam between what is
 * simulated and what is shown never shows.
 */
export const GRID = 96;

/** How many paints are in the cell. A limited palette, and `lib/pigment.ts` says why. */
export const PAINTS = 3;

/** Steps of the fluid per second. Half a phone's frames; paint has no fast motion in it. */
const RATE = 30;

/** Downward acceleration, matched to the chamber's own. */
const GRAVITY = 6;

/**
 * How much heavier the suspension is than the water it hangs in.
 *
 * A loaded patch of water is heavier than a clear one, so it sinks, the clear
 * water it displaces comes up around it, and that overturning is what draws the
 * ribbons out. Rather more than smoke's dye, because this is a solid in
 * suspension and that is a dye in solution.
 */
const LOAD = 1.5;

/** How much thicker fluid holds the falling paint up, on top of the flow's own drag. */
const THICKEST = 6;

/** The most paint a cell's water is treated as carrying, for weight. See {@link sink}. */
const SOAKED = 2;

/**
 * The thinnest the fluid is allowed to be under a cell of paint.
 *
 * The Thickness slider goes to nothing, and nothing is not a fluid this solver
 * can carry: below about a tenth the drag stops being able to spend the energy
 * the confinement and the falling paint put in, and the velocity field runs
 * away — 10^23 cell widths a second at 0.05, and then not a number at all.
 * (Smoke does the same there and worse, which is where this was found; it is
 * not this module's to change.) So the thin end of the slider is water rather
 * than vacuum. Water has drag, and between here and nothing there was never
 * anything to see anyway.
 */
const THINNEST = 0.12;

/**
 * How fast a paint falls through the water on its own account, in cell units a
 * second, per unit of its weight.
 *
 * The separation, and it is one term. {@link LOAD} above is the *suspension*
 * sinking — all three paints together, carrying the water with them. This is
 * each paint sliding through that water at its own rate, and it is the
 * difference between a coloured fluid and paint. Across a paint box those rates
 * differ by better than five to one, so half a minute of drifting is enough to
 * see a mixed ribbon leave one of its components behind and carry another on.
 * A thicker fluid holds them all up, in proportion, which is what the Thickness
 * slider means here.
 *
 * The sediment does not simply pile at the bottom and stay there, because
 * "down" is the cell's own down: turning the tube sweeps gravity round the
 * cell, and what has settled is dragged back up the wall and shed into the
 * body of the water again.
 */
const SETTLE = 0.55;

/** How much of the trace's own error is corrected, 0 to 1. See `carryScalar`. */
const CORRECT = 0.9;

/**
 * The most of one paint a single cell may hold, as a multiple of a full cloud.
 *
 * Paint settles, and settled paint is a crowd: a cell at the bottom of the wall
 * ends up holding several clouds' worth of what fell into it. Capping that at
 * one cloud would cap it at what a *pale* wash holds, and then the pigment that
 * arrives after it has nowhere to go — which is a cell that quietly loses
 * everything it settles. Four is deep enough that the crowd never runs out of
 * room; what it looks like at that depth is mass tone, which is what a
 * millimetre of settled pigment looks like.
 */
const HOLD = 4;

/** The breeze, so a cell nobody is turning never quite comes to rest. */
const BREEZE = 0.26;

/** Noise cells across the chamber: the breeze's spatial grain. */
const BREEZE_GRAIN = 2.2;

/** How fast the breeze wanders, in noise cells per second of its own time. */
const BREEZE_TEMPO = 0.18;

/**
 * How strongly the paint takes its colour out of the light.
 *
 * One, where smoke's dye is at 1.9, and the difference is `conserveScalar`.
 * Smoke needs a strong dye because its cell quietly empties — the concentration
 * everywhere falls as the trace loses it, so a cell that opened saturated is a
 * pale wash a minute later. This one keeps what was poured into it, so the
 * depth the palette was solved for is the depth it is looked at. Turning it up
 * anyway only pushes the cloud cores past the depth at which Kubelka-Munk is
 * black whatever is in it: at 1.45 a palette with a Prussian in it opened as a
 * field of near-black blobs.
 */
const STRENGTH = 1;

export interface Ink extends Flow {
  /** How much of each paint is in each cell, 0 to 1. */
  paint: Float32Array[];
  paint0: Float32Array[];
  /** The three paints in the cell, and their optics. See `lib/pigment.ts`. */
  palette: Palette;
  /** Where the pigment has clumped, carried by the water like everything else. */
  flocs: Flocs;
  /** Seconds the cell has been alive, for the breeze and the clumping. */
  elapsed: number;
  /** The cell's own draught. */
  draught: Noise;
}

/** Where a cell's middle is, in cell units. */
function positionOf(index: number): number {
  return flowPositionOf(GRID, index);
}

/** Builds a cell of watercolour, in a few clouds of each paint. */
export function createInk(seed: number, amount = 1): Ink {
  const rng = mulberry32(seed);
  const palette = createPalette(seed);
  const ink: Ink = {
    ...createFlow(GRID),
    paint: Array.from({ length: PAINTS }, () => new Float32Array(GRID * GRID)),
    paint0: Array.from({ length: PAINTS }, () => new Float32Array(GRID * GRID)),
    palette,
    flocs: createFlocs(GRID, seed),
    elapsed: 0,
    draught: createNoise(seed),
  };
  const much = Math.min(1, Math.max(0, amount));
  // Clouds of *mixed* paint rather than one cloud per paint, which is the whole
  // point of the instrument and was got wrong first. Three paints dropped in
  // separately are three colours drifting past each other: they never mix, so
  // they can never come apart, and the difference between their weights has
  // nothing to act on. A cloud carrying a recipe does — it is one colour when
  // it goes in, and half a minute later it is the two or three paints it was
  // mixed from, sorted by weight down the length of it.
  const clouds = Math.max(2, Math.round(3 + 5 * much));

  for (let cloud = 0; cloud < clouds; cloud += 1) {
    const recipe = mix(rng);
    const angle = rng() * Math.PI * 2;
    const distance = Math.sqrt(rng()) * CHAMBER_RADIUS * 0.8;
    const atX = Math.cos(angle) * distance;
    const atY = Math.sin(angle) * distance;
    const reach = CHAMBER_RADIUS * (0.16 + 0.16 * much + rng() * 0.16);

    for (let j = 0; j < GRID; j += 1) {
      for (let i = 0; i < GRID; i += 1) {
        const k = i + j * GRID;

        if (!ink.inside[k]) {
          continue;
        }

        const away = Math.hypot(positionOf(i) - atX, positionOf(j) - atY) / reach;

        if (away >= 1) {
          continue;
        }

        const soft = (1 - away * away) ** 2;

        for (let d = 0; d < PAINTS; d += 1) {
          // A strong paint is poured proportionally less, or a cell of Prussian
          // and potter's pink is a cell of Prussian. See `pour` in
          // `lib/pigment.ts`.
          const share = palette.paints[d]!.pour;
          const field = ink.paint[d]!;

          field[k] = Math.min(share, field[k]! + share * recipe[d]! * soft);
        }
      }
    }
  }

  // A few swirls to start it off. Round clouds sinking straight down stay round
  // for a long time, and the cell needs a reason to be asymmetric before it can
  // fold over on itself.
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

        if (!ink.inside[k]) {
          continue;
        }

        const x = positionOf(i) - atX;
        const y = positionOf(j) - atY;
        const near = Math.exp((-(x * x + y * y) / (reach * reach)) * 2);

        ink.u[k] = ink.u[k]! - y * spin * near;
        ink.v[k] = ink.v[k]! + x * spin * near;
      }
    }
  }

  return ink;
}

/**
 * What one cloud is mixed from: a share of each paint, adding to one.
 *
 * One, two or all three, because a palette is used all three ways — a wash of
 * one colour, a mixture of two, and the neutral all three together make. Adding
 * to one rather than each at full strength keeps a mixed cloud the same depth
 * as a plain one; two paints both at full strength is a layer deep enough to be
 * black whatever it is mixed from, which is Kubelka-Munk telling the truth
 * about a mistake.
 */
function mix(rng: () => number): number[] {
  const recipe = [0, 0, 0];
  const order = [0, 1, 2];

  for (let at = order.length - 1; at > 0; at -= 1) {
    const swap = Math.floor(rng() * (at + 1));
    const held = order[at]!;

    order[at] = order[swap]!;
    order[swap] = held;
  }

  // Two paints more often than one or three: a mixture is what there is to
  // watch, and three of them is the grey they make between them.
  const roll = rng();
  const parts = roll < 0.35 ? 1 : roll < 0.86 ? 2 : 3;
  // And leaning rather than level. A mixture of equal parts is the dullest one
  // there is — equal parts of two paints from opposite sides of the wheel is
  // the grey between them, and equal parts of three always is — where a wash
  // with a little of something else in it is the colour a painter mixes.
  const leans = [1, 0.2 + rng() * 0.7, 0.12 + rng() * 0.45];
  let total = 0;

  for (let part = 0; part < parts; part += 1) {
    const share = leans[part]!;

    recipe[order[part]!] = share;
    total += share;
  }

  for (let d = 0; d < recipe.length; d += 1) {
    recipe[d] = recipe[d]! / total;
  }

  return recipe;
}

export interface InkUpdate {
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
 * Advances the paint in place.
 *
 * Stam's order — forces in, make the field divergence-free, carry the field
 * along itself, make it divergence-free again — and only then carry what is in
 * it. Projecting after the advection as well as before is what keeps a swirl
 * from slowly collapsing into its own middle.
 *
 * The paints are carried last and separately, each with its own settling added
 * to the water's velocity, which is where the mixture comes apart.
 */
export function updateInk(ink: Ink, { dt, thickness, swirl, angle }: InkUpdate): void {
  if (dt <= 0) {
    return;
  }

  ink.due += dt;

  if (ink.due < 1 / RATE) {
    return;
  }

  const step = Math.min(ink.due, 1 / 20);

  ink.due = 0;
  ink.elapsed += step;

  // The thin end of the slider is water rather than vacuum. See {@link THINNEST}.
  const firm = Math.max(THINNEST, thickness);

  sink(ink, step, firm, angle);
  breatheFlow(ink, {
    draught: ink.draught,
    elapsed: ink.elapsed,
    step,
    strength: BREEZE,
    grain: BREEZE_GRAIN,
    tempo: BREEZE_TEMPO,
  });
  driveFlow(ink, { step, thickness: firm, swirl });
  // No vorticity confinement, which is the one thing smoke has that this does
  // not, and it was a picture that decided it rather than an argument. Smoke
  // needs it — a fluid that only ever averages loses its smallest swirls, and
  // without them smoke is coloured blur. A wash does not: its structure is the
  // shape of the ribbon and the rim along its edge, and the correction below
  // keeps both. What confinement does to a wash instead is what it has always
  // threatened to do (see `lib/smoke.ts`) — it pushes each cell towards where
  // the turning is strongest nearby, and on a broad soft edge that direction is
  // decided by the grid. Every plume grew a row of horizontal teeth down its
  // side, plain in a screenshot at any strength that did anything at all, and
  // gone entirely at none.
  projectFlow(ink);
  carryFlow(ink, step);
  projectFlow(ink);

  // How fast a paint of unit weight slides through this fluid, and which way
  // down is. A thicker fluid holds everything up, in proportion.
  const settle = SETTLE / thicken(firm);
  const downX = Math.sin(angle);
  const downY = Math.cos(angle);

  for (let d = 0; d < PAINTS; d += 1) {
    const from = ink.paint[d]!;
    const into = ink.paint0[d]!;
    // Each paint goes where the water goes and a little further down, at its
    // own rate. This is where a mixture comes apart. See {@link SETTLE}.
    const falls = settle * ink.palette.paints[d]!.weight;

    carryScalar(ink, from, into, {
      step,
      correct: CORRECT,
      driftX: downX * falls,
      driftY: downY * falls,
      // Faster where the pigment has clumped, which is Stokes' law — a
      // settling velocity goes as the square of the particle — and is also
      // what keeps the trace off the grid. See `advectField` in `lib/flow.ts`.
      driftBy: ink.flocs.settling,
      high: HOLD,
    });
    // The cell is sealed: what the trace loses to its own crowding is still in
    // there. See `conserveScalar` in `lib/flow.ts`.
    conserveScalar(ink, from, into, HOLD);
    ink.paint[d] = into;
    ink.paint0[d] = from;
  }

  // A clump is a thing in the water, so it is carried like everything else in
  // here — and then a little fresh clumping is folded in, because flocs gather
  // and come apart again rather than being a pattern the cell was printed with.
  carryScalar(ink, ink.flocs.where, ink.flocs.where0, { step, correct: CORRECT });
  ink.flocs.where.set(ink.flocs.where0);
  stirFlocs(ink.flocs, ink.elapsed, step);
}

/**
 * The suspension's own weight, through the fluid that carries it.
 *
 * The only thing pushing on a cell nobody is turning, apart from the breeze:
 * a loaded patch of water is heavier than a clear one, so it sinks and what it
 * displaces comes up around it. There is no warmth here as there is in smoke —
 * paint has no reason to rise, and a wash that rose would not read as paint.
 */
function sink(ink: Ink, step: number, thickness: number, angle: number): void {
  const { u, v, inside } = ink;
  const drop = (GRAVITY * LOAD * step) / thicken(thickness);
  const downX = Math.sin(angle);
  const downY = Math.cos(angle);
  let carried = 0;
  let cells = 0;

  for (let k = 0; k < GRID * GRID; k += 1) {
    if (!inside[k]) {
      continue;
    }

    cells += 1;

    for (let d = 0; d < PAINTS; d += 1) {
      // Capped, because sediment is where the load piles deepest and the push
      // is a feedback loop: heavy water sinks, sinking water crowds, crowded
      // water is heavier. Uncapped and in a thin fluid — which has almost no
      // drag to spend the energy on — a cell of paint went to infinity in
      // under a minute. Water saturated with pigment is not much denser for
      // holding more of it.
      loads[k] = Math.min(SOAKED, (d === 0 ? 0 : loads[k]!) + ink.paint[d]![k]!);
    }

    carried += loads[k]!;
  }

  // Against the cell's own average rather than against nothing, which is the
  // Boussinesq way of putting it and is the difference between a plume and a
  // waterfall. Water is only heavy *compared with the water beside it*; take
  // the average out and what is left is the overturning — the loaded patch
  // sinking and the clearer water coming up around it. Left in, every cell
  // holding paint was pushed down at once and the whole body of it slid to the
  // bottom of the glass in ten seconds, which is a thing paint does in a jar
  // over an afternoon and not a thing to watch.
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

/** How much paint each cell's water is carrying, for its weight. */
const loads = new Float32Array(GRID * GRID);

/** How much a thickness setting holds a falling thing up. */
function thicken(thickness: number): number {
  return 1 + THICKEST * Math.min(1, Math.max(0, thickness));
}

/**
 * Paints the cell onto a small canvas, one pixel per cell.
 *
 * Subtractive, like the smoke's and for the same reason: the paint does not add
 * colour to a lit cell, it decides what gets through it. The canvas is white
 * where the cell is clear and it is drawn with `multiply`, which is also what
 * makes the chamber's white ground the paper the Kubelka-Munk layer sits over.
 *
 * @param strength How strong the paint is. See {@link STRENGTH}.
 * @returns The canvas, or null where there is no canvas to be had.
 */
export function paintInk(ink: Ink, strength = STRENGTH): HTMLCanvasElement | null {
  const surface = paintSurface();

  if (!surface || strength <= 0) {
    return null;
  }

  const { canvas, ctx, image } = surface;

  paintPigment(ink.palette, ink.paint, ink.flocs, strength, image.data);
  ctx.putImageData(image, 0, 0);

  return canvas;
}

/** The one surface the paint is drawn on, built once. */
let surface: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; image: ImageData } | null =
  null;
let surfaceTried = false;

function paintSurface() {
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
