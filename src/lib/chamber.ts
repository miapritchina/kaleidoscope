import type { Shard } from './scene';
import type { Bead } from './shape';

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
 * Each piece is a chain of circles rather than a single one — see `lib/shape.ts`
 * — so a sliver on its end and a sliver lying flat are different obstacles, two
 * of them cannot cross through each other, and a long one can bridge a gap. A
 * contact away from a piece's middle turns it, which is what lets a heap of
 * splinters settle flat instead of standing on end.
 *
 * Coordinates are in cell units, with the chamber centred on the origin.
 */

/**
 * Circumradius of the cell, in cell units — the distance to each of its corners.
 *
 * The cell is the triangle between the mirrors, not a disc around it — and that
 * is very likely wrong, so read the rest of this before building on it.
 *
 * Kaleidoscopes are built both ways: a dry cell whose walls *are* the three
 * mirrors, with a pane at either end, or a round object cell capping a
 * cylindrical tube with the mirror triangle inscribed in it. The second is the
 * common one. This is the first.
 *
 * It was chosen on a measurement that does not support it. A disc around the
 * triangle was tried and came out with the triangle between 0% and 4% covered,
 * the glass falling into the crescent below the view — but that was measured
 * with *ten pieces in the cell*. What it showed is that a nearly empty disc
 * behaves badly, which is not the same as a disc behaving badly. A real object
 * cell is packed, which is why a real kaleidoscope never shows bare margins.
 *
 * The bare margins this build does show — a strip along whichever wall the
 * heap has fallen away from — are the same fact from the other side: the
 * chamber is under-filled, and the triangular cell hides it by shrinking the
 * space rather than fixing it. See ROADMAP.md, "Make the chamber round".
 */
export const CHAMBER_RADIUS = 1.15;

/**
 * Distance from the middle of the cell to each of its walls.
 *
 * Half the circumradius, for an equilateral triangle.
 */
const WALL = CHAMBER_RADIUS / 2;

/**
 * Which way the cell's three walls face, before the cell is turned.
 *
 * The mirror triangle has its corners towards 90, 210 and 330 degrees — one
 * of them straight down — so the walls between them face 30, 150 and 270.
 */
const FIRST_WALL = Math.PI / 6;
const WALLS = 3;

/**
 * How far into the corners the glass may go, as a share of the circumradius.
 *
 * The corners are taken off. Where two mirrors meet at sixty degrees the glass
 * wedges, and a pile that has settled into one will not come out again: tip the
 * instrument through a right angle and it does not move at all, which takes the
 * whole mechanism with it. Rounded off, the pile rides round the corner the way
 * it used to ride round the barrel.
 *
 * Real dry cells are like this too — the joints where the mirrors meet are
 * taped or glued, and the glass never reaches the corner itself.
 *
 * How far off is a compromise. The mirror triangle runs all the way to its
 * corners, so glass held back to 0.78 of the way left three wedges of bare
 * ground in every reflection — visible, and among the first things anyone
 * notices about the figure. This is 0.84, which fills a useful part of them.
 *
 * Not tuned as finely as that number suggests, and worth saying so. The test
 * that catches a pile which never quite stops creeping sits right at its own
 * threshold here: 0.84 passes it, 0.82 and 0.86 both fail it by about a
 * percent. That is not a boundary, it is noise — the settled arrangement
 * reshuffles and one piece ends up a hair over the line. So this is "further
 * out than it was, and no worse at resting", not an optimum.
 */
const CORNER = 0.84 * CHAMBER_RADIUS;

/** Downward acceleration, in cell units per second squared. */
const GRAVITY = 6;

/** Velocity lost per second to drag and friction. Glass in a chamber is damped. */
const DAMPING = 2.2;

/**
 * Constraint passes per substep.
 *
 * One. The surprising result of Macklin et al., *Small Steps in Physics
 * Simulation* (SCA 2019), is that a large step solved n times converges worse
 * than n small steps solved once each, for the same work — the solver always
 * gets to use the newest contact directions rather than iterating against stale
 * ones. Measured here on a settled pile of thirty pieces, moving from two
 * substeps of three passes to four of one took the deepest overlap between two
 * pieces from 2.2% of a piece's width to 1.3%, made the pile a little more
 * willing to move when tipped, and cost slightly less per frame.
 */
const ITERATIONS = 1;

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

/**
 * Spin below which a chip that has stopped moving is treated as still.
 *
 * Seven degrees a second. A piece wedged in a corner of the cell still creeps
 * by a hair as the solver resolves it, and left to turn that into spin the
 * whole pile rotates very slowly for ever.
 */
const SLEEP_SPIN = 0.12;

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

/**
 * Physics substeps per frame.
 *
 * Where the solver's work goes, rather than into passes over one big step —
 * see {@link ITERATIONS}. Small steps also keep a fast chip from passing
 * through a wall between one look and the next.
 */
const SUBSTEPS = 4;

export interface ChamberUpdate {
  /** Seconds to advance. */
  dt: number;
  /** Angle the cell has been turned to, radians. This is what tips the pile. */
  angle: number;
  /**
   * How far the cell has been turned against the mirrors, in radians.
   *
   * The walls are the mirrors and the mirrors do not move, so seen from inside
   * the cell — which is the frame everything here is in — they turn backwards
   * by this as the cell is turned. Which corner of the triangle is the low one
   * therefore changes as the tube is turned, and that is what makes turning it
   * tip the pile from corner to corner.
   */
  bounds?: number | undefined;
}

/**
 * Advances the chips in place.
 *
 * Position based: each substep predicts where the glass would go, then resolves
 * overlaps and the wall by moving positions and angles directly, and finally
 * reads velocity and spin back off how far each chip actually travelled and
 * turned. Resolving contacts with impulses instead leaves a pile creeping
 * forever, because gravity keeps feeding in velocity that the contacts never
 * fully take out; here a chip that is held in place simply records no movement,
 * and so comes to rest.
 */
export function updateChamber(shards: Shard[], { dt, angle, bounds = 0 }: ChamberUpdate): void {
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
      previousAngle.set(shard, shard.rotation);

      shard.vx = (shard.vx + gravityX * step) * damping;
      shard.vy = (shard.vy + gravityY * step) * damping;
      shard.x += shard.vx * step;
      shard.y += shard.vy * step;
      // Advanced here rather than at the end of the pass, so the contacts below
      // can turn a piece and have that turn read back as spin.
      shard.rotation += shard.spin * step;
    }

    for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
      separate(shards);

      for (const shard of shards) {
        confine(shard, bounds);
      }
    }

    for (const shard of shards) {
      shard.vx = (shard.x - (previousX.get(shard) ?? shard.x)) / step;
      shard.vy = (shard.y - (previousY.get(shard) ?? shard.y)) / step;
      shard.spin = (shard.rotation - (previousAngle.get(shard) ?? shard.rotation)) / step;
    }

    tumble(shards, bounds);

    for (const shard of shards) {
      // A settled pile still creeps by a hair each frame, and left to turn that
      // into spin the whole field slowly rotates on a table.
      if (Math.hypot(shard.vx, shard.vy) < SLEEP_SPEED) {
        shard.vx = 0;
        shard.vy = 0;

        if (Math.abs(shard.spin) < SLEEP_SPIN) {
          shard.spin = 0;
        }
      }

      shard.spin *= angularDamping;
    }
  }
}

/** Mass: the area of the glass, not of the circle it was cut from. */
function mass(shard: Shard): number {
  return shard.shape.bulk * shard.radius * shard.radius;
}

/**
 * How hard the piece is to turn.
 *
 * A separate question from how hard it is to shift, and what makes a contact
 * away from a piece's middle lay it down rather than only push it along.
 */
function inertia(shard: Shard): number {
  return mass(shard) * shard.shape.gyration * shard.radius * shard.radius;
}

/** Scratch space, so the solver allocates nothing per frame. */
const previousX = new WeakMap<Shard, number>();
const previousY = new WeakMap<Shard, number>();
const previousAngle = new WeakMap<Shard, number>();
const here = { x: 0, y: 0, r: 0 };
const there = { x: 0, y: 0, r: 0 };

/** How far apart two pieces are, squared. */
function apart(a: Shard, b: Shard): number {
  return (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
}

/**
 * Where one of a piece's circles sits in the chamber.
 *
 * A piece that is a single circle on its own middle is where it is, whatever
 * angle it is at — which is most of them, since the drawn shapes and any
 * roundish cut come out that way, and it is worth not paying for a rotation
 * they cannot feel.
 */
function place(
  shard: Shard,
  bead: Bead,
  cos: number,
  sin: number,
  into: { x: number; y: number; r: number },
): void {
  const alongX = bead.x * shard.radius;
  const alongY = bead.y * shard.radius;

  into.x = shard.x + alongX * cos - alongY * sin;
  into.y = shard.y + alongX * sin + alongY * cos;
  into.r = bead.radius * shard.radius;
}

/** Cosine of a piece's angle, or 1 where nothing about it can turn. */
function turnedCos(shard: Shard): number {
  return shard.shape.beads.length > 1 ? Math.cos(shard.rotation) : 1;
}

/** Sine of the same, and 0 for the same reason. */
function turnedSin(shard: Shard): number {
  return shard.shape.beads.length > 1 ? Math.sin(shard.rotation) : 0;
}

/**
 * Pushes overlapping pieces apart, and holds the contact against sliding while
 * they are pressed together.
 *
 * The push is shared out by weight rather than halved, and part of it goes into
 * turning rather than shifting. A splinter that lands on a bead should be the
 * one that moves; splitting the correction evenly shoves the bead just as far,
 * and a chamber of mixed sizes then behaves as though every piece weighed the
 * same — which is the thing that reads most plainly as "not glass". Mass goes
 * with area, so a piece twice across is four times as hard to shift.
 */
function separate(shards: Shard[]): void {
  for (let i = 0; i < shards.length; i += 1) {
    const a = shards[i]!;

    for (let j = i + 1; j < shards.length; j += 1) {
      const b = shards[j]!;

      // Broad phase on the circles the two were cut to fit, which contain every
      // one of their own circles. Squared, to keep a root out of the innermost
      // thing the chamber does.
      if (apart(a, b) >= (a.radius + b.radius) ** 2) {
        continue;
      }

      // Read afresh for each pair: the solver turns pieces as it goes.
      const cosA = turnedCos(a);
      const sinA = turnedSin(a);
      const cosB = turnedCos(b);
      const sinB = turnedSin(b);

      for (const beadA of a.shape.beads) {
        for (const beadB of b.shape.beads) {
          place(a, beadA, cosA, sinA, here);
          place(b, beadB, cosB, sinB, there);
          touch(a, b);
        }
      }
    }
  }
}

/** Resolves one pair of circles, both of them free to move and to turn. */
function touch(a: Shard, b: Shard): void {
  const dx = there.x - here.x;
  const dy = there.y - here.y;
  const distance = Math.hypot(dx, dy);
  const minimum = here.r + there.r;

  if (distance >= minimum || distance === 0) {
    return;
  }

  const normalX = dx / distance;
  const normalY = dy / distance;
  const overlap = (minimum - distance) * SEPARATION;
  // Where the two surfaces meet, and how far that is from each piece's middle:
  // a push that lands off the middle turns the piece as well as moving it.
  const contactX = here.x + normalX * here.r;
  const contactY = here.y + normalY * here.r;
  const armAX = contactX - a.x;
  const armAY = contactY - a.y;
  const armBX = contactX - b.x;
  const armBY = contactY - b.y;

  apply(a, b, armAX, armAY, armBX, armBY, normalX, normalY, overlap);
  hold(a, b, armAX, armAY, armBX, armBY, normalX, normalY, overlap);
}

/**
 * Moves and turns two pieces apart along a direction, sharing the correction by
 * how hard each is to move and to turn.
 *
 * @param push How far apart the two want to end up, along `(dirX, dirY)`.
 */
function apply(
  a: Shard,
  b: Shard,
  armAX: number,
  armAY: number,
  armBX: number,
  armBY: number,
  dirX: number,
  dirY: number,
  push: number,
): void {
  const turnA = armAX * dirY - armAY * dirX;
  const turnB = armBX * dirY - armBY * dirX;
  const shiftA = 1 / mass(a);
  const shiftB = 1 / mass(b);
  const twistA = 1 / inertia(a);
  const twistB = 1 / inertia(b);
  const share = shiftA + turnA * turnA * twistA + shiftB + turnB * turnB * twistB;

  if (!(share > 0)) {
    return;
  }

  const amount = push / share;

  a.x -= dirX * amount * shiftA;
  a.y -= dirY * amount * shiftA;
  a.rotation -= amount * turnA * twistA;
  b.x += dirX * amount * shiftB;
  b.y += dirY * amount * shiftB;
  b.rotation += amount * turnB * twistB;
}

/**
 * Resists sliding at a contact, up to what the contact can hold.
 *
 * The two pieces have moved and turned since the substep began; whatever part
 * of that was across the contact rather than into it is sliding, and a dry
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
  armAX: number,
  armAY: number,
  armBX: number,
  armBY: number,
  normalX: number,
  normalY: number,
  overlap: number,
): void {
  const movedX = travelledX(a, armAY) - travelledX(b, armBY);
  const movedY = travelledY(a, armAX) - travelledY(b, armBX);
  // Only the part across the contact. What went into it is the overlap, and
  // that has already been dealt with.
  const into = movedX * normalX + movedY * normalY;
  const slideX = movedX - into * normalX;
  const slideY = movedY - into * normalY;
  const slide = Math.hypot(slideX, slideY);

  if (slide === 0) {
    return;
  }

  apply(
    a,
    b,
    armAX,
    armAY,
    armBX,
    armBY,
    slideX / slide,
    slideY / slide,
    Math.min(slide, STATIC_FRICTION * overlap),
  );
}

/** How far a point on a piece has travelled this substep, to first order. */
function travelledX(shard: Shard, armY: number): number {
  const turned = shard.rotation - (previousAngle.get(shard) ?? shard.rotation);

  return shard.x - (previousX.get(shard) ?? shard.x) - turned * armY;
}

function travelledY(shard: Shard, armX: number): number {
  const turned = shard.rotation - (previousAngle.get(shard) ?? shard.rotation);

  return shard.y - (previousY.get(shard) ?? shard.y) + turned * armX;
}

/** Keeps a piece inside the three mirrors, and lets them grip it. */
function confine(shard: Shard, bounds: number): void {
  const cos = turnedCos(shard);
  const sin = turnedSin(shard);

  for (let wall = 0; wall < WALLS; wall += 1) {
    const facing = FIRST_WALL + (wall * 2 * Math.PI) / WALLS - bounds;
    const normalX = Math.cos(facing);
    const normalY = Math.sin(facing);

    for (const bead of shard.shape.beads) {
      place(shard, bead, cos, sin, here);

      if (!pressFlat(shard, normalX, normalY)) {
        return;
      }
    }
  }

  for (const bead of shard.shape.beads) {
    place(shard, bead, cos, sin, here);

    if (!pressRound(shard)) {
      return;
    }
  }
}

/**
 * Presses the bead in `here` back inside one of the mirrors.
 *
 * @returns False when the piece is too big for the cell to hold at all, which
 *   leaves it in the middle and is the end of the matter.
 */
function pressFlat(shard: Shard, normalX: number, normalY: number): boolean {
  if (WALL - here.r <= 0) {
    shard.x = 0;
    shard.y = 0;
    return false;
  }

  const beyond = here.x * normalX + here.y * normalY - WALL;
  const overlap = beyond + here.r;

  if (overlap > 0) {
    // Where the circle meets the mirror: where it is pressed, and what it turns
    // about.
    grip(shard, here.x - beyond * normalX, here.y - beyond * normalY, normalX, normalY, overlap);
  }

  return true;
}

/** The same, against the arc that takes the corners off. */
function pressRound(shard: Shard): boolean {
  const limit = CORNER - here.r;

  if (limit <= 0) {
    shard.x = 0;
    shard.y = 0;
    return false;
  }

  const distance = Math.hypot(here.x, here.y);

  if (distance <= limit || distance === 0) {
    return true;
  }

  const normalX = here.x / distance;
  const normalY = here.y / distance;

  grip(shard, normalX * CORNER, normalY * CORNER, normalX, normalY, distance - limit);

  return true;
}

/**
 * Pushes a piece off a wall and lets the wall hold it against sliding.
 *
 * The wall does not move, so it takes the whole of the correction rather than a
 * share, and the whole of the friction. Without the friction the glass slides
 * along the mirrors as freely as it falls, and a heap against one runs away
 * downhill.
 */
function grip(
  shard: Shard,
  touchX: number,
  touchY: number,
  normalX: number,
  normalY: number,
  overlap: number,
): void {
  const armX = touchX - shard.x;
  const armY = touchY - shard.y;

  against(shard, armX, armY, normalX, normalY, overlap);

  const movedX = travelledX(shard, armY);
  const movedY = travelledY(shard, armX);
  const into = movedX * normalX + movedY * normalY;
  const slideX = movedX - into * normalX;
  const slideY = movedY - into * normalY;
  const slide = Math.hypot(slideX, slideY);

  if (slide > 0) {
    against(
      shard,
      armX,
      armY,
      slideX / slide,
      slideY / slide,
      Math.min(slide, STATIC_FRICTION * overlap),
    );
  }
}

/** The one-sided form of {@link apply}, against something that cannot move. */
function against(
  shard: Shard,
  armX: number,
  armY: number,
  dirX: number,
  dirY: number,
  push: number,
): void {
  const turn = armX * dirY - armY * dirX;
  const shift = 1 / mass(shard);
  const twist = 1 / inertia(shard);
  const share = shift + turn * turn * twist;

  if (!(share > 0)) {
    return;
  }

  const amount = push / share;

  shard.x -= dirX * amount * shift;
  shard.y -= dirY * amount * shift;
  shard.rotation -= amount * turn * twist;
}

/**
 * Turns sliding at the contacts into spin.
 *
 * A piece is a body, not a point, so a rub that lands off its middle turns it —
 * which is the whole of tumbling. Sliding down the wall sets a piece rolling, a
 * glancing blow spins both the same way, and a piece pinned in the pile stops
 * turning because its contacts have nothing left to slide against.
 *
 * Each contact removes a fraction of the tangential slip — the relative speed of
 * the two surfaces where they touch — with an impulse along the tangent. How
 * much of that impulse a piece feels depends on how far the contact is from its
 * middle: for a disc touched at its rim the arithmetic comes out at three times
 * the plain mass, which is where the old thirds came from and why the radius
 * used to cancel.
 */
function tumble(shards: Shard[], bounds: number): void {
  for (let i = 0; i < shards.length; i += 1) {
    const a = shards[i]!;

    for (let j = i + 1; j < shards.length; j += 1) {
      const b = shards[j]!;

      if (apart(a, b) > (a.radius + b.radius + CONTACT_SLOP) ** 2) {
        continue;
      }

      const cosA = turnedCos(a);
      const sinA = turnedSin(a);
      const cosB = turnedCos(b);
      const sinB = turnedSin(b);

      for (const beadA of a.shape.beads) {
        for (const beadB of b.shape.beads) {
          place(a, beadA, cosA, sinA, here);
          place(b, beadB, cosB, sinB, there);
          rub(a, b);
        }
      }
    }
  }

  for (const shard of shards) {
    const cos = turnedCos(shard);
    const sin = turnedSin(shard);

    for (let wall = 0; wall <= WALLS; wall += 1) {
      const facing = FIRST_WALL + (wall * 2 * Math.PI) / WALLS - bounds;
      const flat = wall < WALLS;
      const normalX = Math.cos(facing);
      const normalY = Math.sin(facing);

      for (const bead of shard.shape.beads) {
        place(shard, bead, cos, sin, here);

        // The last time round is the arc across the corners, whose normal is
        // wherever the piece happens to be rather than a fixed direction.
        const distance = Math.hypot(here.x, here.y);
        const outX = flat ? normalX : distance === 0 ? 0 : here.x / distance;
        const outY = flat ? normalY : distance === 0 ? 1 : here.y / distance;
        const reach = flat ? WALL : CORNER;
        const beyond = here.x * outX + here.y * outY - reach;

        if (beyond + here.r < -CONTACT_SLOP) {
          continue;
        }

        // The mirror is fixed, so its surface contributes nothing to the slip.
        const armX = here.x - beyond * outX - shard.x;
        const armY = here.y - beyond * outY - shard.y;
        const tangentX = -outY;
        const tangentY = outX;
        const turn = armX * tangentY - armY * tangentX;
        const shift = 1 / mass(shard);
        const twist = 1 / inertia(shard);
        // How fast the piece's surface is moving across the mirror: its travel
        // plus whatever its own spin adds where it touches.
        const slip = shard.vx * tangentX + shard.vy * tangentY + shard.spin * turn;
        const share = shift + turn * turn * twist;

        if (slip === 0 || share === 0) {
          continue;
        }

        const impulse = (-FRICTION * slip) / share;

        shard.vx += impulse * tangentX * shift;
        shard.vy += impulse * tangentY * shift;
        shard.spin += impulse * turn * twist;
      }
    }
  }
}

/** One rub between two circles, in velocities rather than positions. */
function rub(a: Shard, b: Shard): void {
  const dx = there.x - here.x;
  const dy = there.y - here.y;
  const distance = Math.hypot(dx, dy);

  if (distance === 0 || distance > here.r + there.r + CONTACT_SLOP) {
    return;
  }

  const normalX = dx / distance;
  const normalY = dy / distance;
  // Tangent at the contact: perpendicular to the line of centres.
  const tangentX = -normalY;
  const tangentY = normalX;
  const contactX = here.x + normalX * here.r;
  const contactY = here.y + normalY * here.r;
  const armAX = contactX - a.x;
  const armAY = contactY - a.y;
  const armBX = contactX - b.x;
  const armBY = contactY - b.y;
  const turnA = armAX * tangentY - armAY * tangentX;
  const turnB = armBX * tangentY - armBY * tangentX;
  // Each surface point carries its body's spin as well as its travel.
  const slip =
    (b.vx - a.vx) * tangentX + (b.vy - a.vy) * tangentY + b.spin * turnB - a.spin * turnA;

  if (slip === 0) {
    return;
  }

  const shiftA = 1 / mass(a);
  const shiftB = 1 / mass(b);
  const twistA = 1 / inertia(a);
  const twistB = 1 / inertia(b);
  const share = shiftA + turnA * turnA * twistA + shiftB + turnB * turnB * twistB;

  if (share === 0) {
    return;
  }

  const impulse = (-FRICTION * slip) / share;

  a.vx -= impulse * tangentX * shiftA;
  a.vy -= impulse * tangentY * shiftA;
  a.spin -= impulse * turnA * twistA;
  b.vx += impulse * tangentX * shiftB;
  b.vy += impulse * tangentY * shiftB;
  b.spin += impulse * turnB * twistB;
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
export function settleChamber(shards: Shard[], angle = 0, maxSeconds = 12, bounds = 0): void {
  const step = 1 / 60;
  const checkEvery = 15;

  for (let frame = 0; frame < maxSeconds / step; frame += 1) {
    updateChamber(shards, { dt: step, angle, bounds });

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
