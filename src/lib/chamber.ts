import type { Shard } from './scene';

/**
 * The object chamber: loose glass in a bounded cell, under gravity.
 *
 * The chamber is fixed to the tube, so gravity does not point "down" in its
 * coordinates — it points down in the world, and turning the tube sweeps that
 * direction around the chamber. That is the whole mechanism behind the way a
 * real kaleidoscope behaves: the pattern does not change because the tube is
 * turning, it changes because turning tips the chips and they avalanche, then
 * settle into a new pile.
 *
 * Coordinates are in cell units, with the chamber centred on the origin.
 */

/** Radius of the chamber wall, in cell units. */
export const CHAMBER_RADIUS = 1.15;

/** Downward acceleration, in cell units per second squared. */
const GRAVITY = 6;

/** Velocity lost per second to drag and friction. Glass in a chamber is damped. */
const DAMPING = 2.2;

/** Constraint passes per substep. More passes make a deep pile firmer. */
const ITERATIONS = 3;

/** How much a chip turns as it slides. */
const ROLL = 6;

/** Speed below which a chip is treated as at rest, so piles stop jittering. */
const SLEEP_SPEED = 0.012;

/** Fraction of an overlap resolved per pass. Below 1 the pile settles softly. */
const SEPARATION = 0.8;

/** Physics substeps per frame, so a fast chip cannot pass through a wall. */
const SUBSTEPS = 2;

export interface ChamberUpdate {
  /** Seconds to advance. */
  dt: number;
  /** Angle of the tube, radians. Gravity is world-down, so this tips the pile. */
  tube: number;
}

/**
 * Advances the chips in place.
 *
 * Position based: each substep predicts where the glass would go, then resolves
 * overlaps and the wall by moving positions directly, and finally reads the
 * velocity back off how far each chip actually travelled. Resolving contacts
 * with impulses instead leaves a pile creeping forever, because gravity keeps
 * feeding in velocity that the contacts never fully take out; here a chip that
 * is held in place simply records no movement, and so comes to rest.
 */
export function updateChamber(shards: Shard[], { dt, tube }: ChamberUpdate): void {
  if (dt <= 0 || shards.length === 0) {
    return;
  }

  const step = dt / SUBSTEPS;
  // World down (+y on canvas) expressed in the chamber's own frame.
  const gravityX = -Math.sin(tube) * GRAVITY;
  const gravityY = Math.cos(tube) * GRAVITY;
  const damping = Math.max(0, 1 - DAMPING * step);

  for (let pass = 0; pass < SUBSTEPS; pass += 1) {
    for (const shard of shards) {
      previousX.set(shard, shard.x);
      previousY.set(shard, shard.y);

      shard.vx = (shard.vx + gravityX * step) * damping;
      shard.vy = (shard.vy + gravityY * step) * damping;
      shard.x += shard.vx * step;
      shard.y += shard.vy * step;
    }

    for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
      separate(shards);

      for (const shard of shards) {
        confine(shard);
      }
    }

    for (const shard of shards) {
      const movedX = shard.x - (previousX.get(shard) ?? shard.x);
      const movedY = shard.y - (previousY.get(shard) ?? shard.y);

      shard.vx = movedX / step;
      shard.vy = movedY / step;

      // Rolling, and the drag that stops a chip spinning on the spot forever.
      shard.rotation += shard.spin * step;
      shard.spin = (shard.spin + movedX * ROLL) * damping;

      if (Math.hypot(shard.vx, shard.vy) < SLEEP_SPEED) {
        shard.vx = 0;
        shard.vy = 0;
      }
    }
  }
}

/** Scratch space for the previous positions, so no allocation happens per frame. */
const previousX = new WeakMap<Shard, number>();
const previousY = new WeakMap<Shard, number>();

/** Pushes overlapping chips apart, so they stack instead of interpenetrating. */
function separate(shards: Shard[]): void {
  for (let i = 0; i < shards.length; i += 1) {
    const a = shards[i]!;

    for (let j = i + 1; j < shards.length; j += 1) {
      const b = shards[j]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distance = Math.hypot(dx, dy);
      const minimum = a.radius + b.radius;

      if (distance >= minimum || distance === 0) {
        continue;
      }

      const correction = ((minimum - distance) / distance) * SEPARATION * 0.5;

      a.x -= dx * correction;
      a.y -= dy * correction;
      b.x += dx * correction;
      b.y += dy * correction;
    }
  }
}

/** Keeps a chip inside the chamber wall. */
function confine(shard: Shard): void {
  const limit = CHAMBER_RADIUS - shard.radius;

  if (limit <= 0) {
    shard.x = 0;
    shard.y = 0;
    return;
  }

  const distance = Math.hypot(shard.x, shard.y);

  if (distance <= limit || distance === 0) {
    return;
  }

  shard.x = (shard.x / distance) * limit;
  shard.y = (shard.y / distance) * limit;
}

/**
 * Settles a fresh chamber, so it opens on a resting pile.
 *
 * Runs until the glass stops moving rather than for a fixed spell: how long a
 * pile takes to come to rest depends on how much glass is in it, and a chamber
 * that is still mid-avalanche when the first frame is drawn visibly rains down
 * on load. The cap is a backstop for a chamber packed too tightly to ever fully
 * settle.
 */
export function settleChamber(shards: Shard[], tube = 0, maxSeconds = 12): void {
  const step = 1 / 60;
  const checkEvery = 15;

  for (let frame = 0; frame < maxSeconds / step; frame += 1) {
    updateChamber(shards, { dt: step, tube });

    if (frame % checkEvery === checkEvery - 1 && atRest(shards)) {
      return;
    }
  }
}

/** True once nothing is moving faster than the sleep threshold. */
function atRest(shards: Shard[]): boolean {
  return shards.every((shard) => Math.hypot(shard.vx, shard.vy) <= SLEEP_SPEED);
}
