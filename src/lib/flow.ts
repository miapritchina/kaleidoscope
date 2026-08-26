import { CHAMBER_RADIUS } from './chamber';
import { type Noise } from './noise';

/**
 * The body of fluid in a liquid cell, as a velocity field on a grid.
 *
 * Extracted from `lib/smoke.ts`, where it grew up, because it was never really
 * about smoke: every substance the liquid cell holds is something carried by
 * the same fluid — dye rides it, flakes of glitter ride it, an oil film rides
 * it — and each of them separately reinventing "the fluid" as a rigid swirl
 * was the wrong physics three times over. This module is the fluid itself:
 * velocity, the wall that drags it round, the viscosity that slows it, the
 * projection that keeps it incompressible, and the stirring — the tube's and
 * the finger's. What is *in* the fluid stays each substance's own business.
 *
 * It is Stam's _Stable Fluids_ (SIGGRAPH 1999), with the vorticity
 * confinement of Fedkiw, Stam and Jensen (2001) available to whoever wants
 * their small swirls kept. The traps this code has already paid for — the
 * comb-teeth confinement chases without a blur, the checkerboard an unsharp
 * mask amplifies — are documented where they were found, in `lib/smoke.ts`
 * and ROADMAP.md.
 *
 * The grid spans the cell's bounding square, in the cell's own frame — so it
 * turns with the tube, and gravity arrives already rotated, exactly as it
 * does for everything else in the chamber.
 */

/** A push the finger has asked for, waiting for the next step. */
export interface Stir {
  /** Where, in cell units. */
  x: number;
  y: number;
  /** The velocity to blend in, in cell units per second. */
  vx: number;
  vy: number;
  /** How far around the touch it reaches, in cell units. */
  reach: number;
}

export interface Flow {
  /** Cells across the chamber. */
  readonly grid: number;
  /** Velocity, one component per array, in cell units per second. */
  u: Float32Array;
  v: Float32Array;
  /** Somewhere to trace into while the old field is still being read. */
  u0: Float32Array;
  v0: Float32Array;
  /** Scratch for the pressure solve. */
  pressure: Float32Array;
  divergence: Float32Array;
  /** Scratch for the confinement's blurred curl. */
  smoothed: Float32Array;
  /** Whether each cell is within the round wall. */
  inside: Uint8Array;
  /** Pushes queued by the finger, taken up by the next {@link driveFlow}. */
  stirs: Stir[];
  /** Seconds banked since the last step. See {@link RATE}. */
  due: number;
}

/**
 * Steps of the fluid per second.
 *
 * Half the frame rate on a phone, and it costs nothing to look at: nothing a
 * cell holds has fast motion in it — everything moves at the speed of the
 * fluid carrying it, which is a fraction of a cell width a second. Time is
 * banked rather than dropped, so the fluid drifts at the same rate however
 * fast the frames arrive.
 */
export const RATE = 30;

/**
 * Passes of the pressure solve.
 *
 * Gauss-Seidel, and this is where the fluid's money goes. Sixteen is enough
 * that a swirl holds together and does not visibly leak through itself; the
 * error that remains reads as a slightly compressible fluid, which for
 * anything the cell holds is nothing anybody can see.
 */
const PASSES = 16;

/**
 * Speed lost per second in a thin fluid, before Thickness is taken into
 * account.
 *
 * A quarter of what it was, and what it stands for has changed with it. It
 * used to be nearly the whole of the fluid's dissipation — a drag pulling
 * every cell towards standing still — and between it and a wall grip applied
 * at full strength everywhere, the cell was not a fluid at all: an eddy left in
 * it lost a quarter of itself *per step*, so a stir was gone in a tenth of a
 * second and nothing the finger did ever survived long enough to be watched.
 * Measured on a single smooth swirl with nothing else pushing, the whole field
 * fell to a millionth of itself in three seconds.
 *
 * Dissipation is {@link RUB}'s business now, which is viscosity in the shape
 * viscosity actually has — a thing that passes momentum between neighbours,
 * kills the smallest swirls first and leaves the largest alone. What is left
 * here is the small honest loss to everything else the cell rubs against, and
 * it is what stops a thin cell coasting for ever.
 */
const VISCOSITY = 0.05;

/**
 * How much of the grid's own shortest wavelength one step takes out.
 *
 * The least viscosity a fluid can have and still be a fluid, and it is aimed
 * at exactly one thing. A five-point average is a filter whose effect depends
 * on the wavelength it is applied to: a swirl ten cells across has neighbours
 * that nearly agree with it and passes through untouched, while a
 * *checkerboard* — the shortest thing a grid can hold, where every cell
 * disagrees with all four of its neighbours — has an average of exactly the
 * opposite sign and is cut by `1 - 2·share` every step. So at this share a
 * checkerboard is halved in a fifth of a second and a swirl loses well under a
 * per cent a second.
 *
 * That is the mode the confinement runs away in. Vorticity confinement pushes
 * towards where the turning is strongest, and nothing turns harder per unit of
 * speed than a checkerboard, so the shortest wavelength is the one it feeds
 * fastest; the only thing against it is the viscosity, which at the thin end of
 * the Thickness slider is nearly nothing. Damping the grid's own wavelength
 * rather than turning the confinement down is what keeps the smoke's small
 * swirls — they are eight or ten cells across, and this cannot see them.
 */
const SMOOTH = 0.06;

/**
 * How fast a thick fluid passes momentum between neighbouring cells, per
 * second, on top of {@link SMOOTH}.
 *
 * Viscosity, done as viscosity: a cell is drawn towards the average of the
 * four around it, so what dies first is whatever varies fastest from cell to
 * cell and what survives longest is the broad turning of the whole cell. That
 * is the difference between a gel and a thin oil in one number — the gel loses
 * its small swirls almost at once and slumps as a body, the thin one holds
 * eddies long after the hand has come off the glass.
 *
 * Sharing more than half of a cell per step is unstable in the way any
 * explicit diffusion is, so the total share is held well below it.
 */
const RUB = 6;

/** The most of itself a cell may hand its neighbours in one step. */
const MOST_RUB = 0.3;

/** How much more the far end of the Thickness slider takes out. */
const THICKEST = 6;

/** How fast the wall drags the fluid at the wall round with it, per second. */
const WALL_GRIP = 3.4;

/**
 * How fast the body of the cell comes round to the tube's rate, per second.
 *
 * The wall turns and the fluid against it is dragged round at once; the middle
 * of a real cell is only reached through the fluid in between, which is
 * viscosity and takes minutes on a cell this size. Taken literally the middle
 * would never learn the tube had been turned at all, and a swipe has to move
 * the picture — so the body of the fluid is brought round directly as well.
 *
 * What it is applied to is the whole point, and it is the difference between
 * this and a turntable. It acts on **how fast the cell as a whole is going
 * round** — one number, the fluid's own angular rate, measured and nudged
 * towards the tube's — rather than on each cell's velocity. So a swirl, an
 * eddy, a wake left by a finger — anything that is a departure from the cell
 * turning as a body — is not touched by it at all, and lives exactly as long
 * as the viscosity lets it. Pointed at each cell instead, as it used to be, it
 * is a drag towards rigid rotation: every eddy in the cell is erased at this
 * rate, which at the old numbers was a quarter of it *per step*, and the
 * finger might as well not have been there.
 */
const BODY_GRIP = 1.4;

/**
 * How far in from the wall its full grip reaches, as a share of the radius.
 *
 * The boundary layer. Inside it the fluid is dragged round at the wall's own
 * rate, and it eases to {@link INNER_GRIP} over this distance.
 */
const WALL_LAYER = 0.36;

/**
 * The most turning the confinement is allowed to see, in radians per second.
 *
 * Vorticity confinement is a positive feedback and nothing in the method
 * bounds it: the push it adds goes as the curl, the curl goes as the speed, so
 * a cell gains speed in proportion to the speed it already has — an
 * exponential whose rate is the confinement strength. The only thing against it
 * is the viscosity, which is a race the confinement wins as soon as the fluid
 * is thin enough. Measured before this ceiling existed, a cell of smoke at
 * Thickness 0 held a median speed of **156 cell units a second after five
 * seconds**, 10^13 by ten, and nothing but NaN by thirty — the thin end of the
 * slider was not a thin fluid, it was a broken one. ROADMAP.md recorded it and
 * nobody had fixed it.
 *
 * Clamping what the confinement *reads* fixes it at the source and keeps the
 * method: below the ceiling it is the same correction it always was, and above
 * it the push stops growing, so the fluid reaches a speed and stays there. The
 * value is well over twice the fastest turning a healthy cell of smoke shows
 * left to itself (about 4.8 rad/s, measured), so nothing the eye was ever
 * shown is touched.
 *
 * It also takes out an artefact nobody had connected to it. The curl at the
 * cells against the round wall runs an order of magnitude above the body of the
 * fluid — 87 rad/s against 5 while the tube is turned — because the wall is a
 * velocity step and a difference of neighbours across a step is enormous. That
 * spike was the confinement's strongest push in the cell, pointed by the grid
 * rather than by any swirl, and it is where the comb teeth along the rim came
 * from.
 */
const CURL_CEILING = 12;

/**
 * The fastest the fluid may run anywhere, in cell units a second.
 *
 * A backstop and nothing else: {@link CURL_CEILING} is what actually keeps the
 * cell sane, and this is here so that no combination of a slider, a frame time
 * and a swipe can ever put a NaN on the screen. It is above anything the
 * instrument can ask for — the tube tops out at two turns a second, which
 * drags the wall itself round at about 14.5 — so it never binds on real motion.
 */
const FASTEST = 18;

/** Where a cell's middle is, in cell units. */
export function positionOf(grid: number, index: number): number {
  return -CHAMBER_RADIUS + ((index + 0.5) * 2 * CHAMBER_RADIUS) / grid;
}

/** Builds a still body of fluid, with the round wall marked out. */
export function createFlow(grid: number): Flow {
  const cells = grid * grid;
  const flow: Flow = {
    grid,
    u: new Float32Array(cells),
    v: new Float32Array(cells),
    u0: new Float32Array(cells),
    v0: new Float32Array(cells),
    pressure: new Float32Array(cells),
    divergence: new Float32Array(cells),
    smoothed: new Float32Array(cells),
    inside: new Uint8Array(cells),
    stirs: [],
    due: 0,
  };

  for (let j = 0; j < grid; j += 1) {
    for (let i = 0; i < grid; i += 1) {
      flow.inside[i + j * grid] =
        Math.hypot(positionOf(grid, i), positionOf(grid, j)) <= CHAMBER_RADIUS ? 1 : 0;
    }
  }

  return flow;
}

/**
 * Asks the fluid for a push, delivered at its next step.
 *
 * Queued rather than written straight into the field, because the field is
 * stepped on its own clock — a substance banks time and steps at a fixed rate
 * — and a push landed between two steps would be advected by neither.
 */
export function stirFlow(flow: Flow, stir: Stir): void {
  flow.stirs.push(stir);
}

export interface FlowDrive {
  /** Seconds this step advances. */
  step: number;
  /** How thick the fluid is, 0 thin to 1 gel. */
  thickness: number;
  /** How fast the fluid is turning within the cell, radians per second. */
  swirl: number;
}

export interface FlowStep {
  /** Seconds to advance. Banked until a step is due. */
  dt: number;
  /** How thick the fluid is, 0 thin to 1 gel. */
  thickness: number;
  /** How fast the fluid is turning within the cell, radians per second. */
  swirl: number;
  /** Confinement strength, for a substance whose small swirls are the look. */
  confine?: number;
  /**
   * The idle breeze, for a cell that has to stay alive with nothing in it that
   * pushes.
   *
   * Smoke has the weight of its own dye and the film has the weight of its own
   * oil; a cell of glitter has neither — foil rides the fluid and does nothing
   * to it — so without this a cell nobody is turning comes to rest and stays
   * there. What the breeze is and why its curl cannot fight the pressure solve
   * is in {@link breatheFlow}; the strength, grain and tempo stay the
   * substance's own.
   */
  breeze?: Omit<Breath, 'step'>;
}

/**
 * Advances a fluid that carries nothing of its own: Stam's order, on the
 * banked clock. A substance with forces of its own — smoke's falling dye —
 * runs these stages itself so it can push between them; a substance that only
 * rides — glitter, a film — hands the whole step here.
 */
export function stepFlow(
  flow: Flow,
  { dt, thickness, swirl, confine = 0, breeze }: FlowStep,
): void {
  if (dt <= 0) {
    return;
  }

  flow.due += dt;

  if (flow.due < 1 / RATE) {
    return;
  }

  const step = Math.min(flow.due, 1 / 20);

  flow.due = 0;

  if (breeze) {
    breatheFlow(flow, { ...breeze, step });
  }

  driveFlow(flow, { step, thickness, swirl });

  if (confine > 0) {
    confineFlow(flow, step, confine);
  }

  projectFlow(flow);
  carryFlow(flow, step);
  projectFlow(flow);
  capFlow(flow);
}

/**
 * Holds every cell to {@link FASTEST}, and takes any NaN out of the field.
 *
 * The last thing a step does, whoever is running the stages. See
 * {@link FASTEST}: the confinement's ceiling is what keeps a cell sane, and
 * this is the guarantee underneath it — whatever else goes wrong, the fluid
 * hands the substance riding it a number.
 */
export function capFlow(flow: Flow): void {
  const { u, v, inside } = flow;
  const cells = u.length;

  for (let k = 0; k < cells; k += 1) {
    if (!inside[k]) {
      u[k] = 0;
      v[k] = 0;
      continue;
    }

    const x = u[k]!;
    const y = v[k]!;

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      u[k] = 0;
      v[k] = 0;
      continue;
    }

    const speed = Math.hypot(x, y);

    if (speed > FASTEST) {
      u[k] = (x / speed) * FASTEST;
      v[k] = (y / speed) * FASTEST;
    }
  }
}

/**
 * Everything that pushes on the fluid from outside, this step.
 *
 * The wall drags the fluid *against it* round — hard, and easing off inwards,
 * so the cell shears rather than turning as one disc (see {@link WALL_LAYER}
 * and {@link INNER_GRIP}) — the viscosity passes what is moving on to the
 * neighbours it is moving past ({@link RUB}), and what is left of the drag
 * stands for everything else the fluid rubs against.
 *
 * Queued stirs are blended in here too: a finger in the cell is a moving wall
 * of its own, so it sets the fluid to its own velocity rather than adding to
 * it, which is why stirring faster does not pump the cell up without limit.
 *
 * Forces particular to a substance — a dye's weight, a film's nothing —
 * belong to the substance, applied to `u`/`v` directly before this runs.
 */
export function driveFlow(flow: Flow, { step, thickness, swirl }: FlowDrive): void {
  const { grid, u, v, inside } = flow;
  const much = Math.min(1, Math.max(0, thickness));
  const thick = 1 + THICKEST * much;
  const wall = Math.min(1, WALL_GRIP * thick * step);
  const slow = Math.max(0, 1 - VISCOSITY * thick * step);

  // Viscosity, and under it the floor that keeps the grid's own shortest
  // wavelength from growing on its own. See RUB and SMOOTH.
  relaxFlow(flow, Math.min(MOST_RUB, SMOOTH + RUB * much * step));

  // How fast the cell is going round as a body, so the tube can bring that one
  // number along without touching anything else in the field. See BODY_GRIP.
  let moment = 0;
  let spread = 0;

  for (let j = 0; j < grid; j += 1) {
    for (let i = 0; i < grid; i += 1) {
      const k = i + j * grid;

      if (!inside[k]) {
        continue;
      }

      const x = positionOf(grid, i);
      const y = positionOf(grid, j);

      moment += x * v[k]! - y * u[k]!;
      spread += x * x + y * y;
    }
  }

  const going = spread > 0 ? moment / spread : 0;
  const catchUp = (swirl - going) * Math.min(1, BODY_GRIP * thick * step);

  for (let j = 0; j < grid; j += 1) {
    for (let i = 0; i < grid; i += 1) {
      const k = i + j * grid;

      if (!inside[k]) {
        u[k] = 0;
        v[k] = 0;
        continue;
      }

      const x = positionOf(grid, i);
      const y = positionOf(grid, j);
      // The boundary layer: the fluid against the glass is dragged to the
      // wall's own speed, and the grip eases off over WALL_LAYER inwards.
      const away = Math.hypot(x, y) / CHAMBER_RADIUS;
      const into = Math.min(1, Math.max(0, (1 - away) / WALL_LAYER));
      const grip = wall * (1 - into * into * (3 - 2 * into));

      // Three things, in the order they belong: the wall's own drag on what is
      // against it, the whole cell coming round with the tube, and the small
      // loss to everything else.
      u[k] = (u[k]! + (-swirl * y - u[k]!) * grip - y * catchUp) * slow;
      v[k] = (v[k]! + (swirl * x - v[k]!) * grip + x * catchUp) * slow;
    }
  }

  for (const stir of flow.stirs) {
    const span = Math.max(1e-6, stir.reach * stir.reach);
    const from = Math.max(
      0,
      Math.floor(((stir.x - stir.reach + CHAMBER_RADIUS) * grid) / (2 * CHAMBER_RADIUS)),
    );
    const to = Math.min(
      grid - 1,
      Math.ceil(((stir.x + stir.reach + CHAMBER_RADIUS) * grid) / (2 * CHAMBER_RADIUS)),
    );
    const start = Math.max(
      0,
      Math.floor(((stir.y - stir.reach + CHAMBER_RADIUS) * grid) / (2 * CHAMBER_RADIUS)),
    );
    const end = Math.min(
      grid - 1,
      Math.ceil(((stir.y + stir.reach + CHAMBER_RADIUS) * grid) / (2 * CHAMBER_RADIUS)),
    );

    for (let j = start; j <= end; j += 1) {
      const dy = positionOf(grid, j) - stir.y;

      for (let i = from; i <= to; i += 1) {
        const k = i + j * grid;

        if (!inside[k]) {
          continue;
        }

        const dx = positionOf(grid, i) - stir.x;
        const away = (dx * dx + dy * dy) / span;

        if (away >= 1) {
          continue;
        }

        const much = (1 - away) * (1 - away);

        u[k] = u[k]! + (stir.vx - u[k]!) * much;
        v[k] = v[k]! + (stir.vy - v[k]!) * much;
      }
    }
  }

  flow.stirs.length = 0;
}

/**
 * Blends every cell a little way towards its four neighbours.
 *
 * Viscosity — see {@link RUB} — and under it the floor that keeps the grid's
 * own shortest wavelength from growing on its own, see {@link SMOOTH}. It is a
 * filter that can tell a swirl from the grid, which is what lets one number be
 * both. Read from a copy so the blend is
 * simultaneous: taken in place, a pass over the array carries the cells it has
 * already changed into the ones it has not, which is a smear along the rows
 * rather than a blur.
 */
function relaxFlow(flow: Flow, share: number): void {
  const { grid, u, v, inside } = flow;
  const cells = grid * grid;

  if (share <= 0) {
    return;
  }

  if (wasU.length !== cells) {
    wasU = new Float32Array(cells);
    wasV = new Float32Array(cells);
  }

  if (deep.length !== cells) {
    markDeep(flow);
  }

  wasU.set(u);
  wasV.set(v);

  const quarter = share / 4;

  for (let j = 0; j < grid; j += 1) {
    for (let i = 0; i < grid; i += 1) {
      const k = i + j * grid;

      if (!inside[k]) {
        continue;
      }

      const hereU = wasU[k]!;
      const hereV = wasV[k]!;

      // A cell with all four neighbours in the fluid — nine in ten of them —
      // reads them straight out of the array. The rest go through the wall,
      // which hands back what the asking cell holds, so a neighbour outside
      // contributes nothing to the difference.
      if (deep[k]) {
        u[k] =
          hereU +
          (wasU[k - 1]! + wasU[k + 1]! + wasU[k - grid]! + wasU[k + grid]! - 4 * hereU) * quarter;
        v[k] =
          hereV +
          (wasV[k - 1]! + wasV[k + 1]! + wasV[k - grid]! + wasV[k + grid]! - 4 * hereV) * quarter;
        continue;
      }

      const alongU =
        neighbour(wasU, inside, grid, hereU, i + 1, j) +
        neighbour(wasU, inside, grid, hereU, i - 1, j) +
        neighbour(wasU, inside, grid, hereU, i, j + 1) +
        neighbour(wasU, inside, grid, hereU, i, j - 1);
      const alongV =
        neighbour(wasV, inside, grid, hereV, i + 1, j) +
        neighbour(wasV, inside, grid, hereV, i - 1, j) +
        neighbour(wasV, inside, grid, hereV, i, j + 1) +
        neighbour(wasV, inside, grid, hereV, i, j - 1);

      u[k] = hereU + (alongU - 4 * hereU) * quarter;
      v[k] = hereV + (alongV - 4 * hereV) * quarter;
    }
  }
}

/**
 * Which cells have all four neighbours in the fluid.
 *
 * Built with the scratch, once per grid size. A note in ROADMAP.md records the
 * same idea measuring *slower* in the pressure solve, where it was a branch
 * added to a loop the engine was already inlining the check out of; here the
 * branch replaces four function calls rather than four array reads, which is a
 * different trade and comes out the other way.
 */
let deep = new Uint8Array(0);

/** Marks {@link deep} for a fluid's own wall. */
function markDeep(flow: Flow): void {
  const { grid, inside } = flow;

  deep = new Uint8Array(grid * grid);

  for (let j = 1; j < grid - 1; j += 1) {
    for (let i = 1; i < grid - 1; i += 1) {
      const k = i + j * grid;

      deep[k] =
        inside[k] && inside[k - 1] && inside[k + 1] && inside[k - grid] && inside[k + grid] ? 1 : 0;
    }
  }
}

/** Where the field is read from while it is being blended. See {@link relaxFlow}. */
let wasU = new Float32Array(0);
let wasV = new Float32Array(0);

/**
 * Puts the small swirls back. See `CONFINE` in `lib/smoke.ts` for the whole
 * story: semi-Lagrangian advection is stable because it averages, an average
 * takes the smallest swirls out first, and this measures the curl and pushes
 * it back — pointed at a *blurred* measure of where the turning is strongest,
 * because pointed at the raw one it chases single cells and combs the grid.
 */
export function confineFlow(flow: Flow, step: number, strength: number): void {
  const { grid, u, v, inside, pressure, divergence, smoothed } = flow;
  const width = (2 * CHAMBER_RADIUS) / grid;
  // Borrowed: the pressure solve has not run yet this step, so its two
  // scratch fields are free. `divergence` holds the curl and `pressure` its
  // size.
  const curl = divergence;
  const size = pressure;

  for (let j = 0; j < grid; j += 1) {
    for (let i = 0; i < grid; i += 1) {
      const k = i + j * grid;

      if (!inside[k]) {
        curl[k] = 0;
        size[k] = 0;
        continue;
      }

      const turning =
        (neighbour(v, inside, grid, v[k]!, i + 1, j) -
          neighbour(v, inside, grid, v[k]!, i - 1, j) -
          neighbour(u, inside, grid, u[k]!, i, j + 1) +
          neighbour(u, inside, grid, u[k]!, i, j - 1)) /
        (2 * width);

      // Clamped, which is what makes the confinement safe at every setting of
      // the Thickness slider and what keeps it off the wall's own step. See
      // CURL_CEILING.
      const held = Math.min(CURL_CEILING, Math.max(-CURL_CEILING, turning));

      curl[k] = held;
      size[k] = Math.abs(held);
    }
  }

  for (let j = 0; j < grid; j += 1) {
    for (let i = 0; i < grid; i += 1) {
      const k = i + j * grid;

      if (!inside[k]) {
        continue;
      }

      const here = size[k]!;

      smoothed[k] =
        (here +
          neighbour(size, inside, grid, here, i + 1, j) +
          neighbour(size, inside, grid, here, i - 1, j) +
          neighbour(size, inside, grid, here, i, j + 1) +
          neighbour(size, inside, grid, here, i, j - 1)) /
        5;
    }
  }

  const push = strength * step * width;

  for (let j = 0; j < grid; j += 1) {
    for (let i = 0; i < grid; i += 1) {
      const k = i + j * grid;

      if (!inside[k]) {
        continue;
      }

      const alongX =
        (neighbour(smoothed, inside, grid, smoothed[k]!, i + 1, j) -
          neighbour(smoothed, inside, grid, smoothed[k]!, i - 1, j)) /
        2;
      const alongY =
        (neighbour(smoothed, inside, grid, smoothed[k]!, i, j + 1) -
          neighbour(smoothed, inside, grid, smoothed[k]!, i, j - 1)) /
        2;
      const length = Math.hypot(alongX, alongY);

      if (length < 1e-6) {
        continue;
      }

      u[k] = u[k]! + (alongY / length) * curl[k]! * push;
      v[k] = v[k]! - (alongX / length) * curl[k]! * push;
    }
  }
}

/** Carries the velocity field along itself, swapping the scratch pair in. */
export function carryFlow(flow: Flow, step: number): void {
  advectField(flow, flow.u, flow.u0, step);
  advectField(flow, flow.v, flow.v0, step);

  const u = flow.u0;
  const v = flow.v0;

  flow.u0 = flow.u;
  flow.v0 = flow.v;
  flow.u = u;
  flow.v = v;
}

/**
 * Traces every cell backwards down the flow and reads what was there.
 *
 * Semi-Lagrangian: rather than asking where this cell's contents are going —
 * which can overshoot and blow up — it asks where this cell's contents came
 * from, which cannot, because whatever it lands on is a value the field
 * already held.
 *
 * The trace is second order — RK2, the midpoint method. A single Euler step
 * back reads the velocity only where the trace *starts*, so in a tight swirl
 * it walks a chord of the circle rather than the arc, and every step leaks
 * the field a little way out of every vortex. Stepping halfway back, reading
 * the velocity *there*, and tracing with that instead costs one extra
 * bilinear read per cell and takes most of that rotational drift out.
 *
 * `driftX`/`driftY` are a velocity of the carried thing's *own*, added to the
 * fluid's everywhere. Dye has none — it is dissolved, so it is wherever the
 * water is. A solid held in water does: it goes where the water goes and a
 * little further down, at a rate that depends on how heavy and how coarse it
 * is. Added to the velocity rather than applied afterwards, so the trace
 * follows the path the thing actually took and everything the trace already
 * does — the midpoint, the wall, the clamp — holds for it unchanged.
 *
 * `driftBy` scales that drift cell by cell, and it is not a refinement. A drift
 * that is the *same everywhere* moves every cell's trace by the same fraction
 * of a cell, every step, in the same direction — and a bilinear read of a sharp
 * edge shifted by a constant sub-cell amount, sharpened again by the
 * correction, staircases. It drew a row of horizontal teeth along the side of
 * every plume, exactly the grid-shaped artefact the confinement and the unsharp
 * mask each drew in their own way (see `lib/smoke.ts`). Varying the rate from
 * cell to cell breaks the lock, and there is a real thing to vary it by: a
 * settling velocity goes as the square of the particle, so where pigment has
 * flocculated it falls faster.
 */
export function advectField(
  flow: Flow,
  from: Float32Array,
  into: Float32Array,
  step: number,
  driftX = 0,
  driftY = 0,
  driftBy: Float32Array | null = null,
): void {
  const { grid, u, v, inside } = flow;
  // Cell widths travelled, rather than cell units.
  const rate = (step * grid) / (2 * CHAMBER_RADIUS);

  for (let j = 0; j < grid; j += 1) {
    for (let i = 0; i < grid; i += 1) {
      const k = i + j * grid;

      if (!inside[k]) {
        into[k] = 0;
        continue;
      }

      const much = driftBy ? driftBy[k]! : 1;
      const alongX = driftX * much;
      const alongY = driftY * much;
      // Half a step back, on the velocity here...
      const midX = Math.min(grid - 1.001, Math.max(0, i - (u[k]! + alongX) * rate * 0.5));
      const midY = Math.min(grid - 1.001, Math.max(0, j - (v[k]! + alongY) * rate * 0.5));
      // ...then the whole step, on the velocity there.
      const uMid = bilinear(u, grid, midX, midY) + alongX;
      const vMid = bilinear(v, grid, midX, midY) + alongY;
      const backX = Math.min(grid - 1.001, Math.max(0, i - uMid * rate));
      const backY = Math.min(grid - 1.001, Math.max(0, j - vMid * rate));
      const i0 = Math.floor(backX);
      const j0 = Math.floor(backY);
      const fx = backX - i0;
      const fy = backY - j0;
      const i1 = Math.min(grid - 1, i0 + 1);
      const j1 = Math.min(grid - 1, j0 + 1);

      into[k] =
        (1 - fx) *
          ((1 - fy) * sample(from, inside, grid, from[k]!, i0, j0) +
            fy * sample(from, inside, grid, from[k]!, i0, j1)) +
        fx *
          ((1 - fy) * sample(from, inside, grid, from[k]!, i1, j0) +
            fy * sample(from, inside, grid, from[k]!, i1, j1));
    }
  }
}

/**
 * Takes the divergence out of the velocity field.
 *
 * A fluid that is neither piling up nor thinning out anywhere is what makes
 * the difference between a substance swirling and a substance simply fading:
 * without this the field has sources and sinks all over it, and whatever is
 * carried drains into them. Solved as a Poisson equation for the pressure
 * whose gradient cancels the divergence, by Gauss-Seidel; the wall is a
 * zero-gradient boundary, which is another way of saying nothing flows
 * through it.
 */
export function projectFlow(flow: Flow): void {
  const { grid, u, v, inside, pressure, divergence } = flow;
  const width = (2 * CHAMBER_RADIUS) / grid;

  for (let j = 0; j < grid; j += 1) {
    for (let i = 0; i < grid; i += 1) {
      const k = i + j * grid;

      pressure[k] = 0;

      if (!inside[k]) {
        divergence[k] = 0;
        continue;
      }

      divergence[k] =
        -(
          shut(u, inside, grid, u[k]!, i + 1, j) -
          shut(u, inside, grid, u[k]!, i - 1, j) +
          shut(v, inside, grid, v[k]!, i, j + 1) -
          shut(v, inside, grid, v[k]!, i, j - 1)
        ) /
        (2 * width);
    }
  }

  const area = width * width;

  for (let pass = 0; pass < PASSES; pass += 1) {
    for (let j = 0; j < grid; j += 1) {
      for (let i = 0; i < grid; i += 1) {
        const k = i + j * grid;

        if (!inside[k]) {
          continue;
        }

        pressure[k] =
          (divergence[k]! * area +
            neighbour(pressure, inside, grid, pressure[k]!, i + 1, j) +
            neighbour(pressure, inside, grid, pressure[k]!, i - 1, j) +
            neighbour(pressure, inside, grid, pressure[k]!, i, j + 1) +
            neighbour(pressure, inside, grid, pressure[k]!, i, j - 1)) /
          4;
      }
    }
  }

  for (let j = 0; j < grid; j += 1) {
    for (let i = 0; i < grid; i += 1) {
      const k = i + j * grid;

      if (!inside[k]) {
        continue;
      }

      u[k]! -=
        (0.5 *
          (neighbour(pressure, inside, grid, pressure[k]!, i + 1, j) -
            neighbour(pressure, inside, grid, pressure[k]!, i - 1, j))) /
        width;
      v[k]! -=
        (0.5 *
          (neighbour(pressure, inside, grid, pressure[k]!, i, j + 1) -
            neighbour(pressure, inside, grid, pressure[k]!, i, j - 1))) /
        width;
    }
  }
}

/**
 * Carries a scalar along the fluid, and takes the trace's own blurring back off.
 *
 * Moved here from `lib/smoke.ts`, where it was written for the dye, because it
 * is the fluid's business rather than any one substance's: anything painted on
 * a grid and carried by a flow wants the same treatment, and the second
 * substance to want it — the paint in `lib/ink.ts` — wanted it identically.
 *
 * Three passes. Back down the flow, which is the plain trace and is where the
 * blur comes from; forward again from there, which lands somewhere near where
 * it started and misses by however much the first pass smeared; and then the
 * first result with half that miss corrected out of it. MacCormack.
 *
 * The clamp at the end is what makes it safe. A correction can overshoot, and
 * an overshoot is a value that was never in the field — which is a new extreme,
 * and new extremes on a grid are what turn into grid-shaped noise. So the
 * corrected value is held inside the range the plain trace already found
 * nearby: it may sharpen what is there, and it may not invent.
 *
 * `low`/`high` bound the field: dye and paint live in `[0, 1]`, and a field
 * that is a signed departure from even would say otherwise.
 */
export function carryScalar(
  flow: Flow,
  from: Float32Array,
  into: Float32Array,
  { step, correct, driftX = 0, driftY = 0, driftBy = null, low = 0, high = 1 }: CarryScalar,
): void {
  const { grid, inside } = flow;
  const cells = grid * grid;

  if (back.length !== cells) {
    back = new Float32Array(cells);
    forward = new Float32Array(cells);
  }

  advectField(flow, from, back, step, driftX, driftY, driftBy);
  advectField(flow, back, forward, -step, driftX, driftY, driftBy);

  for (let j = 0; j < grid; j += 1) {
    for (let i = 0; i < grid; i += 1) {
      const k = i + j * grid;

      if (!inside[k]) {
        into[k] = 0;
        continue;
      }

      const traced = back[k]!;
      const corrected = traced + ((from[k]! - forward[k]!) * correct) / 2;
      let least = traced;
      let most = traced;

      for (const near of [
        neighbour(back, inside, grid, traced, i + 1, j),
        neighbour(back, inside, grid, traced, i - 1, j),
        neighbour(back, inside, grid, traced, i, j + 1),
        neighbour(back, inside, grid, traced, i, j - 1),
      ]) {
        least = Math.min(least, near);
        most = Math.max(most, near);
      }

      into[k] = Math.min(high, Math.max(low, Math.min(most, Math.max(least, corrected))));
    }
  }
}

export interface CarryScalar {
  /** Seconds this step advances. */
  step: number;
  /** How much of the trace's own error is corrected, 0 to 1. */
  correct: number;
  /** The carried thing's own velocity through the fluid, in cell units a second. */
  driftX?: number;
  driftY?: number;
  /** That drift, scaled cell by cell. See {@link advectField}. */
  driftBy?: Float32Array | null;
  /** The range the field lives in. */
  low?: number;
  high?: number;
}

/** Where the two halves of the correction are worked out. See {@link carryScalar}. */
let back = new Float32Array(0);
let forward = new Float32Array(0);

/**
 * Puts back whatever the trace lost, in proportion.
 *
 * A liquid cell is sealed. There is no drain in it, nothing evaporates out of
 * the top and the glass does not absorb, so however much of a thing was put in
 * is how much is in there for as long as anyone watches. Tracing backwards does
 * not know that. It reads what was upstream, and it cannot read *more* than was
 * upstream — so wherever the flow crowds two cells' worth into one it keeps the
 * larger and drops the difference. Anything falling through a fluid crowds
 * constantly, because that is what falling through a fluid is, and anything
 * settling against the wall crowds hardest of all.
 *
 * Measured on a cell of paint left to itself, with nobody turning it: it held
 * **nothing at all** after two minutes. Not settled at the bottom — gone. The
 * pigment fell, gathered against the wall, and was quietly deleted a fraction
 * of a per cent at a time. It went unnoticed for as long as it did because a
 * cell that is emptying and a cell that is spreading out look the same from one
 * minute to the next.
 *
 * The honest repair is a fluid solver that does not compress — a staggered grid
 * rather than this one, where the pressure and the velocity are read at the
 * same points and the shortest wavelength therefore goes unseen. That is a
 * rewrite of the solver to fix something nobody can see directly. This is the
 * other half of the same statement and it is one multiply a cell: the total is
 * what it was, so whatever the step lost is handed back to every cell in
 * proportion to what it already holds, and taken off the same way where the
 * correction's clamp has quietly added some. It moves nothing — the shape of
 * the picture is the trace's, exactly as before — it only refuses to let the
 * total wander.
 *
 * `most` is the ceiling a cell may hold. It has to be above whatever the field
 * was filled to, or the one place the loss actually happens — the crowd at the
 * bottom of the cell — is the one place that cannot take the colour back, and
 * conserving turns into a slow bleach of everywhere else instead.
 */
export function conserveScalar(flow: Flow, was: Float32Array, now: Float32Array, most = 1): void {
  const { grid, inside } = flow;
  const cells = grid * grid;
  let before = 0;
  let after = 0;

  for (let k = 0; k < cells; k += 1) {
    if (!inside[k]) {
      continue;
    }

    before += was[k]!;
    after += now[k]!;
  }

  if (after <= 1e-6 || before <= 1e-6) {
    return;
  }

  // Both ways. The trace loses under compression and the correction's clamp
  // quietly gains under stretch — a field left alone drifted to nearly twice
  // what was put in — and neither is a thing the cell did.
  const back = Math.min(1 + REPLACE, Math.max(1 - REPLACE, before / after));

  for (let k = 0; k < cells; k += 1) {
    if (inside[k]) {
      now[k] = Math.min(most, now[k]! * back);
    }
  }
}

/**
 * The most of itself one step may hand back or take off. See
 * {@link conserveScalar}.
 *
 * A ceiling rather than a rate. In ordinary drifting a step loses a fraction of
 * a per cent and this never binds; where it binds is the first seconds of a
 * cell, when dense clouds are falling fast and the crowding is at its worst.
 * What it stops is the one case where the ratio is meaningless — a field with
 * almost nothing left in it, where putting the whole total back would multiply
 * whatever noise is there by hundreds.
 */
const REPLACE = 0.25;

/**
 * The idle stirring: a whisper of divergence-free force from a wandering
 * noise potential, so a cell nobody is turning never quite comes to rest.
 *
 * Curl noise (Bridson, Hourihan and Nordenstam, SIGGRAPH 2007): take a smooth
 * potential, and push along its curl. The curl of anything smooth is
 * divergence-free by construction, so the push cannot fight the pressure solve
 * — it only ever stirs, never inflates. The potential is sampled on a coarse
 * lattice and interpolated, because a breeze is a large slow thing and
 * evaluating noise per fluid cell would spend milliseconds on what a
 * sixteen-by-sixteen grid already describes.
 *
 * Moved here from `lib/smoke.ts` when a second substance wanted one. Which
 * substance wants which breeze is still the substance's own business — the
 * strength, the grain and the tempo are all arguments.
 */
export function breatheFlow(
  flow: Flow,
  { draught, elapsed, step, strength, grain, tempo }: Breath,
): void {
  const { grid, u, v, inside } = flow;
  const t = elapsed * tempo;

  for (let cj = 0; cj < COARSE + 2; cj += 1) {
    for (let ci = 0; ci < COARSE + 2; ci += 1) {
      potential[ci + cj * (COARSE + 2)] = draught(
        ((ci - 0.5) / COARSE) * grain,
        ((cj - 0.5) / COARSE) * grain,
        t,
      );
    }
  }

  const push = strength * step;
  // Coarse cells per fluid cell.
  const scale = COARSE / grid;

  for (let j = 0; j < grid; j += 1) {
    for (let i = 0; i < grid; i += 1) {
      const k = i + j * grid;

      if (!inside[k]) {
        continue;
      }

      // The curl of the potential, read off the coarse lattice around this
      // cell: along y for the x push, along x (negated) for the y push.
      const ci = Math.min(COARSE, Math.max(1, Math.round(i * scale + 0.5)));
      const cj = Math.min(COARSE, Math.max(1, Math.round(j * scale + 0.5)));
      const at = ci + cj * (COARSE + 2);

      u[k] = u[k]! + (potential[at + COARSE + 2]! - potential[at - COARSE - 2]!) * push;
      v[k] = v[k]! - (potential[at + 1]! - potential[at - 1]!) * push;
    }
  }
}

export interface Breath {
  /** The cell's own smooth field, to take the curl of. */
  draught: Noise;
  /** Seconds the cell has been alive, for the wandering. */
  elapsed: number;
  /** Seconds this step advances. */
  step: number;
  /** How hard it pushes, in cell units per second per second. */
  strength: number;
  /** Noise cells across the chamber: the breeze's spatial grain. */
  grain: number;
  /** How fast it wanders, in noise cells per second of its own time. */
  tempo: number;
}

/** Lattice points across the breeze's coarse grid. */
const COARSE = 16;

/** Scratch for the breeze's coarse potential. One ring of padding all round. */
const potential = new Float32Array((COARSE + 2) * (COARSE + 2));

/** A plain bilinear read of one field, for the midpoint of the trace. */
function bilinear(field: Float32Array, grid: number, x: number, y: number): number {
  const i0 = Math.floor(x);
  const j0 = Math.floor(y);
  const fx = x - i0;
  const fy = y - j0;
  const i1 = Math.min(grid - 1, i0 + 1);
  const j1 = Math.min(grid - 1, j0 + 1);

  return (
    (1 - fx) * ((1 - fy) * field[i0 + j0 * grid]! + fy * field[i0 + j1 * grid]!) +
    fx * ((1 - fy) * field[i1 + j0 * grid]! + fy * field[i1 + j1 * grid]!)
  );
}

/**
 * A neighbour across the wall, for the component that runs into it.
 *
 * The difference between a wall and a hole, and it was a hole. Everywhere else
 * the wall hands back whatever the asking cell holds — see {@link neighbour} —
 * which is the right answer for a pressure and for anything carried, and the
 * wrong one for the velocity the divergence is measured from: a cell against
 * the wall whose neighbour agrees with it has *no* divergence, so the solve is
 * told nothing is flowing out and lets the fluid straight through the glass.
 *
 * The wall hands back the opposite instead, which is a mirror: the normal
 * component of the flow through the boundary is nought by construction, the
 * tangential component is untouched, and what the pressure solve sees is a
 * solid, free-slip wall.
 *
 * Measured, this is not a nicety. A cell of fluid at Thickness 0 with no dye
 * in it and the confinement switched off — nothing pushing on it at all — fell
 * to a thousandth of its opening swirl in three seconds and then **grew back
 * to the speed limit by ten**, out of nothing, because the staircase the round
 * wall makes on a square grid was feeding it. In a square box, with the same
 * code and no wall to speak of, the same field decayed to 10^-25. The round
 * cell was the whole of the fault, and the substances above it inherited it:
 * it is where the thin end of the Thickness slider went to NaN.
 */
function shut(
  field: Float32Array,
  inside: Uint8Array,
  grid: number,
  here: number,
  i: number,
  j: number,
): number {
  if (i < 0 || i >= grid || j < 0 || j >= grid) {
    return -here;
  }

  const k = i + j * grid;

  return inside[k] ? field[k]! : -here;
}

/** A neighbour, with the wall standing in for anything beyond it. */
export function neighbour(
  field: Float32Array,
  inside: Uint8Array,
  grid: number,
  here: number,
  i: number,
  j: number,
): number {
  if (i < 0 || i >= grid || j < 0 || j >= grid) {
    return here;
  }

  const k = i + j * grid;

  return inside[k] ? field[k]! : here;
}

/**
 * One corner of the bilinear read.
 *
 * A cell outside the wall holds nothing, and reading its nought would suck
 * whatever is carried out of everything that drifts near the rim. So the wall
 * hands back what the asking cell already had, which is what a wall the fluid
 * cannot cross looks like from the inside.
 */
export function sample(
  field: Float32Array,
  inside: Uint8Array,
  grid: number,
  here: number,
  i: number,
  j: number,
): number {
  const k = i + j * grid;

  return inside[k] ? field[k]! : here;
}

/** The fluid's velocity at a point, bilinearly, in cell units per second. */
export function velocityAt(flow: Flow, x: number, y: number, into: { x: number; y: number }): void {
  const { grid, u, v } = flow;
  const gx = Math.min(
    grid - 1.001,
    Math.max(0, ((x + CHAMBER_RADIUS) * grid) / (2 * CHAMBER_RADIUS) - 0.5),
  );
  const gy = Math.min(
    grid - 1.001,
    Math.max(0, ((y + CHAMBER_RADIUS) * grid) / (2 * CHAMBER_RADIUS) - 0.5),
  );
  const i0 = Math.floor(gx);
  const j0 = Math.floor(gy);
  const fx = gx - i0;
  const fy = gy - j0;
  const i1 = Math.min(grid - 1, i0 + 1);
  const j1 = Math.min(grid - 1, j0 + 1);
  const a = i0 + j0 * grid;
  const b = i1 + j0 * grid;
  const c = i0 + j1 * grid;
  const d = i1 + j1 * grid;

  into.x = (1 - fx) * ((1 - fy) * u[a]! + fy * u[c]!) + fx * ((1 - fy) * u[b]! + fy * u[d]!);
  into.y = (1 - fx) * ((1 - fy) * v[a]! + fy * v[c]!) + fx * ((1 - fy) * v[b]! + fy * v[d]!);
}

/**
 * How fast the fluid is turning at a point, in radians per second.
 *
 * The curl, read off the nearest cell — a flake asking how it should tumble
 * does not need it bilinearly, and the curl is already a difference of
 * neighbours.
 */
export function curlAt(flow: Flow, x: number, y: number): number {
  const { grid, u, v, inside } = flow;
  const i = Math.min(
    grid - 1,
    Math.max(0, Math.round(((x + CHAMBER_RADIUS) * grid) / (2 * CHAMBER_RADIUS) - 0.5)),
  );
  const j = Math.min(
    grid - 1,
    Math.max(0, Math.round(((y + CHAMBER_RADIUS) * grid) / (2 * CHAMBER_RADIUS) - 0.5)),
  );
  const k = i + j * grid;

  if (!inside[k]) {
    return 0;
  }

  const width = (2 * CHAMBER_RADIUS) / grid;

  return (
    (neighbour(v, inside, grid, v[k]!, i + 1, j) -
      neighbour(v, inside, grid, v[k]!, i - 1, j) -
      neighbour(u, inside, grid, u[k]!, i, j + 1) +
      neighbour(u, inside, grid, u[k]!, i, j - 1)) /
    (2 * width)
  );
}
