import { CHAMBER_RADIUS } from './chamber';
import { mulberry32, randomBetween } from './random';

/**
 * A liquid motion timer in the object cell.
 *
 * The desk toy: a sealed tube of two liquids that will not mix, one a shade
 * heavier than the other. Turn it over and the heavy one, now on top, has to
 * get back down — and it cannot go as a slab, because the light one has to come
 * up past it at the same time. So it goes as **beads**. They gather on the
 * underside of the pool overhead, hang, stretch, let go, drift down through the
 * other liquid, and are drawn into the pool that is growing on the floor. A few
 * minutes later it is all at the bottom, level, and still — until it is turned
 * over again.
 *
 * It is a different thing from the lava lamp next to it, and the difference is
 * the point. Lava is a *cycle*: heat drives it and it never settles. This runs
 * **down**. It is a timer, and what starts it is the hand.
 *
 * Three things make the picture, and only the first is obvious.
 *
 * **A surface.** Nothing else in this instrument has one. A pool of liquid at
 * rest is flat, perpendicular to gravity, and cuts the round cell along a
 * chord — and six mirrors fold one straight line into a hexagram. That figure
 * is not available from any pile of glass, at any setting, ever.
 *
 * **Two colours, and neither of them is the one you see most of.** The tube is
 * deep, so there is always some of the light liquid in front of whatever you
 * are looking at: the beads are not their own colour, they are their colour
 * *seen through* the other one. That is the whole of the "colour mix illusion"
 * the toys are sold on, and it is why this is composited with `multiply` — the
 * mixed colour is not chosen anywhere, it falls out of two liquids being
 * transparent.
 *
 * **Metaballs**, borrowed wholesale from `lib/lava.ts` and pointed at a
 * different problem. The pools lay down a field either side of their own
 * surfaces, the beads lay down fields of their own, and everything is drawn
 * where the sum crosses {@link SURFACE}. So a bead about to let go necks off
 * the pool above it, a bead landing is drawn down into the pool below it, and
 * neither of those is animated anywhere — they are what summing fields does.
 *
 * Coordinates are in cell units, centred on the chamber, and gravity arrives in
 * the cell's own frame.
 */
export interface Bead {
  /** Where it is, in cell units. */
  x: number;
  y: number;
  /** How fast, in cell units per second. */
  vx: number;
  vy: number;
  /**
   * How much liquid it is, as an area in cell units.
   *
   * Area rather than a radius because it is the thing that is conserved: what
   * a bead weighs is taken out of the pool it hangs off and given to the pool
   * it lands in, and the sum of the two pools and everything in flight between
   * them does not change.
   */
  area: number;
  /** How far its field reaches. Derived from {@link Bead.area}. */
  reach: number;
  /**
   * How big it lets go at, as an area. Only meaningful while it is filling.
   */
  want: number;
  /** Where along the surface it hangs from, in cell units either side. */
  across: number;
  /**
   * Seconds left of filling from the pool above before it lets go.
   *
   * A drip is not a bead that appears — it is liquid running down into a
   * pendant drop until it is heavy enough to break its own neck. So the
   * next bead is *always* gathering: it is born as the bump the last pinch left
   * behind, grows in place drawing what it grows by out of the pool overhead,
   * hangs lower as it fills, and lets go. The wait between beads is spent
   * hanging rather than spent on a flat surface, which is both what a slow drip
   * looks like and the only way anybody ever sees the drip happen — sampled at
   * a run of instants, a surface that is flat between beads is flat in nearly
   * every one of them.
   */
  filling: number;
  /**
   * Seconds left of being drawn into the pool below; 0 until it has landed.
   *
   * The counterpart, and it exists for the same reason. A bead that reached the
   * floor and was simply deleted would take a visible bite out of the picture
   * on one frame — see the frame-to-frame test in `drops.test.ts`, which is in
   * this repo because exactly that kind of fault got all the way to a phone
   * once already.
   */
  sinking: number;
  /**
   * A bubble of the light liquid rather than a bead of the heavy one.
   *
   * It carries a *negative* field, which is the whole of what it needs: inside
   * the heavy pool the sum drops below the surface and the pool is drawn with a
   * hole in it, and outside the pool it makes no difference at all — which is
   * right, because a bead of the clear liquid adrift in the clear liquid is not
   * a thing anybody can see.
   */
  rising: boolean;
  /** Where in its sideways wander it is, radians. */
  wander: number;
}

export interface Drops {
  /** What the cell was cut from. */
  readonly seed: number;
  /** How much heavy liquid there is altogether, as an area in cell units. */
  readonly heavy: number;
  /** How wide a bead is drawn, in cell units. The pinch is allowed to set it. */
  readonly beadAcross: number;
  /** The light liquid's tint, and the heavy one's. Both transparent. */
  readonly tints: readonly [[number, number, number], [number, number, number]];
  /** Beads on their way down, and bubbles on their way up. */
  beads: Bead[];
  /** Heavy liquid still in the pool overhead, as an area. */
  overhead: number;
  /** Heavy liquid that has reached the floor, as an area. */
  floor: number;
  /** How far down the cell the overhead pool's underside is, in cell units. */
  overheadAt: number;
  /** How far down the cell the floor pool's surface is, in cell units. */
  floorAt: number;
  /** Which way the surfaces lie: down, plus however far the pool is sloshing. */
  downX: number;
  downY: number;
  /** How far the surfaces are off level, radians, and how fast that is moving. */
  lean: number;
  leaning: number;
  /** Which way was down when the cell last came to rest, and last frame. */
  rest: number;
  facing: number;
  /** Whether {@link Drops.rest} and {@link Drops.facing} have been set yet. */
  poured: boolean;
  /**
   * How many beads have been cast so far.
   *
   * Where a bead lets go of the pool and how big it comes out are the only
   * things in here that are not arithmetic, and this is what keeps them
   * repeatable: the same cell run the same way casts the same beads, whatever
   * frame rate it is run at, because the draw is made from the count and not
   * from a clock or a running generator.
   */
  cast: number;
}

/**
 * Cells across the chamber the picture is worked out on.
 *
 * The same hundred and twenty eight the lava uses, for the same reason: the
 * field is smooth and this is not resolving detail, it is deciding how
 * accurately the *surface* lands. It matters more here than there, because a
 * pool's surface is a straight line and the eye reads a wobble in a straight
 * line that it would never see in the edge of a blob.
 */
export const GRID = 128;

/**
 * How many pixels the cell is painted at, per cell of the bead field.
 *
 * The beads are a smooth field and do not want a finer grid; the **pools** are
 * not a field at all — where their surface is, is arithmetic, worked out at
 * the pixel from a chord and a meniscus — so painting them one pixel per cell
 * threw away resolution the cell already had. And a pool's surface is the one
 * edge in this whole instrument that the eye measures: it is *straight*, and a
 * straight line a cell wide at a time is a staircase, plain in a screenshot at
 * anything past the default zoom while the same quantisation in the edge of a
 * bead goes unnoticed. Painted two pixels a cell, with the pools evaluated at
 * each of them, the horizon is a line again.
 */
const FINE = 2;

/** Where a surface is, as a sum of the fields. */
const SURFACE = 0.5;

/**
 * How wide a bead looks against how far its field reaches.
 *
 * `(1 - d²/r²)² = 0.5` puts a lone bead's surface at 0.54 of its reach. Every
 * size in here goes through it — see the note on the same constant in
 * `lib/lava.ts`, where leaving it out filled the cell with dots.
 */
const SEEN = 0.54;

/** How far a pool's field reaches out past its own surface, in cell units. */
const POOL_REACH = 0.14;

/**
 * How far the liquid climbs the wall, in cell units, and how far in it lets go.
 *
 * A meniscus. The heavy liquid wets the glass, so at the wall it reaches
 * further along than the level says — up at the edges of a pool on the floor,
 * down at the edges of one overhead, which is the same statement made twice.
 *
 * It is a small thing to measure and a large one to look at: a chord across a
 * round cell is a straight line, and six mirrors turn a straight line into a
 * hexagon with corners you could cut yourself on. Curved at the ends, the same
 * fold comes out as a rosette.
 */
const CLIMB = 0.06;
const WETS = 0.3;

/**
 * Where a pool's surface lands above the chord its field is built on.
 *
 * A pool's field is 1 inside and `(1 - a/POOL_REACH)²` at a above it, so the
 * contour at {@link SURFACE} sits at `a = (1 - √½)·POOL_REACH`. The chord is
 * therefore laid this much *beyond* where the surface is wanted, and the area
 * arithmetic gets to talk about the surface you can see.
 */
const EDGE = 1 - Math.SQRT1_2;

/**
 * How much of the cell the heavy liquid fills, at the two ends of Amount.
 *
 * Never all of it and never none: at nothing there is still a puddle to drip
 * into, and at everything there is still enough of the light liquid for the
 * beads to fall through. A tube of one liquid is not a timer.
 *
 * **Where the middle of that range sits was decided by the mirrors, not by the
 * liquid.** The cell is the disc the mirror triangle is inscribed in, so the
 * triangle's edges lie at half the radius and the fold never sees the outer
 * half of the cell at all. A settled pool is a cap at the rim — and measured
 * against the triangle, a pool filling a fifth of the cell covers 11% of what
 * is folded, all of it in the corners. Which is exactly what it looked like:
 * the cell drained to a flat pool and the figure came out as a lattice of
 * rosettes, because the rosettes *were* the pool, sampled at the three points
 * where it reached far enough in.
 *
 * At a shade under half the cell the surface lands within a twentieth of the
 * middle, covers 40% of the triangle, and folds into the six-pointed horizon
 * this substance is here for. So that is where the default rests, and Amount
 * runs either side of it.
 */
const LEAST = 0.28;
const MOST = 0.62;

/** How wide a bead is drawn, in cell units. Surface tension picks one size. */
const BEAD = 0.17;
const BEAD_SPREAD = 0.22;

/**
 * How much of a bead the pinch leaves behind on the surface, as a share.
 *
 * A neck does not break clean: what is left hanging is where the next one
 * starts from. Also the difference between a drip and a bead flickering into
 * existence two pixels across, which is what starting from nothing looked like.
 */
const LEFT = 0.14;

/**
 * What is too little to be worth a bead of its own, as a share of one.
 *
 * See where it is used: without it the pool halves and halves and is never
 * empty, and the cell never comes to rest — which would be a lava lamp got at
 * by accident rather than a timer.
 */
const DREGS = 0.05;

/** Seconds a bead takes to gather, with the pool overhead full. */
const GATHER = 1.9;

/**
 * How much slower the last of it drips than the first.
 *
 * A drip runs on the head of liquid above it, so a pool that is nearly gone
 * drips slowly — which is why the real ones have a long tail, minutes after the
 * bulk of it has gone down, and it is the best thing about them. Clamped rather
 * than left to go to nothing: `1/share` with nothing under it puts the last few
 * beads minutes apart on their own.
 */
const SLOWEST = 0.4;

/** How much thicker the far end of Thickness is, for the fall and for the drip. */
const THICKEST = 4;
const THICKEST_DRIP = 2;

/**
 * Downward acceleration on a bead, net of what it floats in.
 *
 * Small, and it is the difference between this and anything else that falls in
 * this app. The two liquids are within a per cent or two of each other's
 * density — which is the whole trick of the toy, and why it can be made to take
 * minutes — so what is left of a bead's weight once it has floated most of
 * itself off is very little, and against the drag that is a slow drift down
 * rather than a fall. Measured, a bead crosses the cell in about eight seconds
 * at the middle of Thickness.
 */
const FALL = 1.5;

/** Speed lost per second, before the fluid is thickened. */
const DRAG = 3.2;

/** How fast a bubble of the light liquid climbs through the heavy one. */
const RISE = 2.6;

/** How far a falling bead wanders sideways, and how quickly. */
const WANDER = 0.5;
const WANDER_RATE = 1.1;

/** How far a gathering bead hangs below the surface, as a share of its width. */
const PENDANT = 0.85;

/** Seconds a bead takes to be drawn into the pool it lands in. */
const SINK = 0.4;

/**
 * How far off level the pools may be pushed, in radians, and how they get back.
 *
 * A pool sloshes: turn the tube and the surface lags, stop and it rocks back
 * and settles. It is a damped oscillator driven by how fast gravity is moving
 * in the cell's frame, which is the whole of what a hand does to it — and it is
 * why this substance is worth having in a thing you hold. A still instrument
 * gets a flat surface, which is also correct, and is why the cell is not
 * pretending to be a lava lamp.
 */
const LEAN_MOST = 0.32;
const STIFF = 9;
const DAMPEN = 2.8;
const DRIVE = 0.3;

/** How hard a finger swiped along a surface tips it. */
const SWIPE = 1.4;

/** How far a finger reaches into the cell, as a share of the radius. */
const FINGER = 0.3;

/**
 * How far gravity has to get from the pool's own idea of down before it lets go.
 *
 * The one interaction this substance has that no other one does: **turning the
 * instrument over runs it again.** A pool keeps its own down and re-levels
 * towards gravity at {@link LEVEL}, so a slow turn is followed and nothing
 * happens — which is right, since tipping a bubbler gently on its side does not
 * set it off either. A deliberate half-turn outruns it, the alignment goes past
 * this, and everything on the floor is overhead again.
 */
const TIP = 2.2;

/** How fast a pool re-levels towards gravity, in radians per second. */
const LEVEL = 1.5;

/**
 * The pairs of liquids the tube can be filled with, light first.
 *
 * Both are transparent and the picture is what you get looking through both, so
 * these are not the colours on the screen: the field is the light one, and the
 * beads come out at the *product* of the two. Which is the illusion the toys
 * are sold on, and the reason to model it this way rather than choosing the
 * bead colour directly — a colour that falls out of the arithmetic goes on
 * being right when a bead crosses the pool, and one that was chosen does not.
 *
 * Picked by looking at the products. The light one of each pair is **nearly
 * white**, and that is a correction rather than a preference: it used to be a
 * butter or a sky — a light colour, but a colour — and it is most of the cell,
 * so the picture came out as two mid-tones against each other. Two mid-tones
 * is the one thing a kaleidoscope cannot carry: the mirrors take a few per
 * cent of the light at every bounce and lean it green as they go, so a figure
 * with no light in it goes to olive and brick at the rim. Pale, the same
 * arithmetic gives a clean colour on a white ground and the beads read as
 * liquid seen through liquid, which is what they are.
 */
const PAIRS: readonly (readonly [[number, number, number], [number, number, number]])[] = [
  // Cream and rose: a crimson bead on a warm white.
  [
    [252, 242, 222],
    [226, 74, 116],
  ],
  // Ice and cobalt: an ink blue on a cold white, which is the pair the desk
  // toys are most often filled with.
  [
    [226, 242, 250],
    [58, 116, 214],
  ],
  // Shell and amber: a marigold bead, and the one pair where the light liquid
  // is warmer than the heavy one is dark.
  [
    [254, 240, 214],
    [240, 146, 48],
  ],
  // Frost and violet, which through each other make an orchid.
  [
    [238, 234, 250],
    [128, 70, 200],
  ],
  // Mist and viridian: the green that a pool of it makes is the deepest colour
  // in the set, and the beads read almost black-green against the wall.
  [
    [232, 246, 238],
    [42, 152, 128],
  ],
];

/** Builds a cell of it, deterministically, turned over and ready to run. */
export function createDrops(seed: number, amount: number, scale = 1): Drops {
  const rng = mulberry32(seed);

  // Two turns of the crank thrown away. mulberry32's opening draw lands in the
  // same part of its range for a run of nearby seeds — 0.63, 0.73, 0.72, 0.92
  // for one, two, three, four — so a cell that picks its liquids off that draw
  // comes out the same colour for a run of nearby seeds, which is the one thing
  // a seed is there to stop.
  rng();
  rng();

  const heavy =
    Math.PI * CHAMBER_RADIUS * CHAMBER_RADIUS * (LEAST + (MOST - LEAST) * clamp(amount));

  return {
    seed,
    heavy,
    beadAcross: BEAD * Math.max(0.2, scale) * randomBetween(rng, 0.95, 1.05),
    tints: PAIRS[Math.min(PAIRS.length - 1, Math.floor(rng() * PAIRS.length))]!,
    beads: [],
    // Opens the way the toy is handed to you: turned over, all of it overhead,
    // about to run. There is nothing to catch mid-motion here the way there is
    // with lava — the motion is the whole run, and it starts at the start.
    overhead: heavy,
    floor: 0,
    // Worked out here as well as every frame, so the cell is coherent before it
    // has been advanced once — otherwise the first frame is the whole pool
    // appearing out of nothing, which measures as by far the biggest jump in
    // the run and would be exactly that on any screen fast enough to show it.
    overheadAt: -CHAMBER_RADIUS * chordFor(heavy),
    floorAt: CHAMBER_RADIUS,
    downX: 0,
    downY: 1,
    lean: 0,
    leaning: 0,
    rest: 0,
    facing: 0,
    poured: false,
    cast: 0,
  };
}

export interface DropsUpdate {
  /** Seconds to advance. */
  dt: number;
  /** How thick the fluid is, 0 thin to 1 gel. */
  thickness: number;
  /** How fast the fluid is turning within the cell, radians per second. */
  swirl: number;
  /** Which way is down in the cell's own frame, radians. */
  angle: number;
  /**
   * A finger in the cell, dragging the beads it touches and tipping the pools.
   *
   * A pool is the one thing in this instrument a finger can push on that
   * pushes back where you are not touching: swipe across a surface and the
   * whole of it tips, because a surface is one object however wide it is.
   */
  stir?: { x: number; y: number; vx: number; vy: number } | null | undefined;
}

/** Advances the cell in place: the level, then the drip, then what is in flight. */
export function updateDrops(
  drops: Drops,
  { dt, thickness, swirl, angle, stir }: DropsUpdate,
): void {
  if (dt <= 0) {
    return;
  }

  const step = Math.min(dt, 1 / 20);

  if (!drops.poured) {
    drops.rest = angle;
    drops.facing = angle;
    drops.poured = true;
  }

  // How fast gravity is moving in the cell's own frame. Turning the tube does
  // it, tipping the phone does it, and the pool cannot tell the two apart —
  // which is right, because neither can the liquid.
  const turned = wrap(angle - drops.facing);

  drops.facing = angle;

  // The slosh. Driven by that rate and by the fluid's own turning, pulled back
  // to level, and damped: hold the instrument still and the surface settles.
  drops.leaning +=
    (-STIFF * drops.lean - DAMPEN * drops.leaning) * step + (turned + swirl * step) * DRIVE;

  // A finger swept sideways piles the liquid up on the side it is going, and
  // the surface tips away from where it came from — wherever on the pool the
  // finger happens to be, because a surface is one object however wide it is.
  // Down is `(sin, cos)` of the angle, so along the surface is `(-cos, sin)`,
  // and liquid piling that way is a *negative* lean.
  if (stir) {
    const swept = -stir.vx * Math.cos(angle) + stir.vy * Math.sin(angle);

    drops.leaning -= swept * SWIPE * step;
  }
  drops.lean = Math.max(-LEAN_MOST, Math.min(LEAN_MOST, drops.lean + drops.leaning * step));

  // The pool's own down follows gravity, but only so fast. Outrun it far enough
  // and what is on the floor is overhead, and the whole thing runs again.
  const off = wrap(angle - drops.rest);

  if (Math.abs(off) > TIP) {
    drops.overhead += drops.floor;
    drops.floor = 0;
    drops.rest = angle;

    for (const bead of drops.beads) {
      // Anything still hanging has just been shaken off the ceiling.
      bead.filling = 0;
    }
  } else {
    drops.rest += Math.max(-LEVEL * step, Math.min(LEVEL * step, off));
  }

  const lie = angle + drops.lean;

  drops.downX = Math.sin(lie);
  drops.downY = Math.cos(lie);
  drops.overheadAt = -CHAMBER_RADIUS * chordFor(drops.overhead);
  drops.floorAt = CHAMBER_RADIUS * chordFor(drops.floor);

  gather(drops, step, thickness);
  carry(drops, step, thickness, swirl, stir);
}

/**
 * Grows the bead hanging off the pool overhead, and starts the next one.
 *
 * One at a time, and there is always one: a tube with two beads gathering at
 * once reads as a leak rather than a drip, and a tube with none reads as two
 * blocks of colour with nothing happening between them. The wait between beads
 * is the gathering, and the gathering is the part worth watching.
 */
function gather(drops: Drops, step: number, thickness: number): void {
  const { beadAcross } = drops;
  const full = Math.PI * beadAcross * beadAcross;
  const filling = drops.beads.find((bead) => bead.filling > 0);

  if (filling) {
    // Fed out of the pool overhead, so what a bead weighs was never anywhere
    // else — and at whatever rate is left to fill it in the time it has left.
    const rate = (filling.want - filling.area) / Math.max(step, filling.filling);
    const wanted = Math.max(0, Math.min(rate * step, drops.overhead));

    drops.overhead -= wanted;
    filling.area += wanted;
    filling.reach = reachOf(filling.area);
    // Hangs lower the fuller it gets, which is what stretches the neck: the
    // pool's field and the bead's still overlap, so what is drawn between them
    // is a waist rather than a gap, right up until it is one.
    const at = drops.overheadAt + filling.reach * SEEN * PENDANT;

    filling.x = drops.downX * at - drops.downY * filling.across;
    filling.y = drops.downY * at + drops.downX * filling.across;
    // If the pool runs dry first it lets go with what it has, which is the
    // last dribble of a real one.
    filling.filling = drops.overhead > 1e-9 ? Math.max(0, filling.filling - step) : 0;

    return;
  }

  // Down to the last thousandth of it, and then it is empty. Halving what is
  // left for ever is a way of never finishing, and this cell is meant to
  // finish: the pool that is left when it does is the picture it rests on.
  if (drops.overhead <= drops.heavy * 1e-6) {
    drops.overhead = 0;

    return;
  }

  const rng = mulberry32(drops.seed + drops.cast * 9973);

  drops.cast += 1;

  let size = Math.min(drops.overhead, full * randomBetween(rng, 1 - BEAD_SPREAD, 1 + BEAD_SPREAD));

  // The last of it comes down as one dribble rather than as an endless stream
  // of ever-smaller ones: a pool that only ever gives away a share of what is
  // in it is never empty, and a cell that is never empty never comes to rest.
  if (drops.overhead - size < full * DREGS) {
    size = drops.overhead;
  }

  const wide = Math.sqrt(size / Math.PI);
  // Along the surface, and clear of the wall by its own width, or a bead would
  // be born half outside the cell and shoved in on its first frame.
  const half = Math.sqrt(Math.max(0, CHAMBER_RADIUS * CHAMBER_RADIUS - drops.overheadAt ** 2));
  const across = randomBetween(rng, -1, 1) * Math.max(0, half - wide * 2);
  // A pool with less over it drips more slowly, which is why the real ones have
  // a long tail: an hour after the flip there is still the odd bead coming
  // down. Clamped, or the last few would be minutes apart on their own.
  const head = Math.max(SLOWEST, drops.overhead / drops.heavy);
  // Taken out of the pool now, like every other bit of it: what a bead is made
  // of was in the pool a moment ago and nowhere else, and the one place that is
  // easy to forget is the bump it starts as.
  const born = Math.min(drops.overhead, size * LEFT);
  // Placed by the same rule that will move it as it fills, or its second frame
  // would jump it to where that rule says it should have been all along.
  const at = drops.overheadAt + reachOf(born) * SEEN * PENDANT;

  drops.overhead -= born;

  drops.beads.push({
    x: drops.downX * at - drops.downY * across,
    y: drops.downY * at + drops.downX * across,
    vx: 0,
    vy: 0,
    area: born,
    reach: reachOf(born),
    want: size,
    across,
    filling: (GATHER * (1 + THICKEST_DRIP * clamp(thickness))) / head,
    sinking: 0,
    rising: false,
    wander: rng() * Math.PI * 2,
  });

  // The light liquid that takes its place has to come up through the pool to
  // get there, and while it is crossing it is a bubble. Only where there is
  // pool enough to cross: a cap a couple of beads thick has no room for one.
  if (drops.overheadAt + CHAMBER_RADIUS > beadAcross * 5) {
    const climb = randomBetween(rng, -0.8, 0.8) * half;
    const from = drops.overheadAt - beadAcross;
    const room = full * randomBetween(rng, 0.3, 0.6);

    drops.beads.push({
      x: drops.downX * from - drops.downY * climb,
      y: drops.downY * from + drops.downX * climb,
      vx: 0,
      vy: 0,
      area: room,
      reach: reachOf(room),
      want: room,
      across: climb,
      filling: 0,
      sinking: 0,
      rising: true,
      wander: rng() * Math.PI * 2,
    });
  }
}

/** Moves everything that is in flight, and lands what has arrived. */
function carry(
  drops: Drops,
  step: number,
  thickness: number,
  swirl: number,
  stir: DropsUpdate['stir'],
): void {
  const { downX, downY } = drops;
  const damping = Math.max(0, 1 - DRAG * (1 + THICKEST * clamp(thickness)) * step);
  const alive: Bead[] = [];

  for (const bead of drops.beads) {
    if (bead.filling > 0) {
      alive.push(bead);
      continue;
    }

    const along = bead.x * downX + bead.y * downY;

    if (bead.rising) {
      // A bubble is only a bubble while it is inside the pool overhead. Above
      // it there is nothing left to be a hole in; below it, the pool has
      // drained past and it has joined liquid of its own kind.
      if (along > drops.overheadAt || along < -CHAMBER_RADIUS + bead.reach * SEEN) {
        continue;
      }

      bead.x -= downX * RISE * step;
      bead.y -= downY * RISE * step;
      alive.push(bead);
      continue;
    }

    if (bead.sinking > 0 || along >= drops.floorAt) {
      // Poured into the pool rather than deleted into it: the area crosses over
      // a bit at a time, the bead shrinks as it goes, and the surface rises to
      // meet it. Neither end of that is a frame where the picture jumps.
      const moved = Math.min(
        bead.area,
        (Math.PI * drops.beadAcross * drops.beadAcross * step) / SINK,
      );

      bead.sinking = SINK;
      bead.area -= moved;
      drops.floor += moved;
      bead.reach = reachOf(bead.area);
      bead.x += downX * 0.1 * step;
      bead.y += downY * 0.1 * step;

      if (bead.area > 1e-6) {
        alive.push(bead);
      }

      continue;
    }

    // Terminal drift rather than a slow acceleration, which is what a bead in a
    // liquid does: the weight it falls under is already net of what it floats
    // in, and the drag turns that into a speed rather than a rate of gain.
    bead.wander += WANDER_RATE * step;

    const side = Math.sin(bead.wander) * WANDER;
    const flowX = -swirl * bead.y;
    const flowY = swirl * bead.x;
    const pushX = downX * FALL - downY * side;
    const pushY = downY * FALL + downX * side;

    bead.vx = flowX + (bead.vx + pushX * step - flowX) * damping;
    bead.vy = flowY + (bead.vy + pushY * step - flowY) * damping;

    // Carried along with the finger rather than shoved by it, the same rule
    // the wax next door is pushed with.
    if (stir) {
      const away = Math.hypot(bead.x - stir.x, bead.y - stir.y) / (CHAMBER_RADIUS * FINGER);

      if (away < 1) {
        const much = (1 - away) * (1 - away);

        bead.vx += (stir.vx - bead.vx) * much;
        bead.vy += (stir.vy - bead.vy) * much;
      }
    }

    bead.x += bead.vx * step;
    bead.y += bead.vy * step;

    confine(bead);

    // A bead that has run out of cell before it has run out of fall is on the
    // floor: with nothing pooled yet the surface is the wall itself, and this
    // is the puddle starting.
    const landed = bead.x * downX + bead.y * downY;

    if (landed > 0 && Math.hypot(bead.x, bead.y) >= CHAMBER_RADIUS - bead.reach * SEEN - 1e-6) {
      bead.sinking = SINK;
    }

    alive.push(bead);
  }

  drops.beads = alive;
}

/** Keeps a bead inside the wall, and takes the speed that carried it there. */
function confine(bead: Bead): void {
  const distance = Math.hypot(bead.x, bead.y);
  const limit = Math.max(0, CHAMBER_RADIUS - bead.reach * SEEN);

  if (distance <= limit || distance === 0) {
    return;
  }

  const outX = bead.x / distance;
  const outY = bead.y / distance;

  bead.x = outX * limit;
  bead.y = outY * limit;

  const into = bead.vx * outX + bead.vy * outY;

  if (into > 0) {
    bead.vx -= into * outX;
    bead.vy -= into * outY;
  }
}

/**
 * Where the surface of a pool of this area lies, as a share of the radius.
 *
 * The area of a disc beyond a chord at `u·R` is `R²(acos u - u√(1-u²))`, which
 * has no inverse worth writing down, so it is bisected. Twenty four halvings of
 * `[-1, 1]` is the last bit of a float, and it runs twice a frame.
 *
 * @returns Where the chord is, from -1 at the far wall to 1 at the near one.
 */
export function chordFor(area: number): number {
  const full = Math.PI * CHAMBER_RADIUS * CHAMBER_RADIUS;

  if (area <= 0) {
    return 1;
  }

  if (area >= full) {
    return -1;
  }

  let low = -1;
  let high = 1;

  for (let i = 0; i < 24; i += 1) {
    const mid = (low + high) / 2;
    const beyond =
      CHAMBER_RADIUS * CHAMBER_RADIUS * (Math.acos(mid) - mid * Math.sqrt(1 - mid * mid));

    if (beyond > area) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return (low + high) / 2;
}

/** How far the field of a bead of this much liquid reaches. */
function reachOf(area: number): number {
  return Math.sqrt(Math.max(0, area) / Math.PI) / SEEN;
}

/** The shortest way round from one angle to another. */
function wrap(angle: number): number {
  return angle - Math.PI * 2 * Math.round(angle / (Math.PI * 2));
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Paints the cell onto a small canvas, one pixel per grid cell.
 *
 * Every pixel inside the wall is liquid — that is what a sealed tube is — so
 * the picture is the light liquid's tint everywhere, with the heavy one laid
 * over it where the fields say. Composited with `multiply` by the renderer, so
 * the two tints are two things light passes through rather than two coats of
 * paint, and the beads come out the product of the pair.
 *
 * @returns The canvas, or null where there is no canvas to be had.
 */
export function paintDrops(drops: Drops): HTMLCanvasElement | null {
  const surface = dropSurface();

  if (!surface) {
    return null;
  }

  const { canvas, ctx, image } = surface;
  const pixels = image.data;
  const width = (2 * CHAMBER_RADIUS) / GRID;

  field.fill(0);

  // The beads and the bubbles, each over the square its own field reaches into.
  for (const bead of drops.beads) {
    const from = Math.max(0, Math.floor((bead.x - bead.reach + CHAMBER_RADIUS) / width));
    const to = Math.min(GRID - 1, Math.ceil((bead.x + bead.reach + CHAMBER_RADIUS) / width));
    const start = Math.max(0, Math.floor((bead.y - bead.reach + CHAMBER_RADIUS) / width));
    const end = Math.min(GRID - 1, Math.ceil((bead.y + bead.reach + CHAMBER_RADIUS) / width));
    const span = bead.reach * bead.reach;
    const sign = bead.rising ? -1 : 1;

    if (span <= 0) {
      continue;
    }

    for (let j = start; j <= end; j += 1) {
      const y = -CHAMBER_RADIUS + (j + 0.5) * width - bead.y;

      for (let i = from; i <= to; i += 1) {
        const x = -CHAMBER_RADIUS + (i + 0.5) * width - bead.x;
        const away = (x * x + y * y) / span;

        if (away >= 1) {
          continue;
        }

        const at = i + j * GRID;

        field[at] = field[at]! + sign * (1 - away) * (1 - away);
      }
    }
  }

  shadeFor(drops.tints);
  // The chords the pools' fields are built on, laid past their own surfaces so
  // the surfaces land where the areas say. See EDGE.
  const ceiling = drops.overhead > 0 ? drops.overheadAt - EDGE * POOL_REACH : -Infinity;
  const bed = drops.floor > 0 ? drops.floorAt + EDGE * POOL_REACH : Infinity;
  // Wide enough that the contour crosses a grid cell or so. A pool's surface is
  // a straight line and the eye reads a staircase in one of those that it would
  // never notice in the edge of a bead.
  const band = 0.12;
  const low = SURFACE - band;
  const high = SURFACE + band;
  const edge = CHAMBER_RADIUS - width;

  const across = GRID * FINE;
  const fine = width / FINE;

  // Where each column sits in the bead field. It is the same for every row, so
  // it is worked out once rather than sixty thousand times.
  if (columns.length !== across) {
    columns = new Float32Array(across);
    lefts = new Int32Array(across);
    rights = new Int32Array(across);
    eased = new Float32Array(across);

    for (let i = 0; i < across; i += 1) {
      const at = i / FINE - 0.5;
      const cell = Math.floor(at);

      columns[i] = -CHAMBER_RADIUS + (i + 0.5) * fine;
      lefts[i] = Math.min(GRID - 1, Math.max(0, cell));
      rights[i] = Math.min(GRID - 1, Math.max(0, cell + 1));
      eased[i] = smooth(at - cell);
    }
  }

  for (let j = 0; j < across; j += 1) {
    const y = -CHAMBER_RADIUS + (j + 0.5) * fine;
    // Where this pixel sits in the bead field, in cells, at the cell centres.
    const downTo = j / FINE - 0.5;
    const j0 = Math.floor(downTo);
    const jUp = Math.min(GRID - 1, Math.max(0, j0));
    const jDown = Math.min(GRID - 1, Math.max(0, j0 + 1));
    const fy = smooth(downTo - j0);
    const rowUp = jUp * GRID;
    const rowDown = jDown * GRID;

    // Where this row crosses the wall, so the fifth of the square that is
    // outside the round cell is one fill rather than a pass of the arithmetic.
    const half = CHAMBER_RADIUS * CHAMBER_RADIUS - y * y;
    const reach = half > 0 ? Math.sqrt(half) : 0;
    const from = Math.max(0, Math.ceil((CHAMBER_RADIUS - reach) / fine - 0.5));
    const to = Math.min(across - 1, Math.floor((CHAMBER_RADIUS + reach) / fine - 0.5));

    pixels.fill(0, j * across * 4, (j * across + Math.max(0, from)) * 4);
    pixels.fill(0, (j * across + Math.max(0, to + 1)) * 4, (j + 1) * across * 4);

    for (let i = from; i <= to; i += 1) {
      const x = columns[i]!;
      const at = (i + j * across) * 4;
      const out = x * x + y * y;

      if (out >= CHAMBER_RADIUS * CHAMBER_RADIUS) {
        pixels.fill(0, at, at + 4);
        continue;
      }

      const away = Math.sqrt(out);
      const along = x * drops.downX + y * drops.downY;
      // The meniscus, as a share of how near the wall this is. Both surfaces
      // are pushed the same way by it — away from their own liquid — which for
      // one of them is up and for the other is down.
      const near = Math.max(0, 1 - (CHAMBER_RADIUS - away) / WETS);
      const wet = CLIMB * near * near;
      const iLeft = lefts[i]!;
      const iRight = rights[i]!;
      const fx = eased[i]!;
      // The beads, read off their own grid with eased weights so the join
      // between two cells has no kink in it; the pools, worked out here at the
      // pixel, because a straight surface is the one thing in this cell whose
      // edge the eye measures. See FINE.
      const beads =
        (1 - fy) * ((1 - fx) * field[rowUp + iLeft]! + fx * field[rowUp + iRight]!) +
        fy * ((1 - fx) * field[rowDown + iLeft]! + fx * field[rowDown + iRight]!);
      const total = Math.max(pool(ceiling + wet - along), pool(along - bed + wet)) + beads;
      const much = total <= low ? 0 : total >= high ? 1 : smooth((total - low) / (high - low));
      // How much heavy liquid the light has to get through here, and it is the
      // field that says: a bead is a bead-shaped body and not a disc of colour,
      // so there is more of it to see through in the middle than at the rim.
      const body = Math.min(1, Math.max(0, (total - SURFACE) / (1 - SURFACE)));
      const shade = Math.round(much * (RIM + (1 - RIM) * body) * (SHADES - 1)) * 3;

      pixels[at] = shades[shade]!;
      pixels[at + 1] = shades[shade + 1]!;
      pixels[at + 2] = shades[shade + 2]!;
      // Softened over the last cell of the wall, so the disc has an edge and
      // not a staircase. Everything past it is not in the tube at all.
      pixels[at + 3] = away <= edge ? 255 : Math.round((1 - (away - edge) / width) * 255);
    }
  }

  ctx.putImageData(image, 0, 0);

  return canvas;
}

/**
 * How thick the heavy liquid is at its own surface, as a share of the cell.
 *
 * Not nought, or a bead would fade out at its edge instead of having one — and
 * not one, or it would be a flat disc of colour. Halfway gives a bead a dark
 * middle and a lighter rim, which is what looking through a round thing does,
 * and gives a pool a bright line along its surface, which is what looking
 * through the shallow end of one does.
 */
const RIM = 0.5;

/** Steps in the shade table. Any more is finer than a byte can tell. */
const SHADES = 48;

/** Every shade of the pair, from none of the heavy liquid to all of it. */
const shades = new Float32Array(SHADES * 3);

/**
 * Fills {@link shades} for a pair of liquids.
 *
 * Beer and Lambert: each unit of liquid passes a fixed *share* of what reaches
 * it, so what comes through a depth `d` is the tint raised to `d` rather than
 * scaled by it. That is the whole of why a bead is not one flat colour, and it
 * is also why nothing in here has to choose what a bead looks like — the beads
 * come out at the product of the two liquids because that is what light does
 * on its way through both of them.
 */
function shadeFor([light, deep]: Drops['tints']): void {
  for (let k = 0; k < SHADES; k += 1) {
    const depth = k / (SHADES - 1);

    shades[k * 3] = light[0] * Math.pow(deep[0] / 255, depth);
    shades[k * 3 + 1] = light[1] * Math.pow(deep[1] / 255, depth);
    shades[k * 3 + 2] = light[2] * Math.pow(deep[2] / 255, depth);
  }
}

/** A pool's field, given how far past its chord the point is. */
function pool(past: number): number {
  if (past >= 0) {
    return 1;
  }

  if (past <= -POOL_REACH) {
    return 0;
  }

  const at = 1 + past / POOL_REACH;

  return at * at;
}

/** Where the fields are summed, before any of it is a colour. */
const field = new Float32Array(GRID * GRID);

/** Where each painted column sits, and which two cells of the field it reads. */
let columns = new Float32Array(0);
let lefts = new Int32Array(0);
let rights = new Int32Array(0);
let eased = new Float32Array(0);

/** Smoothstep, for an edge that eases in and out rather than ramping. */
function smooth(at: number): number {
  return at * at * (3 - 2 * at);
}

/** The one surface the cell is drawn on, built once. */
let surface: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; image: ImageData } | null =
  null;
let surfaceTried = false;

function dropSurface() {
  if (surfaceTried) {
    return surface;
  }

  surfaceTried = true;

  if (typeof document === 'undefined') {
    return null;
  }

  const canvas = document.createElement('canvas');
  canvas.width = GRID * FINE;
  canvas.height = GRID * FINE;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  if (!ctx) {
    return null;
  }

  const image = ctx.createImageData(GRID * FINE, GRID * FINE);

  if (!image.data.length) {
    return null;
  }

  surface = { canvas, ctx, image };

  return surface;
}
