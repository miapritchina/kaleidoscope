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

/**
 * How much of the sliding at a contact is turned into spin, per pass.
 *
 * Glass on glass is not slippery: a chip dragged down the wall or across the
 * pile rolls rather than skids, and it is the rolling that reads as tumbling.
 */
const FRICTION = 0.55;

/** Spin lost per second. A chip wedged in a full chamber does not twirl on. */
const ANGULAR_DAMPING = 2.6;

/** Speed below which a chip is treated as at rest, so piles stop jittering. */
const SLEEP_SPEED = 0.012;

/** Spin below which a chip that has stopped moving is treated as still. */
const SLEEP_SPIN = 0.08;

/** Gap at which two surfaces still count as touching, in cell units. */
const CONTACT_SLOP = 0.01;

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
  const angularDamping = Math.max(0, 1 - ANGULAR_DAMPING * step);

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
      shard.vx = (shard.x - (previousX.get(shard) ?? shard.x)) / step;
      shard.vy = (shard.y - (previousY.get(shard) ?? shard.y)) / step;
    }

    tumble(shards);

    for (const shard of shards) {
      // Sleep before the rotation is advanced, not after: a settled pile still
      // creeps by a hair each frame, and letting the contacts turn that into
      // spin first leaves the whole field slowly rotating on a table.
      if (Math.hypot(shard.vx, shard.vy) < SLEEP_SPEED) {
        shard.vx = 0;
        shard.vy = 0;

        if (Math.abs(shard.spin) < SLEEP_SPIN) {
          shard.spin = 0;
        }
      }

      shard.rotation += shard.spin * step;
      shard.spin *= angularDamping;
    }
  }
}

/**
 * Turns sliding at the contacts into spin.
 *
 * A chip is a disc, not a point, so an impulse that lands off its centre turns
 * it — which is the whole of tumbling. Sliding down the wall sets a chip
 * rolling, a glancing blow spins both pieces the opposite way, and a piece
 * pinned in the pile stops turning because its contacts have nothing left to
 * slide against.
 *
 * Each contact removes a fraction of the tangential slip — the relative speed of
 * the two surfaces where they touch — with an impulse along the tangent. A
 * uniform disc has `I = m r^2 / 2`, so once the spin that impulse produces is
 * counted back in, it changes the slip by `3 J / m`. That is where the thirds
 * come from, and why the radius cancels out against the wall.
 */
function tumble(shards: Shard[]): void {
  for (let i = 0; i < shards.length; i += 1) {
    const a = shards[i]!;

    for (let j = i + 1; j < shards.length; j += 1) {
      const b = shards[j]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distance = Math.hypot(dx, dy);

      if (distance === 0 || distance > a.radius + b.radius + CONTACT_SLOP) {
        continue;
      }

      // Tangent at the contact: perpendicular to the line of centres.
      const tangentX = -dy / distance;
      const tangentY = dx / distance;
      // Each surface point carries its body's spin, so both radii count.
      const slip =
        (b.vx - a.vx) * tangentX + (b.vy - a.vy) * tangentY - b.spin * b.radius - a.spin * a.radius;

      if (slip === 0) {
        continue;
      }

      const inverseA = 1 / mass(a);
      const inverseB = 1 / mass(b);
      const impulse = (-FRICTION * slip) / (3 * (inverseA + inverseB));

      a.vx -= impulse * inverseA * tangentX;
      a.vy -= impulse * inverseA * tangentY;
      b.vx += impulse * inverseB * tangentX;
      b.vy += impulse * inverseB * tangentY;
      a.spin -= (2 * impulse * inverseA) / a.radius;
      b.spin -= (2 * impulse * inverseB) / b.radius;
    }
  }

  for (const shard of shards) {
    const distance = Math.hypot(shard.x, shard.y);

    if (distance === 0 || distance < CHAMBER_RADIUS - shard.radius - CONTACT_SLOP) {
      continue;
    }

    // The wall is fixed, so its surface contributes nothing to the slip.
    const tangentX = -shard.y / distance;
    const tangentY = shard.x / distance;
    const slip = shard.vx * tangentX + shard.vy * tangentY + shard.spin * shard.radius;
    const change = (-FRICTION * slip) / 3;

    shard.vx += change * tangentX;
    shard.vy += change * tangentY;
    shard.spin += (2 * change) / shard.radius;
  }
}

/** Chips are glass all the way through, so mass goes with area. */
function mass(shard: Shard): number {
  return shard.radius * shard.radius;
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

/** True once nothing is sliding or turning faster than the sleep thresholds. */
function atRest(shards: Shard[]): boolean {
  return shards.every(
    (shard) => Math.hypot(shard.vx, shard.vy) <= SLEEP_SPEED && Math.abs(shard.spin) <= SLEEP_SPIN,
  );
}
