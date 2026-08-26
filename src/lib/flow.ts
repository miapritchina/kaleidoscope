import { CHAMBER_RADIUS } from './chamber';

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

/** Speed lost per second in a thin fluid, before Thickness is taken into account. */
const VISCOSITY = 0.22;

/** How much more the far end of the Thickness slider takes out. */
const THICKEST = 6;

/** How fast the wall drags the whole body of fluid round with it, per second. */
const WALL_GRIP = 2.4;

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
}

/**
 * Advances a fluid that carries nothing of its own: Stam's order, on the
 * banked clock. A substance with forces of its own — smoke's falling dye —
 * runs these stages itself so it can push between them; a substance that only
 * rides — glitter, a film — hands the whole step here.
 */
export function stepFlow(flow: Flow, { dt, thickness, swirl, confine = 0 }: FlowStep): void {
  if (dt <= 0) {
    return;
  }

  flow.due += dt;

  if (flow.due < 1 / RATE) {
    return;
  }

  const step = Math.min(flow.due, 1 / 20);

  flow.due = 0;

  driveFlow(flow, { step, thickness, swirl });

  if (confine > 0) {
    confineFlow(flow, step, confine);
  }

  projectFlow(flow);
  carryFlow(flow, step);
  projectFlow(flow);
}

/**
 * Everything that pushes on the fluid from outside, this step.
 *
 * The wall drags the whole body of fluid round — which is what makes a
 * substance lag a turn and then outlive it — and a thicker fluid takes the
 * wall's turning up sooner and gives it back over longer. Queued stirs are
 * blended in here too: a finger in the cell is a moving wall of its own, so
 * it sets the fluid to its own velocity rather than adding to it, which is
 * why stirring faster does not pump the cell up without limit.
 *
 * Forces particular to a substance — a dye's weight, a film's nothing —
 * belong to the substance, applied to `u`/`v` directly before this runs.
 */
export function driveFlow(flow: Flow, { step, thickness, swirl }: FlowDrive): void {
  const { grid, u, v, inside } = flow;
  const thick = 1 + THICKEST * Math.min(1, Math.max(0, thickness));
  const wall = Math.min(1, WALL_GRIP * thick * step);
  const slow = Math.max(0, 1 - VISCOSITY * thick * step);

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

      u[k] = (u[k]! + (-swirl * y - u[k]!) * wall) * slow;
      v[k] = (v[k]! + (swirl * x - v[k]!) * wall) * slow;
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

      curl[k] =
        (neighbour(v, inside, grid, v[k]!, i + 1, j) -
          neighbour(v, inside, grid, v[k]!, i - 1, j) -
          neighbour(u, inside, grid, u[k]!, i, j + 1) +
          neighbour(u, inside, grid, u[k]!, i, j - 1)) /
        (2 * width);
      size[k] = Math.abs(curl[k]);
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
 */
export function advectField(
  flow: Flow,
  from: Float32Array,
  into: Float32Array,
  step: number,
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

      // Half a step back, on the velocity here...
      const midX = Math.min(grid - 1.001, Math.max(0, i - u[k]! * rate * 0.5));
      const midY = Math.min(grid - 1.001, Math.max(0, j - v[k]! * rate * 0.5));
      // ...then the whole step, on the velocity there.
      const uMid = bilinear(u, grid, midX, midY);
      const vMid = bilinear(v, grid, midX, midY);
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
          neighbour(u, inside, grid, u[k]!, i + 1, j) -
          neighbour(u, inside, grid, u[k]!, i - 1, j) +
          neighbour(v, inside, grid, v[k]!, i, j + 1) -
          neighbour(v, inside, grid, v[k]!, i, j - 1)
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
