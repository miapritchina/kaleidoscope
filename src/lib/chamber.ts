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
 * Radius of the cell, in cell units.
 *
 * The cell is round: a cylindrical tube with the mirror triangle inscribed in
 * it and a round object cell capping the end, which is how most kaleidoscopes
 * are built. The renderer maps this radius onto the triangle's circumradius,
 * so the corners of the view touch the wall, everything the mirrors can see is
 * simulated, and the glass beyond a mirror is the glass that would sit behind
 * it in a real tube.
 *
 * It used to be a triangle whose walls were the mirrors — a real but less
 * common construction, chosen on a measurement that did not support it: a disc
 * tried with *ten pieces in it* came out nearly bare, which shows that an
 * empty disc behaves badly, not that a disc does. A circle holds no direction
 * specially, so no wall can be the one the heap has fallen away from — the
 * bare strip that was the triangular cell's photographed defect — and the
 * sixty-degree corners the glass used to wedge into are gone, along with the
 * rounding-off that compromise needed. What the circle asks in exchange is
 * glass: the triangle is 41% of the disc, so the cell only reads as full when
 * it holds more than twice the pieces the triangle needed. See ROADMAP.md,
 * "Make the chamber round".
 */
export const CHAMBER_RADIUS = 1.15;

/**
 * The size of piece a medium's drag is quoted for, in cell units.
 *
 * "Normal size", and the middle the glass is cut around — see `PIECE_MIDDLE`
 * in `lib/scene.ts`, which is this. A piece of exactly this size feels exactly
 * {@link Medium.drag}; everything else is scaled off it by
 * {@link Medium.dragBySize}.
 */
export const REFERENCE_PIECE = 0.08;

/**
 * How far the size scaling is allowed to run, either way.
 *
 * A grain a tenth of normal would otherwise be given ten times the drag and
 * stop dead in the fluid, which reads as glass glued to the picture rather
 * than as glass too light to fall. The cap is where the model stops being
 * worth trusting, not where the arithmetic breaks.
 */
const DRAG_SIZE_LIMIT = 3;

/**
 * Downward acceleration, in cell units per second squared.
 *
 * The room's pull, not the cell's. What a piece actually falls under is less
 * than this in anything but air, because the fluid it displaces holds part of
 * its weight up — see {@link Medium.density}.
 */
const GRAVITY = 6;

/**
 * What the cell is filled with.
 *
 * A kaleidoscope's object cell is not always dry. Plenty of real ones suspend
 * the glass in oil, and it is a different instrument to hold: the pieces sink
 * instead of falling, they keep sweeping round after the tube has stopped, and
 * a pile that does form lies flatter, because wet glass slides.
 *
 * None of that is a new solver. It is this one told what the glass is moving
 * through — a density to weigh the pieces against, a drag to spend their speed
 * on, a body of fluid that has to be dragged round with the cell, and contacts
 * that hold less. The dry cell is {@link AIR}, and every number in it is the
 * number this chamber has always used, so a cell filled with nothing behaves
 * exactly as it did before there was anything to fill it with.
 */
export interface Medium {
  /** Which cell this is, for anything that has to tell them apart. */
  readonly id: 'air' | 'liquid';
  /**
   * Density of the fluid, as a fraction of the glass's own.
   *
   * Archimedes: a piece is held up by the weight of what it displaces, so it
   * falls under `1 - density` of its own weight. Glass is about two and a half
   * times water and a light oil about nine tenths of it, which leaves a third
   * of the pull behind; a gel is heavier still and takes nearly all of it.
   *
   * Air is nought here rather than the twelve ten-thousandths it really is.
   * Buoyancy in air is a part in two thousand — finer than any other number in
   * this file is meant to be — and writing it as nought is what makes the dry
   * cell provably untouched by any of this rather than merely close to it.
   */
  readonly density: number;
  /**
   * Velocity lost per second to the fluid, by a piece of {@link REFERENCE_PIECE}
   * size.
   *
   * Quoted at a size because in a fluid the size is half the answer — see
   * {@link Medium.dragBySize}.
   */
  readonly drag: number;
  /**
   * How much a piece's own size tells on the drag it feels, 0 to 1.
   *
   * **Big pieces sink faster, and it is the drag that says so rather than the
   * weight.** Gravity is an acceleration, so on its own it moves a boulder and
   * a grain at exactly the same rate — Galileo's point, and the reason a cell
   * of glass in air really does fall as one. In a fluid it is different: the
   * resistance goes with how much surface is pushing through the liquid while
   * the weight goes with how much piece there is, so the big ones win. Take a
   * disc of radius r: drag force goes as `r · v` and mass as `r²`, so the drag
   * *rate* goes as `1 / r` and the speed a piece settles at goes as `r`. Twice
   * across, twice as fast down.
   *
   * Nought for air, where the damping stands for the chamber rattling energy
   * out of the glass rather than for air resistance, which glass this size does
   * not feel. One for a liquid, where it is the whole story.
   */
  readonly dragBySize: number;
  /** Spin lost per second. A chip wedged in a full chamber does not twirl on. */
  readonly angularDrag: number;
  /**
   * How fast the body of fluid takes up the cell's own turning, per second.
   *
   * A liquid does not turn with the tube. It lags while the tube is turning,
   * and then carries on after it has stopped, sweeping the glass round with
   * it — which is most of what tells a hand it is holding a wet cell rather
   * than a dry one, and it is this one number.
   *
   * Nought means the cell holds nothing worth modelling and its contents
   * simply turn with it. That is the dry cell, and it is exempt here rather
   * than approximated: a large number would leave a whisper of swirl behind on
   * a fast display and change the chamber that was tuned.
   */
  readonly stir: number;
  /** How much of the sliding at a contact is turned into spin, per pass. */
  readonly friction: number;
  /**
   * How much sideways movement a contact will hold on to, against how hard the
   * two pieces are being pressed together.
   *
   * This is what gives a pile an angle of repose. Resolving only the overlap
   * leaves the glass free to slide across whatever it is resting on, so a heap
   * spreads until it is flat and the least tip sets the whole thing flowing.
   * Holding the contact against sideways motion up to this share of the
   * separation gives a heap that stands at a slope, holds through a small tip,
   * and lets go all at once past a critical one. That is what an avalanche is.
   */
  readonly staticFriction: number;
  /**
   * Speed below which a chip is treated as at rest, so piles stop jittering.
   *
   * Nought in a liquid, and deliberately. A suspended piece is never at rest,
   * and a threshold that caught a slow sink would freeze the cell solid —
   * which is the one thing a liquid cell must never do.
   */
  readonly sleepSpeed: number;
  /** Spin below which a chip that has stopped moving is treated as still. */
  readonly sleepSpin: number;
  /** How long a fresh cell is given to come to rest before it is shown. */
  readonly settleSeconds: number;
}

/** The dry cell: loose glass in air, which is what this chamber has always been. */
export const AIR: Medium = {
  id: 'air',
  // See Medium.density. Nought, not the true twelve ten-thousandths, so that
  // the dry cell is exactly the chamber that was tuned.
  density: 0,
  drag: 2.2,
  // Glass in air falls as one, whatever size it is cut to. See
  // Medium.dragBySize — the damping here is the pile rattling energy out of
  // itself, not the air getting in the way.
  dragBySize: 0,
  angularDrag: 2.6,
  // Nothing in there to stir. What lags in a dry cell is the glass itself, and
  // that is already the solver's business.
  stir: 0,
  // Glass on glass is not slippery: a chip dragged down the wall or across the
  // pile rolls rather than skids, and it is the rolling that reads as tumbling.
  friction: 0.55,
  // Coulomb's number for glass on glass is around 0.4 dry, and the pieces here
  // are ground and faceted rather than polished spheres.
  staticFriction: 0.45,
  sleepSpeed: 0.012,
  // Seven degrees a second. A piece wedged against the wall still creeps by a
  // hair as the solver resolves it, and left to turn that into spin the whole
  // pile rotates very slowly for ever.
  sleepSpin: 0.12,
  // A backstop rather than a duration: a dry pile is settled the moment it
  // stops moving, and this is only what a chamber too tightly packed to ever
  // stop is allowed to cost.
  settleSeconds: 12,
};

/**
 * The liquid cell, from a thin oil at 0 to a gel at 1.
 *
 * Both ends are the same fluid described in the same three terms, and the
 * whole of the difference between them is how much of the glass's weight the
 * fluid carries and how fast it takes the rest of it back. In the oil a piece
 * crosses the cell in a few seconds; in the gel it hangs, and what moves is
 * the swirl when the tube is turned.
 *
 * The contacts soften along with it, which is the part that is easy to leave
 * out and reads wrong when it is missing: a wet heap has a much lower angle of
 * repose than a dry one, so glass that has reached the bottom of an oil cell
 * lies in a shallow drift rather than standing in a dry slope.
 */
export function liquidCell(thickness: number): Medium {
  const at = Math.min(1, Math.max(0, thickness));

  return {
    id: 'liquid',
    // Light oil against glass, up to a gel that all but floats it.
    density: mix(0.36, 0.88, at),
    drag: mix(6, 16, at),
    // The whole story in a fluid: a splinter hangs where a chunk sinks past it.
    dragBySize: 1,
    angularDrag: mix(7, 18, at),
    // Thicker fluid grips the wall harder, so it takes up a turn sooner and
    // gives it back over longer.
    stir: mix(1.6, 3.5, at),
    friction: mix(0.3, 0.45, at),
    staticFriction: mix(0.18, 0.3, at),
    // Nothing sleeps in a liquid. See Medium.sleepSpeed.
    sleepSpeed: 0,
    sleepSpin: 0,
    // Long enough to push the pieces out of each other, and no longer. A
    // liquid cell settled properly would open with all its glass lying on the
    // floor, which is the one arrangement it is worth opening on.
    settleSeconds: 1.2,
  };
}

/**
 * The fluid a fresh liquid cell is unpacked in.
 *
 * Building a cell asks the fluid for one thing only — push the glass out of
 * itself — and every thickness does that in the same second and a bit. So the
 * arrangement a liquid cell opens on does not depend on where the thickness
 * slider happens to be, which is what lets that slider move without rebuilding
 * and resettling the whole pile under the finger. Whatever it is set to takes
 * over on the next frame.
 */
export const FRESH_LIQUID = liquidCell(0.5);

function mix(from: number, to: number, at: number): number {
  return from + (to - from) * at;
}

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

/** Gap at which two surfaces still count as touching, in cell units. */
const CONTACT_SLOP = 0.01;

/** Fraction of an overlap resolved per pass. Below 1 the pile settles softly. */
const SEPARATION = 0.8;

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
  /** What the cell is filled with. Left out, it is the dry one. */
  medium?: Medium;
  /**
   * How fast the fluid is turning within the cell, in radians per second.
   *
   * The cell's own frame, so this is what is left over after the tube's turn
   * has been taken off: nought while the fluid is riding round with the tube,
   * negative at the start of a turn while it is still holding still, and
   * positive after the tube has stopped and the fluid has not. See
   * {@link advanceFlow}, which is what works it out.
   */
  swirl?: number;
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
export function updateChamber(
  shards: Shard[],
  { dt, angle, medium = AIR, swirl = 0 }: ChamberUpdate,
): void {
  if (dt <= 0 || shards.length === 0) {
    return;
  }

  filled = medium;

  const step = dt / SUBSTEPS;
  // World down (+y on screen) expressed in the cell's own frame.
  //
  // The renderer draws the cell rotated by `angle`, so its axes are turned by
  // `+angle` against the screen and world down has to be turned back by the same
  // amount to land in them. Sign this the other way — the easy mistake, since it
  // looks like "undo the rotation" — and gravity sweeps the cell at twice the
  // turn rate instead of holding still: a quarter turn puts the pile at the top
  // of the screen, and the whole mechanism reads as no gravity at all.
  // What is left of the pull once the fluid has taken its share of the weight.
  const weight = GRAVITY * (1 - medium.density);
  const gravityX = Math.sin(angle) * weight;
  const gravityY = Math.cos(angle) * weight;
  const angularDamping = Math.max(0, 1 - medium.angularDrag * step);
  // A cell with nothing in it to turn has no swirl to speak of, whatever it is
  // handed. See Medium.stir.
  const flow = medium.stir > 0 ? swirl : 0;

  for (let pass = 0; pass < SUBSTEPS; pass += 1) {
    for (const shard of shards) {
      previousX.set(shard, shard.x);
      previousY.set(shard, shard.y);
      previousAngle.set(shard, shard.rotation);

      // Drag is against the fluid rather than against the cell: a piece adrift
      // in a swirl is carried round by it, and one already travelling with it
      // feels no drag at all. In the dry cell `flow` is nought and this is the
      // plain damping it has always been.
      const flowX = -flow * shard.y;
      const flowY = flow * shard.x;
      const damping = dampingFor(shard, medium, step);

      shard.vx = flowX + (shard.vx + gravityX * step - flowX) * damping;
      shard.vy = flowY + (shard.vy + gravityY * step - flowY) * damping;
      shard.x += shard.vx * step;
      shard.y += shard.vy * step;
      // Advanced here rather than at the end of the pass, so the contacts below
      // can turn a piece and have that turn read back as spin.
      shard.rotation += shard.spin * step;
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
      shard.spin = (shard.rotation - (previousAngle.get(shard) ?? shard.rotation)) / step;
    }

    tumble(shards);

    for (const shard of shards) {
      // A settled pile still creeps by a hair each frame, and left to turn that
      // into spin the whole field slowly rotates on a table.
      if (Math.hypot(shard.vx, shard.vy) < medium.sleepSpeed) {
        shard.vx = 0;
        shard.vy = 0;

        if (Math.abs(shard.spin) < medium.sleepSpin) {
          shard.spin = 0;
        }
      }

      // A turning fluid turns the pieces in it as well as carrying them round.
      shard.spin = flow + (shard.spin - flow) * angularDamping;
    }
  }
}

/**
 * Advances the body of fluid the cell holds.
 *
 * The fluid is one number — how fast the whole of it is turning — and the wall
 * drags it towards the tube's own rate. That is enough for what a wet cell
 * looks like, because the two things worth seeing are both in the lag: start
 * turning and the glass hangs back, stop and it sails on. A cylinder of liquid
 * spun about its axis does end up turning as one body, so a single rate is
 * where this is heading anyway; what it leaves out is the spin-up profile
 * across the radius, which nothing in a chamber this size would show.
 *
 * @param flow The fluid's current rate, radians per second, in the world's
 *   frame rather than the cell's.
 * @param dt Seconds to advance.
 * @param turn How fast the cell itself is being turned, radians per second.
 * @returns The fluid's new rate. Subtract `turn` from it for the swirl
 *   {@link updateChamber} wants, which is the same thing seen from the cell.
 */
export function advanceFlow(flow: number, dt: number, turn: number, medium: Medium): number {
  // Nothing in there to lag behind: the dry cell's contents turn with it, so
  // the swirl this produces is exactly nought rather than nearly it.
  if (medium.stir <= 0) {
    return turn;
  }

  // A paused cell keeps whatever it had. Folding it onto the tube instead
  // would quietly drain the swirl while nothing was being drawn.
  if (dt <= 0) {
    return flow;
  }

  return flow + (turn - flow) * Math.min(1, medium.stir * dt);
}

/**
 * What fraction of its speed a piece keeps across one substep.
 *
 * Uniform in air, and a matter of size in a fluid: see {@link Medium.dragBySize}
 * for why the rate goes as one over the radius, and so why a big piece settles
 * at a speed a small one never reaches.
 */
function dampingFor(shard: Shard, medium: Medium, step: number): number {
  let rate = medium.drag;

  if (medium.dragBySize > 0 && shard.radius > 0) {
    const bySize = Math.min(
      DRAG_SIZE_LIMIT,
      Math.max(1 / DRAG_SIZE_LIMIT, REFERENCE_PIECE / shard.radius),
    );

    rate *= 1 + (bySize - 1) * medium.dragBySize;
  }

  return Math.max(0, 1 - rate * step);
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

/**
 * What the cell is filled with, for the pass in progress.
 *
 * Scratch, like the two circles below: the contacts want it several calls deep
 * and threading it through every one of them would be a parameter added to
 * nine functions to carry a value that never changes within a pass.
 */
let filled: Medium = AIR;

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
 * The pieces ordered by the left edge of the circle each was cut to fit — the
 * broad phase, kept between calls so keeping it ordered is nearly free.
 *
 * The pair loops are the solver's square: every piece against every other,
 * fifty-two times the work for thirteen times the glass. A pruned pair is only
 * worth pruning if skipping it costs less than the two subtractions and a
 * compare it would have cost to test — a uniform grid built here once pruned
 * 71% of pairs and was still slower than no pruning at all, because every pair
 * it *kept* went through a visitor callback (see ROADMAP.md, "Two things that
 * were tried and did not work"). So the traversal is inlined into the pair
 * loops instead: swept in this order, a piece is tested only against
 * neighbours until the first whose left edge starts beyond its right, and the
 * rest of the row is skipped in one `break`.
 */
let sweep: Shard[] = [];

/** Whose pieces {@link sweep} currently holds. */
let swept: Shard[] | null = null;

/**
 * Brings {@link sweep} up to date with where the glass is now.
 *
 * Insertion sort, deliberately: the pile barely moves between passes, so the
 * order is already almost right and one comparison per piece settles most of
 * it. The identity check is what detects a different chamber — a scene's array
 * is replaced when its glass is, never grown in place.
 */
function order(shards: Shard[]): void {
  if (swept !== shards || sweep.length !== shards.length) {
    swept = shards;
    sweep = shards.slice();
  }

  for (let i = 1; i < sweep.length; i += 1) {
    const shard = sweep[i]!;
    const edge = shard.x - shard.radius;
    let j = i - 1;

    while (j >= 0 && sweep[j]!.x - sweep[j]!.radius > edge) {
      sweep[j + 1] = sweep[j]!;
      j -= 1;
    }

    sweep[j + 1] = shard;
  }
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
  order(shards);

  for (let i = 0; i < sweep.length; i += 1) {
    const a = sweep[i]!;
    const reach = a.x + a.radius;

    for (let j = i + 1; j < sweep.length; j += 1) {
      const b = sweep[j]!;

      // The sweep: sorted by left edge, the first piece that starts beyond
      // this one's right edge ends the row.
      if (b.x - b.radius >= reach) {
        break;
      }

      // Then on the circles the two were cut to fit, which contain every one
      // of their own circles. Squared, to keep a root out of the innermost
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
 * contact takes some of it back. Capped at the medium's
 * {@link Medium.staticFriction} times how hard they are being pressed together, so a piece high on a steep heap still
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
    Math.min(slide, filled.staticFriction * overlap),
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

/** Keeps a piece inside the cell's wall, and lets the wall grip it. */
function confine(shard: Shard): void {
  const cos = turnedCos(shard);
  const sin = turnedSin(shard);

  for (const bead of shard.shape.beads) {
    place(shard, bead, cos, sin, here);

    if (!press(shard)) {
      return;
    }
  }
}

/**
 * Presses the bead in `here` back inside the wall.
 *
 * @returns False when the piece is too big for the cell to hold at all, which
 *   leaves it in the middle and is the end of the matter.
 */
function press(shard: Shard): boolean {
  const limit = CHAMBER_RADIUS - here.r;

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

  grip(
    shard,
    normalX * CHAMBER_RADIUS,
    normalY * CHAMBER_RADIUS,
    normalX,
    normalY,
    distance - limit,
  );

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
      Math.min(slide, filled.staticFriction * overlap),
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
function tumble(shards: Shard[]): void {
  order(shards);

  for (let i = 0; i < sweep.length; i += 1) {
    const a = sweep[i]!;
    const reach = a.x + a.radius + CONTACT_SLOP;

    for (let j = i + 1; j < sweep.length; j += 1) {
      const b = sweep[j]!;

      if (b.x - b.radius > reach) {
        break;
      }

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

    for (const bead of shard.shape.beads) {
      place(shard, bead, cos, sin, here);

      // The wall is an arc, so its normal is wherever the piece happens to be
      // rather than a fixed direction.
      const distance = Math.hypot(here.x, here.y);
      const outX = distance === 0 ? 0 : here.x / distance;
      const outY = distance === 0 ? 1 : here.y / distance;
      const beyond = distance - CHAMBER_RADIUS;

      if (beyond + here.r < -CONTACT_SLOP) {
        continue;
      }

      // The wall is fixed, so its surface contributes nothing to the slip.
      const armX = here.x - beyond * outX - shard.x;
      const armY = here.y - beyond * outY - shard.y;
      const tangentX = -outY;
      const tangentY = outX;
      const turn = armX * tangentY - armY * tangentX;
      const shift = 1 / mass(shard);
      const twist = 1 / inertia(shard);
      // How fast the piece's surface is moving across the wall: its travel
      // plus whatever its own spin adds where it touches.
      const slip = shard.vx * tangentX + shard.vy * tangentY + shard.spin * turn;
      const share = shift + turn * turn * twist;

      if (slip === 0 || share === 0) {
        continue;
      }

      const impulse = (-filled.friction * slip) / share;

      shard.vx += impulse * tangentX * shift;
      shard.vy += impulse * tangentY * shift;
      shard.spin += impulse * turn * twist;
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

  const impulse = (-filled.friction * slip) / share;

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
export function settleChamber(
  shards: Shard[],
  angle = 0,
  maxSeconds = AIR.settleSeconds,
  medium: Medium = AIR,
): void {
  const step = 1 / 60;
  const checkEvery = 15;

  for (let frame = 0; frame < maxSeconds / step; frame += 1) {
    updateChamber(shards, { dt: step, angle, medium });

    if (frame % checkEvery === checkEvery - 1 && atRest(shards, medium)) {
      return;
    }
  }
}

/**
 * True once nothing is sliding or turning faster than the sleep thresholds.
 *
 * Never, in a liquid: its thresholds are nought, because a piece adrift in oil
 * is not at rest and must not be treated as though it were. So a liquid cell
 * spends its whole (much shorter) cap rather than returning early, which is
 * what {@link Medium.settleSeconds} is sized for.
 */
function atRest(shards: Shard[], medium: Medium): boolean {
  return shards.every(
    (shard) =>
      Math.hypot(shard.vx, shard.vy) <= medium.sleepSpeed &&
      Math.abs(shard.spin) <= medium.sleepSpin,
  );
}
