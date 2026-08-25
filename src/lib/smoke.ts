import { CHAMBER_RADIUS } from './chamber';
import { mulberry32 } from './random';

/**
 * A cell of smoke.
 *
 * The whole content, not a tint over something else: what is in the chamber is
 * moving fluid and the colour carried in it, and the mirrors repeat that. One
 * of the three things this instrument's object cell can hold instead of loose
 * pieces — see `lib/lava.ts` and `lib/glitter.ts` for the others.
 *
 * Where lava and glitter are things *in* a fluid, this is the fluid: a grid
 * holding a velocity field and the dye carried on it. It is Stam's _Stable
 * Fluids_ (SIGGRAPH 1999) — advect the velocity by tracing it backwards, make
 * it divergence-free, then carry the dye along on the result. Semi-Lagrangian
 * advection is unconditionally stable, which is what makes it safe to run
 * against whatever frame time a phone hands over.
 *
 * The roadmap put this on the GPU, and per pixel it belongs there. At the size
 * an object cell actually needs it does not have to be: {@link GRID} squared is
 * four thousand cells, and stepped at {@link RATE} it costs well under a
 * millisecond of the frame. What that buys is that the smoke lives with the
 * rest of the chamber rather than in the compositor, so it is painted into the
 * source triangle and folded by the mirrors along with everything else — six
 * reflections of the same ribbon, exactly as a real one would give.
 *
 * Nothing outside stirs it. The tube's own turning drags the body of fluid
 * round, and the dye is a little heavier than the air it hangs in, so it falls
 * through itself and the falling is what curls it: a heavy patch sinks, the
 * fluid it displaces comes up around it, and that is a plume. Left alone the
 * cell keeps folding over on itself for as long as anyone watches.
 *
 * Three dyes rather than one, and subtractive: each takes its own primary out
 * of the light, the way real dye in a lit cell does, so where two of them fold
 * together the colour is the mixture and not the brighter of the pair.
 *
 * One thing was tried here and did not pay. The wall is a circle on a square
 * grid, so nine cells in ten have all four neighbours inside it and could read
 * them straight out of the array rather than asking about each one; marking
 * those cells and giving the pressure solve and the advection a path of their
 * own for them measured **0.862 ms against 0.899** — four per cent, for a field
 * to build and keep and three more branches in the hottest loops in the
 * chamber. The engine was already inlining the check. It was taken out again.
 *
 * The grid spans the cell's bounding square, in the cell's own frame — so it
 * turns with the tube, and gravity sweeps around it exactly as it does for
 * everything else in the chamber.
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
 * Passes of the pressure solve.
 *
 * Gauss-Seidel, and this is where the fluid's money goes. Sixteen is enough
 * that a swirl holds together and does not visibly leak through itself; the
 * error that remains reads as a slightly compressible fluid, which for ink is
 * nothing anybody can see.
 */
const PASSES = 16;

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

/** Speed lost per second in a thin fluid, before Thickness is taken into account. */
const VISCOSITY = 0.22;

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
 * It has to be pointed at something smooth, though, and that is the whole of
 * the difficulty. Taken straight, "where the curl is strongest" is decided by
 * single cells, so every cell is pushed towards its own noisiest neighbour and
 * a fortnight of that draws a row of grid-aligned comb teeth along the edge of
 * every ribbon — which is what it did, plainly enough to see in a screenshot.
 * Smoothing the curl's size first, once, points it at the swirl instead of at
 * the grid.
 */
const CONFINE = 6;

/** How much more the far end of the Thickness slider takes out. */
const THICKEST = 6;

/** How fast the wall drags the whole body of fluid round with it, per second. */
const WALL_GRIP = 2.4;

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

export interface Smoke {
  /** Velocity, one component per array, in cell units per second. */
  u: Float32Array;
  v: Float32Array;
  /** Somewhere to trace into while the old field is still being read. */
  u0: Float32Array;
  v0: Float32Array;
  /** How much of each dye is in each cell, 0 to 1. */
  dye: Float32Array[];
  dye0: Float32Array[];
  /** Scratch for the pressure solve. */
  pressure: Float32Array;
  divergence: Float32Array;
  /** Seconds banked since the last step. See {@link RATE}. */
  due: number;
  /** Whether each cell is within the round wall. */
  inside: Uint8Array;
}

/** Where a cell's middle is, in cell units. */
function positionOf(index: number): number {
  return -CHAMBER_RADIUS + ((index + 0.5) * 2 * CHAMBER_RADIUS) / GRID;
}

/** Builds a cell of smoke, deterministically, in a few clouds of each dye. */
export function createSmoke(seed: number, amount = 1): Smoke {
  const cells = GRID * GRID;
  const rng = mulberry32(seed);
  const smoke: Smoke = {
    u: new Float32Array(cells),
    v: new Float32Array(cells),
    u0: new Float32Array(cells),
    v0: new Float32Array(cells),
    dye: Array.from({ length: DYES }, () => new Float32Array(cells)),
    dye0: Array.from({ length: DYES }, () => new Float32Array(cells)),
    pressure: new Float32Array(cells),
    divergence: new Float32Array(cells),
    due: 0,
    inside: new Uint8Array(cells),
  };

  for (let j = 0; j < GRID; j += 1) {
    for (let i = 0; i < GRID; i += 1) {
      const x = positionOf(i);
      const y = positionOf(j);

      smoke.inside[i + j * GRID] = Math.hypot(x, y) <= CHAMBER_RADIUS ? 1 : 0;
    }
  }

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

  stir(smoke, { thickness, swirl, angle, step });
  confine(smoke, step);
  project(smoke);
  carry(smoke, step);
  project(smoke);

  for (let d = 0; d < DYES; d += 1) {
    const from = smoke.dye[d]!;
    const into = smoke.dye0[d]!;

    carryDye(smoke, from, into, step);
    smoke.dye[d] = into;
    smoke.dye0[d] = from;
  }
}

/** Everything that pushes on the fluid this step. */
function stir(
  smoke: Smoke,
  {
    thickness,
    swirl,
    angle,
    step,
  }: {
    thickness: number;
    swirl: number;
    angle: number;
    step: number;
  },
): void {
  const { u, v, inside } = smoke;
  const thick = 1 + THICKEST * Math.min(1, Math.max(0, thickness));
  // The wall drags the whole body of fluid round with it — which is what makes
  // the smoke lag a turn and then outlive it — and a thicker fluid takes the
  // wall's turning up sooner and gives it back over longer.
  const wall = Math.min(1, WALL_GRIP * thick * step);
  const slow = Math.max(0, 1 - VISCOSITY * thick * step);
  // The dye's own weight, which is the only thing keeping the cell alive when
  // nobody is turning it. Thicker fluid holds it up more.
  const fall = (GRAVITY * INK_WEIGHT * step) / thick;
  const downX = Math.sin(angle) * fall;
  const downY = Math.cos(angle) * fall;

  for (let j = 0; j < GRID; j += 1) {
    for (let i = 0; i < GRID; i += 1) {
      const k = i + j * GRID;

      if (!inside[k]) {
        u[k] = 0;
        v[k] = 0;
        continue;
      }

      const x = positionOf(i);
      const y = positionOf(j);
      let dyed = 0;

      for (let d = 0; d < DYES; d += 1) {
        dyed += smoke.dye[d]![k]!;
      }

      u[k] = (u[k]! + (-swirl * y - u[k]!) * wall + downX * dyed) * slow;
      v[k] = (v[k]! + (swirl * x - v[k]!) * wall + downY * dyed) * slow;
    }
  }
}

/**
 * Puts the small swirls back. See {@link CONFINE}.
 *
 * The curl of a two-dimensional field is one number per cell — how fast that
 * patch is turning — and its gradient points at where the turning is
 * strongest. Pushing each cell along the perpendicular of that gradient, in the
 * direction its own curl is going, tightens the swirl instead of letting the
 * next advection average it away.
 */
function confine(smoke: Smoke, step: number): void {
  const { u, v, inside, pressure, divergence } = smoke;
  const width = (2 * CHAMBER_RADIUS) / GRID;
  // Borrowed: the pressure solve has not run yet this step, so its two scratch
  // fields are free. `divergence` holds the curl and `pressure` its size.
  const curl = divergence;
  const strength = pressure;

  for (let j = 0; j < GRID; j += 1) {
    for (let i = 0; i < GRID; i += 1) {
      const k = i + j * GRID;

      if (!inside[k]) {
        curl[k] = 0;
        strength[k] = 0;
        continue;
      }

      curl[k] =
        (flow(v, inside, v[k]!, i + 1, j) -
          flow(v, inside, v[k]!, i - 1, j) -
          flow(u, inside, u[k]!, i, j + 1) +
          flow(u, inside, u[k]!, i, j - 1)) /
        (2 * width);
      strength[k] = Math.abs(curl[k]);
    }
  }

  // One pass of blur over how strong the turning is, so the push below follows
  // the swirl rather than the grid. See CONFINE.
  for (let j = 0; j < GRID; j += 1) {
    for (let i = 0; i < GRID; i += 1) {
      const k = i + j * GRID;

      if (!inside[k]) {
        continue;
      }

      const here = strength[k]!;

      smoothed[k] =
        (here +
          flow(strength, inside, here, i + 1, j) +
          flow(strength, inside, here, i - 1, j) +
          flow(strength, inside, here, i, j + 1) +
          flow(strength, inside, here, i, j - 1)) /
        5;
    }
  }

  const push = CONFINE * step * width;

  for (let j = 0; j < GRID; j += 1) {
    for (let i = 0; i < GRID; i += 1) {
      const k = i + j * GRID;

      if (!inside[k]) {
        continue;
      }

      // Uphill towards the tightest turning nearby.
      const alongX =
        (flow(smoothed, inside, smoothed[k]!, i + 1, j) -
          flow(smoothed, inside, smoothed[k]!, i - 1, j)) /
        2;
      const alongY =
        (flow(smoothed, inside, smoothed[k]!, i, j + 1) -
          flow(smoothed, inside, smoothed[k]!, i, j - 1)) /
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

/** Carries the velocity field along itself. */
function carry(smoke: Smoke, step: number): void {
  advect(smoke, smoke.u, smoke.u0, step);
  advect(smoke, smoke.v, smoke.v0, step);

  const u = smoke.u0;
  const v = smoke.v0;

  smoke.u0 = smoke.u;
  smoke.v0 = smoke.v;
  smoke.u = u;
  smoke.v = v;
}

/**
 * Traces every cell backwards down the flow and reads what was there.
 *
 * Semi-Lagrangian: rather than asking where this cell's contents are going —
 * which can overshoot and blow up — it asks where this cell's contents came
 * from, which cannot, because whatever it lands on is a value the field
 * already held.
 */
function advect(smoke: Smoke, from: Float32Array, into: Float32Array, step: number): void {
  const { u, v, inside } = smoke;
  // Cell widths travelled, rather than cell units.
  const rate = (step * GRID) / (2 * CHAMBER_RADIUS);

  for (let j = 0; j < GRID; j += 1) {
    for (let i = 0; i < GRID; i += 1) {
      const k = i + j * GRID;

      if (!inside[k]) {
        into[k] = 0;
        continue;
      }

      const backX = Math.min(GRID - 1.001, Math.max(0, i - u[k]! * rate));
      const backY = Math.min(GRID - 1.001, Math.max(0, j - v[k]! * rate));
      const i0 = Math.floor(backX);
      const j0 = Math.floor(backY);
      const fx = backX - i0;
      const fy = backY - j0;
      const i1 = Math.min(GRID - 1, i0 + 1);
      const j1 = Math.min(GRID - 1, j0 + 1);
      into[k] =
        (1 - fx) *
          ((1 - fy) * sample(from, inside, from[k]!, i0, j0) +
            fy * sample(from, inside, from[k]!, i0, j1)) +
        fx *
          ((1 - fy) * sample(from, inside, from[k]!, i1, j0) +
            fy * sample(from, inside, from[k]!, i1, j1));
    }
  }
}

/**
 * One corner of the bilinear read.
 *
 * A cell outside the wall holds nothing, and reading its nought would suck the
 * dye out of everything that drifts near the rim. So the wall hands back what
 * the asking cell already had, which is what a wall the fluid cannot cross
 * through looks like from the inside.
 */
function sample(
  field: Float32Array,
  inside: Uint8Array,
  here: number,
  i: number,
  j: number,
): number {
  const k = i + j * GRID;

  return inside[k] ? field[k]! : here;
}

/**
 * Takes the divergence out of the velocity field.
 *
 * A fluid that is neither piling up nor thinning out anywhere is what makes
 * the difference between ink swirling and ink simply fading: without this the
 * field has sources and sinks all over it, and the dye drains into them.
 *
 * Solved as a Poisson equation for the pressure whose gradient cancels the
 * divergence, by Gauss-Seidel — see {@link PASSES}. The wall is a zero-gradient
 * boundary: a cell outside it takes its neighbour's pressure, which is another
 * way of saying nothing flows through it.
 */
function project(smoke: Smoke): void {
  const { u, v, inside, pressure, divergence } = smoke;
  const width = (2 * CHAMBER_RADIUS) / GRID;

  for (let j = 0; j < GRID; j += 1) {
    for (let i = 0; i < GRID; i += 1) {
      const k = i + j * GRID;

      pressure[k] = 0;

      if (!inside[k]) {
        divergence[k] = 0;
        continue;
      }

      // Minus the divergence, since that is the form the pass below wants.
      divergence[k] =
        -(
          flow(u, inside, u[k]!, i + 1, j) -
          flow(u, inside, u[k]!, i - 1, j) +
          flow(v, inside, v[k]!, i, j + 1) -
          flow(v, inside, v[k]!, i, j - 1)
        ) /
        (2 * width);
    }
  }

  const area = width * width;

  for (let pass = 0; pass < PASSES; pass += 1) {
    for (let j = 0; j < GRID; j += 1) {
      for (let i = 0; i < GRID; i += 1) {
        const k = i + j * GRID;

        if (!inside[k]) {
          continue;
        }

        pressure[k] =
          (divergence[k]! * area +
            flow(pressure, inside, pressure[k]!, i + 1, j) +
            flow(pressure, inside, pressure[k]!, i - 1, j) +
            flow(pressure, inside, pressure[k]!, i, j + 1) +
            flow(pressure, inside, pressure[k]!, i, j - 1)) /
          4;
      }
    }
  }

  for (let j = 0; j < GRID; j += 1) {
    for (let i = 0; i < GRID; i += 1) {
      const k = i + j * GRID;

      if (!inside[k]) {
        continue;
      }

      u[k]! -=
        (0.5 *
          (flow(pressure, inside, pressure[k]!, i + 1, j) -
            flow(pressure, inside, pressure[k]!, i - 1, j))) /
        width;
      v[k]! -=
        (0.5 *
          (flow(pressure, inside, pressure[k]!, i, j + 1) -
            flow(pressure, inside, pressure[k]!, i, j - 1))) /
        width;
    }
  }
}

/** A neighbour, with the wall standing in for anything beyond it. */
function flow(field: Float32Array, inside: Uint8Array, here: number, i: number, j: number): number {
  if (i < 0 || i >= GRID || j < 0 || j >= GRID) {
    return here;
  }

  const k = i + j * GRID;

  return inside[k] ? field[k]! : here;
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

  advect(smoke, from, back, step);
  advect(smoke, back, forward, -step);

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
        flow(back, inside, traced, i + 1, j),
        flow(back, inside, traced, i - 1, j),
        flow(back, inside, traced, i, j + 1),
        flow(back, inside, traced, i, j - 1),
      ]) {
        least = Math.min(least, near);
        most = Math.max(most, near);
      }

      into[k] = Math.min(1, Math.max(0, Math.min(most, Math.max(least, corrected))));
    }
  }
}

/** How strong the turning is nearby, blurred once. See {@link CONFINE}. */
const smoothed = new Float32Array(GRID * GRID);

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
 * @param amount How strong the ink is, from the Ink setting.
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
