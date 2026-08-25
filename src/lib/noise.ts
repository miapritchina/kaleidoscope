/**
 * Smooth, seeded value noise in two dimensions and time.
 *
 * Hand-rolled rather than imported, because the whole of what the app wants
 * from noise is here in forty lines: a deterministic scalar field that is
 * smooth everywhere and different everywhere, to take the curl of. The curl
 * of any smooth potential is divergence-free by construction (Bridson,
 * Hourihan and Nordenstam, SIGGRAPH 2007), which is what lets a breeze be
 * added to a fluid without fighting its pressure solve — see `lib/smoke.ts`.
 *
 * Value noise, not gradient noise: the lattice holds values and the field
 * interpolates them with a smoothstep. Its known vice — faint lattice-aligned
 * structure — does not matter to a potential that is differentiated and then
 * buried in a fluid.
 */

/** A smooth field: position and time in, a value in about `[-1, 1]` out. */
export type Noise = (x: number, y: number, t: number) => number;

/**
 * One integer lattice point's fixed random value, in `[-1, 1]`.
 *
 * A small avalanche hash: the constants are the usual multiplicative mixers,
 * and all that is asked of them is that neighbouring lattice points come out
 * unrelated.
 */
function lattice(seed: number, x: number, y: number, t: number): number {
  let h = seed ^ (x * 374761393) ^ (y * 668265263) ^ (t * 2147483647);

  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;

  return (h & 0xfffff) / 0x7ffff - 1;
}

/** Smoothstep, so the field's derivative is continuous at lattice lines. */
function ease(at: number): number {
  return at * at * (3 - 2 * at);
}

/** Builds the field for a seed. */
export function createNoise(seed: number): Noise {
  const salt = seed | 0 || 1;

  return (x, y, t) => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const t0 = Math.floor(t);
    const fx = ease(x - x0);
    const fy = ease(y - y0);
    const ft = ease(t - t0);

    let value = 0;

    for (let dt = 0; dt <= 1; dt += 1) {
      const wt = dt === 0 ? 1 - ft : ft;

      for (let dy = 0; dy <= 1; dy += 1) {
        const wy = dy === 0 ? 1 - fy : fy;

        for (let dx = 0; dx <= 1; dx += 1) {
          const wx = dx === 0 ? 1 - fx : fx;

          value += lattice(salt, x0 + dx, y0 + dy, t0 + dt) * wx * wy * wt;
        }
      }
    }

    return value;
  };
}
