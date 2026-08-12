import type { Shard } from './scene';

/**
 * The object chamber: loose glass in a bounded cell, under gravity.
 *
 * The cell turns and gravity does not, so gravity does not point "down" in the
 * cell's coordinates — it points down in the world, and turning the cell sweeps
 * that direction around it. That is the whole mechanism behind the way a real
 * kaleidoscope behaves: the pattern does not change because something is
 * rotating, it changes because turning tips the chips and they avalanche, then
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

/**
 * How much sideways movement a contact will hold on to, against how hard the
 * two pieces are being pressed together.
 *
 * This is what gives a pile an angle of repose. Resolving only the overlap
 * leaves the glass free to slide across whatever it is resting on, so a heap
 * spreads until it is flat and the least tip sets the whole thing flowing —
 * which reads as a chamber of liquid rather than one of glass. Holding the
 * contact against sideways motion up to this share of the separation gives a
 * heap that stands at a slope, holds through a small tip, and lets go all at
 * once past a critical one. That is what an avalanche is.
 *
 * Coulomb's number for glass on glass is around 0.4 dry, and the pieces here
 * are ground and faceted rather than polished spheres.
 */
const STATIC_FRICTION = 0.45;

/** Physics substeps per frame, so a fast chip cannot pass through a wall. */
const SUBSTEPS = 2;

export interface ChamberUpdate {
  /** Seconds to advance. */
  dt: number;
  /** Angle the cell has been turned to, radians. This is what tips the pile. */
  angle: number;
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
export function updateChamber(shards: Shard[], { dt, angle }: ChamberUpdate): void {
  if (dt <= 0 || shards.length === 0) {
    return;
  }

  const step = dt / SUBSTEPS;
  // World down (+y on screen) expressed in the cell's own frame.
  //
  // The renderer draws the cell rotated by `angle`, so its axes are turned by
  // `+angle` against the screen and world down has to be turned back by the same
  // amount to land in them. Sign this the other way — the easy mistake, since it
  // looks like "undo the rotation" — and gravity sweeps the cell at twice the
  // turn rate instead of holding still: a quarter turn puts the pile at the top
  // of the screen, and the whole mechanism reads as no gravity at all.
  const gravityX = Math.sin(angle) * GRAVITY;
  const gravityY = Math.cos(angle) * GRAVITY;
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

/**
 * Pushes overlapping chips apart, so they stack instead of interpenetrating,
 * and holds the contact against sliding while they are pressed together.
 *
 * The push is shared out by weight rather than halved. A splinter that lands on
 * a bead should be the one that moves; splitting the correction evenly shoves
 * the bead just as far, and a chamber of mixed sizes then behaves as though
 * every piece weighed the same — which is the thing that reads most plainly as
 * "not glass". Mass goes with area, so a piece twice across is four times as
 * hard to shift, and the pile sorts itself as a real one does: the big pieces
 * work their way down and the small ones ride up.
 */
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

      const inverseA = 1 / mass(a);
      const inverseB = 1 / mass(b);
      const total = inverseA + inverseB;
      const overlap = (minimum - distance) * SEPARATION;
      const normalX = dx / distance;
      const normalY = dy / distance;
      const shareA = inverseA / total;
      const shareB = inverseB / total;

      a.x -= normalX * overlap * shareA;
      a.y -= normalY * overlap * shareA;
      b.x += normalX * overlap * shareB;
      b.y += normalY * overlap * shareB;

      hold(a, b, normalX, normalY, overlap, shareA, shareB);
    }
  }
}

/**
 * Resists sliding at a contact, up to what the contact can hold.
 *
 * The two pieces have moved since the substep began; whatever part of that
 * movement was across the contact rather than into it is sliding, and a dry
 * contact takes some of it back. Capped at {@link STATIC_FRICTION} times how
 * hard they are being pressed together, so a piece high on a steep heap still
 * gives way — the cap is the difference between a pile and a glued lump.
 *
 * Position-level rather than an impulse: the overlap has just been resolved by
 * moving positions, so the friction that goes with it has to be moved out of
 * the same ledger or the velocity read back at the end of the substep will not
 * agree with where the glass actually ended up.
 */
function hold(
  a: Shard,
  b: Shard,
  normalX: number,
  normalY: number,
  overlap: number,
  shareA: number,
  shareB: number,
): void {
  const movedX = a.x - (previousX.get(a) ?? a.x) - (b.x - (previousX.get(b) ?? b.x));
  const movedY = a.y - (previousY.get(a) ?? a.y) - (b.y - (previousY.get(b) ?? b.y));
  // Only the part across the contact. What went into it is the overlap, and
  // that has already been dealt with.
  const into = movedX * normalX + movedY * normalY;
  const slideX = movedX - into * normalX;
  const slideY = movedY - into * normalY;
  const slide = Math.hypot(slideX, slideY);

  if (slide === 0) {
    return;
  }

  const held = Math.min(slide, STATIC_FRICTION * overlap) / slide;

  a.x -= slideX * held * shareA;
  a.y -= slideY * held * shareA;
  b.x += slideX * held * shareB;
  b.y += slideY * held * shareB;
}

/** Keeps a chip inside the chamber wall, and lets the wall grip it. */
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

  const normalX = shard.x / distance;
  const normalY = shard.y / distance;
  const overlap = distance - limit;

  shard.x = normalX * limit;
  shard.y = normalY * limit;

  // The wall does not move, so it takes the whole of the friction rather than a
  // share of it. Without this the glass slides round the barrel as freely as it
  // falls, and a heap against the side runs away downhill.
  const movedX = shard.x - (previousX.get(shard) ?? shard.x);
  const movedY = shard.y - (previousY.get(shard) ?? shard.y);
  const into = movedX * normalX + movedY * normalY;
  const slideX = movedX - into * normalX;
  const slideY = movedY - into * normalY;
  const slide = Math.hypot(slideX, slideY);

  if (slide === 0) {
    return;
  }

  const held = Math.min(slide, STATIC_FRICTION * overlap) / slide;

  shard.x -= slideX * held;
  shard.y -= slideY * held;
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
export function settleChamber(shards: Shard[], angle = 0, maxSeconds = 12): void {
  const step = 1 / 60;
  const checkEvery = 15;

  for (let frame = 0; frame < maxSeconds / step; frame += 1) {
    updateChamber(shards, { dt: step, angle });

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
