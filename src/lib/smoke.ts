import { CHAMBER_RADIUS, type Medium } from './chamber';
import { mulberry32 } from './random';
import type { Shard } from './scene';

/**
 * Ink loose in the liquid cell.
 *
 * The glass and the glitter are particles; this is the other kind of fluid
 * entirely — a grid, holding a velocity field and the dye carried in it. It is
 * Stam's *Stable Fluids* (SIGGRAPH 1999) at a modest size: advect the velocity
 * by tracing it backwards, make it divergence-free, then carry the dye along
 * on the result. Semi-Lagrangian advection is unconditionally stable, which is
 * what makes it safe to run against whatever frame time a phone hands over.
 *
 * The roadmap put this on the GPU, and per-pixel it belongs there. At the size
 * an object cell actually needs it does not have to be: {@link GRID} squared is
 * four thousand cells, and stepped at {@link RATE} it measures **0.9 ms per
 * rendered frame** against the rest of the chamber's 0.6. What that buys is
 * that the ink lives with the rest of the chamber rather than in the
 * compositor, so it is painted into the source triangle and folded by the
 * mirrors along with everything else — six reflections of the same ribbon,
 * exactly as a real one would give.
 *
 * One thing was tried here and did not pay. The wall is a circle on a square
 * grid, so nine cells in ten have all four neighbours inside it and could read
 * them straight out of the array rather than asking about each one; marking
 * those cells and giving the pressure solve and the advection a path of their
 * own for them measured **0.862 ms against 0.899** — four per cent, for a field
 * to build and keep and three more branches in the hottest loops in the
 * chamber. The engine was already inlining the check. It was taken out again.
 *
 * Three dyes rather than one, and subtractive: each takes its own primary out
 * of the light, the way real dye in a lit cell does, so where two of them fold
 * together the colour is the mixture and not the brighter of the pair.
 *
 * The grid spans the cell's bounding square, in the cell's own frame — so it
 * turns with the tube, and gravity sweeps around it exactly as it does for the
 * glass.
 */

/**
 * Cells across the chamber.
 *
 * Sixty-four. Ink is smooth — it has no edges of its own to resolve, only
 * ribbons — so the picture is nearly as good at this size as at twice it, and
 * a quarter of the cost. The grid is drawn scaled up with smoothing, which is
 * a bilinear filter over the same field the solver samples bilinearly, so the
 * seam between what is simulated and what is shown never shows.
 */
export const GRID = 64;

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

/** Speed lost per second, so a stirred cell eventually goes still again. */
const VISCOSITY = 0.35;

/** How much of the falling glass's motion is dragged into the fluid, per second. */
const GLASS_GRIP = 6;

/** The speed at which a piece of glass is stirring the fluid for all it is worth. */
const STIR_SPEED = 0.3;

/** How much heavier the dye is than what it is floating in. */
const INK_WEIGHT = 0.5;

/** Downward acceleration, matched to the chamber's own. */
const GRAVITY = 6;

/**
 * How hard the dye is pushed back against its own blurring, per second.
 *
 * Tracing backwards and sampling bilinearly loses a little of the field at
 * every step, and over a minute that turns ribbons into a flat wash. Real ink
 * in oil does not do that — it is not dissolved in the oil, it is suspended in
 * it, and the ribbons stay ribbons for a very long time. Modelling that
 * properly means tracking the surface between two fluids, which is a different
 * and much larger job; this fights the blur instead of modelling what would
 * prevent it, by taking a little of the local average back out of every cell.
 * An honest description is that the smearing is a fault of the method and this
 * is a countermeasure, not a physical effect.
 */
const SHARPEN = 1.4;

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

/** Builds a cell of ink, deterministically, in a few clouds of each dye. */
export function createSmoke(seed: number): Smoke {
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

    for (let blob = 0; blob < 2; blob += 1) {
      const angle = rng() * Math.PI * 2;
      const distance = Math.sqrt(rng()) * CHAMBER_RADIUS * 0.8;
      const atX = Math.cos(angle) * distance;
      const atY = Math.sin(angle) * distance;
      const reach = CHAMBER_RADIUS * (0.22 + rng() * 0.18);

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

  return smoke;
}

export interface SmokeUpdate {
  /** Seconds to advance. */
  dt: number;
  /** What the cell is filled with. Ink needs a fluid to be loose in. */
  medium: Medium;
  /** How fast the fluid is turning within the cell, radians per second. */
  swirl: number;
  /** Which way is down in the cell's own frame, radians. */
  angle: number;
  /** The glass, which drags the fluid along behind it. */
  shards: readonly Shard[];
}

/**
 * Advances the ink in place.
 *
 * The order is Stam's: put the forces in, make the field divergence-free,
 * carry the field along itself, make it divergence-free again, and only then
 * carry the dye. Projecting after the advection as well as before is what
 * keeps a swirl from slowly collapsing into its own middle.
 */
export function updateSmoke(smoke: Smoke, { dt, medium, swirl, angle, shards }: SmokeUpdate): void {
  if (dt <= 0 || medium.stir <= 0) {
    return;
  }

  smoke.due += dt;

  if (smoke.due < 1 / RATE) {
    return;
  }

  const step = Math.min(smoke.due, 1 / 20);

  smoke.due = 0;

  stir(smoke, { medium, swirl, angle, shards, step });
  project(smoke);
  carry(smoke, step);
  project(smoke);

  for (let d = 0; d < DYES; d += 1) {
    const from = smoke.dye[d]!;
    const into = smoke.dye0[d]!;

    advect(smoke, from, into, step);
    sharpen(smoke, into, step);
    smoke.dye[d] = into;
    smoke.dye0[d] = from;
  }
}

/** Everything that pushes on the fluid this step. */
function stir(
  smoke: Smoke,
  {
    medium,
    swirl,
    angle,
    shards,
    step,
  }: {
    medium: Medium;
    swirl: number;
    angle: number;
    shards: readonly Shard[];
    step: number;
  },
): void {
  const { u, v, inside } = smoke;
  // The wall drags the whole body of fluid round with it, exactly as it drags
  // the glass — see `advanceFlow` in lib/chamber.ts, which is where this rate
  // comes from and what makes the ink lag a turn and outlive it.
  const wall = Math.min(1, medium.stir * step);
  const slow = Math.max(0, 1 - VISCOSITY * step);
  const downX = Math.sin(angle) * GRAVITY * INK_WEIGHT * (1 - medium.density) * step;
  const downY = Math.cos(angle) * GRAVITY * INK_WEIGHT * (1 - medium.density) * step;

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

  // And the glass, which is the part that makes the ink belong to this chamber
  // rather than to a screensaver: a piece sinking through the fluid pulls a
  // wake behind it, and an avalanche leaves the whole cell churning.
  //
  // Only glass that is actually moving, and in proportion to how fast. Pulling
  // the fluid towards every piece's velocity regardless would be the same rule
  // read backwards — a cell packed with settled glass would hold the fluid
  // still everywhere the glass is, which is nearly everywhere, and the ink
  // would stop dead the moment the pile did.
  const grip = Math.min(1, GLASS_GRIP * step);

  for (const shard of shards) {
    const speed = Math.hypot(shard.vx, shard.vy);

    if (speed < STIR_SPEED * 0.1) {
      continue;
    }

    const push = grip * Math.min(1, speed / STIR_SPEED);
    const i = Math.round(((shard.x + CHAMBER_RADIUS) / (2 * CHAMBER_RADIUS)) * GRID - 0.5);
    const j = Math.round(((shard.y + CHAMBER_RADIUS) / (2 * CHAMBER_RADIUS)) * GRID - 0.5);

    for (let dj = -1; dj <= 1; dj += 1) {
      for (let di = -1; di <= 1; di += 1) {
        const at = i + di;
        const to = j + dj;

        if (at < 0 || at >= GRID || to < 0 || to >= GRID) {
          continue;
        }

        const k = at + to * GRID;

        if (!inside[k]) {
          continue;
        }

        // The middle of the piece pulls hardest; its edges only brush past.
        const share = push * (di === 0 && dj === 0 ? 1 : 0.4);

        u[k]! += (shard.vx - u[k]!) * share;
        v[k]! += (shard.vy - v[k]!) * share;
      }
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

/** Takes a little of the local average back out of every cell. See {@link SHARPEN}. */
function sharpen(smoke: Smoke, field: Float32Array, step: number): Float32Array {
  const { inside } = smoke;
  const push = Math.min(0.6, SHARPEN * step);

  for (let j = 0; j < GRID; j += 1) {
    for (let i = 0; i < GRID; i += 1) {
      const k = i + j * GRID;

      if (!inside[k]) {
        continue;
      }

      const here = field[k]!;
      const around =
        (flow(field, inside, here, i + 1, j) +
          flow(field, inside, here, i - 1, j) +
          flow(field, inside, here, i, j + 1) +
          flow(field, inside, here, i, j - 1)) /
        4;

      field[k] = Math.min(1, Math.max(0, here + (here - around) * push));
    }
  }

  return field;
}

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
export function paintSmoke(smoke: Smoke, amount: number): HTMLCanvasElement | null {
  const surface = inkSurface();

  if (!surface || amount <= 0) {
    return null;
  }

  const { canvas, ctx, image } = surface;
  const pixels = image.data;

  for (let k = 0; k < GRID * GRID; k += 1) {
    const at = k * 4;

    for (let d = 0; d < DYES; d += 1) {
      const taken = Math.min(1, Math.max(0, smoke.dye[d]![k]! * amount));

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
