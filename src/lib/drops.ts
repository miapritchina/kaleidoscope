import { CHAMBER_RADIUS } from './chamber';
import { mulberry32, randomBetween } from './random';

/**
 * A density column in the object cell.
 *
 * The desk toy, and the science-museum demonstration next to it: a sealed tube
 * of liquids that will not mix, each a shade heavier than the last. Left alone
 * they lie in **layers**, heaviest at the bottom, with a flat surface between
 * every pair. Turn it over and every one of those layers is in the wrong place,
 * and the tube has to sort itself out again — which it can only do by letting
 * the heavy liquid down *through* the light one while the light one comes up
 * through the heavy at the same time. So the sorting happens as **beads**: they
 * gather on the underside of the surface, hang, stretch, let go, and drift down
 * through the layer below, while bubbles of the lighter liquid leave the same
 * surface going the other way. A few minutes later that pair has changed
 * places, the next pair out of order starts, and when the last of them is done
 * the tube is layered again and still — until it is turned over.
 *
 * It is a different thing from the lava lamp next to it, and the difference is
 * the point. Lava is a *cycle*: heat drives it and it never settles. This runs
 * **down**. It is a timer, and what starts it is the hand.
 *
 * This build has three liquids where the first had two, and that is the whole
 * of what changed. Two liquids is one surface, one colour of bead, and one
 * direction of travel, and it looked like what it was: a flat disc of colour
 * with dots on its edge. Three is
 *
 * - **layers, and layers that stack.** A settled column has two straight
 *   surfaces rather than one, at about a third and two thirds of the way up,
 *   and six mirrors fold two parallel straight lines into a figure a single one
 *   cannot reach. Nothing else in this instrument has a surface at all.
 * - **three colours, none of which is chosen.** Each liquid is transparent and
 *   the tube is looked *through*, so what a pixel comes out as is the product
 *   of however much of each liquid is in the way — Beer and Lambert over the
 *   three. A bead crossing a layer is its own colour times the layer's, and
 *   that is not a colour anybody picked. See {@link shadeFor}.
 * - **two directions at once.** The pair being sorted exchanges across one
 *   surface, so beads leave it downwards and bubbles leave it upwards from the
 *   same place at the same moment. It is the plainest thing in the cell to
 *   watch and it was the thing two liquids could not do.
 *
 * The sorting is a bubble sort and nothing cleverer: whichever *adjacent* pair
 * is out of order lowest in the tube is the pair that exchanges, and when it is
 * done the next one starts. A column of three turned over is fully reversed,
 * which is three exchanges — a long run with three distinct acts in it, and a
 * flip halfway through leaves a half-sorted column that simply carries on from
 * wherever it now is.
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
  /** Which liquid it is made of: an index into {@link Drops.tints}. */
  liquid: number;
  /** How far its field reaches, in cell units. */
  reach: number;
  /** Where along the surface it hangs from, in cell units either side. */
  across: number;
  /**
   * Seconds left of gathering at the surface before it lets go.
   *
   * A drip is not a bead that appears — it is liquid running down into a
   * pendant drop until it is heavy enough to break its own neck. So the next
   * bead is *always* gathering: it starts as the bump the last pinch left
   * behind, grows in place, hangs further from the surface as it fills, and
   * lets go. The wait between beads is spent hanging rather than spent on a
   * flat surface, which is both what a slow drip looks like and the only way
   * anybody ever sees the drip happen — sampled at a run of instants, a surface
   * that is flat between beads is flat in nearly every one of them.
   */
  filling: number;
  /** How big it will be when it lets go, as a reach. Only while filling. */
  wants: number;
  /**
   * Whether it has arrived and is being drawn into the layer it reached.
   *
   * The counterpart of the gathering, and it exists for the same reason. A bead
   * that reached its layer and was simply deleted would take a visible bite out
   * of the picture on one frame — see the frame-to-frame test in
   * `drops.test.ts`, which is in this repo because exactly that kind of fault
   * got all the way to a phone once already. So it shrinks into the surface
   * over {@link SINK} instead, with the surface already there to meet it.
   */
  landing: boolean;
  /** Going up rather than down: a bubble of the lighter liquid. */
  rising: boolean;
  /** Where in its sideways wander it is, radians. */
  wander: number;
}

/**
 * One layer of the column: a liquid, and how much of it is lying here.
 *
 * Bottom first, so `bands[0]` rests on the floor of the cell. A settled column
 * has them in descending order of weight — which, since the liquids are
 * numbered lightest first, means descending order of index.
 */
export interface Band {
  /** Which liquid: an index into {@link Drops.tints}. */
  liquid: number;
  /** How much of it is in this layer, as an area in cell units. */
  area: number;
}

/**
 * A pair of layers changing places.
 *
 * Four bands, and they are all four in {@link Drops.bands}, in this order from
 * the bottom: `fell`, `light`, `heavy`, `rose`. The two in the middle are the
 * pair that was out of order and they drain; the two outside them are where
 * their liquid is going and they fill. When the drain is done the middle two
 * are dropped and what is left is the same two layers, swapped.
 *
 * The areas are moved by {@link Swap.progress} rather than by the beads, and
 * that is deliberate. A bookkeeping model where each bead carries its own
 * volume out of one pool and into another is the obvious way round and it was
 * the first build's; it means the column is not full while a bead is in flight,
 * and with layers rather than one pool an unfull column has a *gap* in it that
 * has to be given to somebody. Moving the areas continuously and letting the
 * beads be the visible carriers keeps the column exactly full at every instant,
 * and the drip is still what sets the pace — see {@link gather}, which spawns
 * beads against the same clock.
 */
export interface Swap {
  /** Where the heavy liquid is going: the band below the pair. */
  fell: Band;
  /** The lighter layer, which is underneath and draining upward. */
  light: Band;
  /** The heavier layer, which is on top and draining downward. */
  heavy: Band;
  /** Where the light liquid is going: the band above the pair. */
  rose: Band;
  /** How far through, 0 to 1. */
  progress: number;
  /** What the two draining bands held when it started. */
  heavyWas: number;
  lightWas: number;
  /** The surface the exchange happens across, in cell units along down. */
  at: number;
  /** Where a bead has arrived, and where a bubble has. */
  sink: number;
  climb: number;
}

export interface Drops {
  /** What the cell was cut from. */
  readonly seed: number;
  /** How wide a bead is drawn, in cell units. Surface tension picks one size. */
  readonly beadAcross: number;
  /**
   * The liquids, lightest first, each as the colour a full depth of it passes.
   *
   * Lightest first is also topmost first once the column has settled, and it is
   * the order the whole module is written in: a band's `liquid` is an index
   * into this, and one index being lower than another *is* the statement that
   * it floats on it.
   */
  readonly tints: readonly (readonly [number, number, number])[];
  /** The column, bottom first. */
  bands: Band[];
  /** The pair currently changing places, if any. */
  swap: Swap | null;
  /** Beads and bubbles in flight. */
  beads: Bead[];
  /** Which way the surfaces lie: down, plus however far the column is sloshing. */
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
   * Where a bead lets go of the surface and how big it comes out are the only
   * things in here that are not arithmetic, and this is what keeps them
   * repeatable: the same cell run the same way casts the same beads, whatever
   * frame rate it is run at, because the draw is made from the count and not
   * from a clock or a running generator.
   */
  cast: number;
}

/**
 * Cells across the chamber the bead field is worked out on.
 *
 * The beads only. The *surfaces* are not on this grid and never were — where a
 * layer's surface lies is arithmetic, worked out at the painted pixel from a
 * chord and a meniscus, because a straight line is the one edge in this whole
 * instrument that the eye measures and a straight line a cell wide at a time is
 * a staircase.
 */
export const GRID = 128;

/**
 * How many pixels the cell is painted at, per cell of the bead field.
 *
 * Two, and it is the surfaces that ask for it rather than the beads: the beads
 * are a smooth field and want no more resolution than the field has, while a
 * surface painted one pixel per cell is visibly stepped at anything past the
 * default zoom. Painted two pixels a cell, with the column evaluated at each of
 * them, the horizon is a line again.
 */
const FINE = 2;

/** Where the surface of a bead is, as a sum of the fields. */
const SURFACE = 0.5;

/**
 * How wide a bead looks against how far its field reaches.
 *
 * `(1 - d²/r²)² = 0.5` puts a lone bead's surface at 0.54 of its reach. Every
 * size in here goes through it — see the note on the same constant in
 * `lib/lava.ts`, where leaving it out filled the cell with dots.
 */
const SEEN = 0.54;

/** How far a surface is smeared either side of itself, in cell units. */
const POOL_REACH = 0.055;

/**
 * How far the liquid climbs the wall, in cell units, and how far in it lets go.
 *
 * A meniscus. The heavier liquid of a pair wets the glass, so at the wall every
 * surface in the column stands a little higher than the level says.
 *
 * It is a small thing to measure and a large one to look at: a chord across a
 * round cell is a straight line, and six mirrors turn a straight line into a
 * hexagon with corners you could cut yourself on. Curved at the ends, the same
 * fold comes out as a rosette.
 */
const CLIMB = 0.06;
const WETS = 0.3;

/**
 * How far Amount may push the layers away from three equal thirds.
 *
 * A sealed tube is always full, so "how much" cannot mean how much liquid there
 * is — it means how much of the tube any one of the three liquids is. At
 * nothing the column is three equal layers; at everything one of them is half
 * again as deep as another, which moves both surfaces and changes the figure
 * the fold makes of them.
 *
 * **How far it may go was decided by the mirrors, not by the liquid.** The cell
 * is the disc the mirror triangle is inscribed in, so the triangle's edges lie
 * at half the radius and the fold never sees the outer half of the cell at all.
 * A thin layer's surface is a cap out at the rim, and a cap at the rim reaches
 * the triangle only at its three corners: the first build of this had one
 * surface and one pool, the pool settled as exactly that, and the figure came
 * out as a lattice of little rosettes that *were* the pool — 11% of what is
 * folded, all of it in the corners.
 *
 * Measured against the triangle, the share of the fold a bottom layer covers
 * runs 0.10 of the fold at a quarter of the tube, 0.16 at a quarter and a half,
 * 0.19 at 0.28, and 0.24 at a third. A layer of 0.26 is the thinnest that still
 * reads as a layer rather than as three corners, and this is set so no layer
 * ever goes under it.
 */
const SPREAD = 0.07;

/** How wide a bead is drawn, in cell units. Surface tension picks one size. */
const BEAD = 0.16;
const BEAD_SPREAD = 0.22;

/**
 * How much of a bead the pinch leaves behind on the surface, as a share.
 *
 * A neck does not break clean: what is left hanging is where the next one
 * starts from. Also the difference between a drip and a bead flickering into
 * existence two pixels across, which is what starting from nothing looked like.
 */
const LEFT = 0.2;

/** Seconds a pair of layers takes to change places, at the thin end of Thickness. */
const EXCHANGE = 26;

/**
 * How much slower the last of an exchange runs than the first.
 *
 * A drip runs on the head of liquid above it, so a layer that is nearly drained
 * drips slowly — which is why the real ones have a long tail, minutes after the
 * bulk of it has gone down, and it is the best thing about them. Clamped rather
 * than left to go to nothing: a rate proportional to what is left never arrives
 * at all.
 */
const SLOWEST = 0.35;

/** Seconds a bead takes to gather, at the head of an exchange. */
const GATHER = 0.75;

/** How much thicker the far end of Thickness is, for the fall and for the drip. */
const THICKEST = 4;
const THICKEST_DRIP = 2;

/**
 * Downward acceleration on a bead, net of what it floats in.
 *
 * Small, and it is the difference between this and anything else that falls in
 * this app. The liquids are within a per cent or two of each other's density —
 * which is the whole trick of the toy, and why it can be made to take minutes —
 * so what is left of a bead's weight once it has floated most of itself off is
 * very little, and against the drag that is a slow drift down rather than a
 * fall.
 */
const FALL = 1;

/** Speed lost per second, before the fluid is thickened. */
const DRAG = 3.2;

/** How fast a bubble of the lighter liquid climbs through the heavier one. */
const RISE = 0.85;

/** How far a drifting bead wanders sideways, and how quickly. */
const WANDER = 0.5;
const WANDER_RATE = 1.1;

/** How far a gathering bead hangs past the surface, as a share of its width. */
const PENDANT = 0.85;

/** Seconds a bead takes to be drawn into the layer it arrives at. */
const SINK = 0.4;

/**
 * How far off level the surfaces may be pushed, in radians, and how they get
 * back.
 *
 * A column sloshes: turn the tube and every surface in it lags, stop and they
 * rock back and settle. It is a damped oscillator driven by how fast gravity is
 * moving in the cell's frame, which is the whole of what a hand does to it —
 * and it is why this substance is worth having in a thing you hold. A still
 * instrument gets flat surfaces, which is also correct, and is why the cell is
 * not pretending to be a lava lamp.
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
 * How far gravity has to get from the column's own idea of down before the
 * layers let go.
 *
 * The one interaction this substance has that no other one does: **turning the
 * instrument over runs it again.** The column keeps its own down and re-levels
 * towards gravity at {@link LEVEL}, so a slow turn is followed and nothing
 * happens — which is right, since tipping a bubbler gently on its side does not
 * set it off either. A deliberate half-turn outruns it, the alignment goes past
 * this, and the whole column is upside down: every layer that was settled is
 * now in the wrong order and the run starts again.
 */
const TIP = 2.2;

/** How fast the column re-levels towards gravity, in radians per second. */
const LEVEL = 1.5;

/**
 * The sets of liquids the tube can be filled with, lightest first.
 *
 * All three are transparent and the picture is what you get looking through all
 * of them, so these are not the colours on the screen: what any pixel comes out
 * as is the product of however much of each is in the way. Which is the illusion
 * these toys are sold on, and the reason to model it this way rather than
 * choosing the bead colour directly — a colour that falls out of the arithmetic
 * goes on being right when a bead crosses a layer, and one that was chosen does
 * not.
 *
 * The lightest of each set is **nearly white**, and that is a correction rather
 * than a preference: it used to be a butter or a sky — a light colour, but a
 * colour — and it is the top third of the tube, so the picture came out as
 * mid-tones against each other. Two mid-tones is the one thing a kaleidoscope
 * cannot carry: the mirrors take a few per cent of the light at every bounce
 * and lean it green as they go, so a figure with no light in it goes to olive
 * and brick at the rim. Pale, the same arithmetic gives clean colour on a white
 * ground and the layers read as liquid seen through liquid, which is what they
 * are.
 */
const SETS: readonly (readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
])[] = [
  // Cream, rose and cobalt: the pair the desk toys are most often filled with,
  // with a warm white over them.
  [
    [252, 243, 228],
    [231, 92, 128],
    [54, 104, 198],
  ],
  // Ice, amber and viridian. The amber crossing the viridian is the one place
  // in the set where two beads make a third colour you would not have guessed.
  [
    [232, 244, 250],
    [244, 158, 54],
    [38, 150, 126],
  ],
  // Shell, orchid and ink: the deepest set, and the beads read almost black
  // against the wall.
  [
    [252, 240, 232],
    [180, 108, 210],
    [46, 70, 152],
  ],
  // Mist, lemon and crimson, which is the only set with a light liquid warmer
  // than either of the ones under it.
  [
    [246, 248, 234],
    [246, 210, 84],
    [206, 52, 92],
  ],
  // Frost, turquoise and plum.
  [
    [238, 243, 250],
    [70, 182, 192],
    [122, 58, 142],
  ],
];

/** How many liquids a tube holds. */
const LIQUIDS = 3;

/** Builds a cell of it, deterministically, turned over and ready to run. */
export function createDrops(seed: number, amount: number, scale = 1): Drops {
  const rng = mulberry32(seed);

  // Two turns of the crank thrown away. mulberry32's opening draw lands in the
  // same part of its range for a run of nearby seeds — 0.63, 0.73, 0.72, 0.92
  // for one, two, three, four — so a cell that picks its liquids off that draw
  // comes out the same colours for a run of nearby seeds, which is the one
  // thing a seed is there to stop.
  rng();
  rng();

  const full = Math.PI * CHAMBER_RADIUS * CHAMBER_RADIUS;
  const spread = SPREAD * clamp(amount);
  // Which of the three is the deep one, and by how much. Three cosines a third
  // of a turn apart add to nothing however the dial is set, so whatever this
  // draws the shares still come to exactly one tube.
  const turn = rng() * Math.PI * 2;
  const shares = [0, 1, 2].map(
    (liquid) => 1 / 3 + spread * Math.cos(turn + (liquid * 2 * Math.PI) / 3),
  );

  return {
    seed,
    beadAcross: BEAD * Math.max(0.2, scale) * randomBetween(rng, 0.95, 1.05),
    tints: SETS[Math.min(SETS.length - 1, Math.floor(rng() * SETS.length))]!,
    // Opens the way the toy is handed to you: upside down, every layer in the
    // wrong place, about to run. There is nothing to catch mid-motion here the
    // way there is with lava — the motion is the whole run, and it starts at
    // the start.
    bands: shares.map((share, liquid) => ({ liquid, area: share * full })),
    swap: null,
    beads: [],
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
   * A finger in the cell, dragging the beads it touches and tipping the layers.
   *
   * A surface is the one thing in this instrument a finger can push on that
   * pushes back where you are not touching: swipe across one and the whole of
   * it tips, because a surface is one object however wide it is.
   */
  stir?: { x: number; y: number; vx: number; vy: number } | null | undefined;
}

/** Advances the cell: the level, then the sorting, then what is in flight. */
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
  // it, tipping the phone does it, and the liquid cannot tell the two apart —
  // which is right, because neither can a real one.
  const turned = wrap(angle - drops.facing);

  drops.facing = angle;

  // The slosh. Driven by that rate and by the fluid's own turning, pulled back
  // to level, and damped: hold the instrument still and the surfaces settle.
  drops.leaning +=
    (-STIFF * drops.lean - DAMPEN * drops.leaning) * step + (turned + swirl * step) * DRIVE;

  // A finger swept sideways piles the liquid up on the side it is going, and
  // the surface tips away from where it came from — wherever on the surface the
  // finger happens to be, because a surface is one object however wide it is.
  // Down is `(sin, cos)` of the angle, so along the surface is `(-cos, sin)`,
  // and liquid piling that way is a *negative* lean.
  if (stir) {
    const swept = -stir.vx * Math.cos(angle) + stir.vy * Math.sin(angle);

    drops.leaning -= swept * SWIPE * step;
  }

  drops.lean = Math.max(-LEAN_MOST, Math.min(LEAN_MOST, drops.lean + drops.leaning * step));

  // The column's own down follows gravity, but only so fast. Outrun it far
  // enough and the whole thing is upside down, and it has to sort itself out
  // all over again.
  const off = wrap(angle - drops.rest);

  if (Math.abs(off) > TIP) {
    drops.bands.reverse();
    drops.swap = null;
    drops.rest = angle;

    for (const bead of drops.beads) {
      // Anything still hanging has just been shaken off its surface.
      bead.filling = 0;
    }
  } else {
    drops.rest += Math.max(-LEVEL * step, Math.min(LEVEL * step, off));
  }

  const lie = angle + drops.lean;

  drops.downX = Math.sin(lie);
  drops.downY = Math.cos(lie);

  sort(drops, step, thickness);
  gather(drops, step, thickness);
  carry(drops, step, thickness, swirl, stir);
}

/**
 * Runs the column's own bubble sort: finds the lowest pair out of order and
 * exchanges it, a little at a time.
 *
 * See {@link Swap} for why the areas move on a clock rather than with the
 * beads, and the module note for why one pair at a time is not a shortcut: a
 * column of three fully reversed has its two out-of-order pairs *overlapping*,
 * sharing their middle band, so there is never more than one exchange that
 * could be run at once anyway.
 */
function sort(drops: Drops, step: number, thickness: number): void {
  const swap = drops.swap;

  if (swap) {
    // A rate that falls away with what is left in the draining layers, clamped
    // so the tail is long rather than endless. See SLOWEST.
    const head = Math.max(SLOWEST, 1 - swap.progress);
    const over = EXCHANGE * (1 + THICKEST_DRIP * clamp(thickness));

    swap.progress = Math.min(1, swap.progress + (step * head) / over);
    swap.heavy.area = swap.heavyWas * (1 - swap.progress);
    swap.fell.area = swap.heavyWas * swap.progress;
    swap.light.area = swap.lightWas * (1 - swap.progress);
    swap.rose.area = swap.lightWas * swap.progress;

    if (swap.progress >= 1) {
      drops.bands = drops.bands.filter((band) => band !== swap.heavy && band !== swap.light);
      drops.swap = null;
    } else {
      surfacesOf(drops, edges);

      const at = drops.bands.indexOf(swap.light);

      // The surface the pair meet across, and the two the beads are heading
      // for. `edges[i]` is the *bottom* of band `i`, so the top of band `i` is
      // the next one along.
      swap.at = edges[at + 1]!;
      swap.sink = edges[at]!;
      swap.climb = edges[at + 2]!;

      return;
    }
  }

  merge(drops);

  // Lowest first, which is what makes it a bubble sort and not a scramble: the
  // heaviest thing in the tube reaches the floor by exchanging with each layer
  // under it in turn, and every one of those exchanges is a thing to watch.
  for (let i = 0; i + 1 < drops.bands.length; i += 1) {
    const under = drops.bands[i]!;
    const over = drops.bands[i + 1]!;

    if (under.liquid >= over.liquid || under.area <= 0 || over.area <= 0) {
      continue;
    }

    const fell = { liquid: over.liquid, area: 0 };
    const rose = { liquid: under.liquid, area: 0 };

    drops.bands.splice(i, 0, fell);
    drops.bands.splice(i + 3, 0, rose);

    drops.swap = {
      fell,
      light: under,
      heavy: over,
      rose,
      progress: 0,
      heavyWas: over.area,
      lightWas: under.area,
      at: 0,
      sink: 0,
      climb: 0,
    };

    surfacesOf(drops, edges);
    drops.swap.at = edges[i + 2]!;
    drops.swap.sink = edges[i + 1]!;
    drops.swap.climb = edges[i + 4]!;

    return;
  }
}

/** Folds neighbouring layers of the same liquid together and drops empty ones. */
function merge(drops: Drops): void {
  const kept: Band[] = [];

  for (const band of drops.bands) {
    if (band.area <= 0) {
      continue;
    }

    const last = kept[kept.length - 1];

    if (last?.liquid === band.liquid) {
      last.area += band.area;
      continue;
    }

    kept.push(band);
  }

  drops.bands = kept.length > 0 ? kept : drops.bands;
}

/**
 * Grows the bead hanging off the exchange surface, and the bubble pressed
 * against it from the other side.
 *
 * One pair at a time, and there is always one while an exchange is running: a
 * surface with two beads gathering at once reads as a leak rather than a drip,
 * and one with none reads as two blocks of colour with nothing happening
 * between them. The wait between beads is the gathering, and the gathering is
 * the part worth watching.
 */
function gather(drops: Drops, step: number, thickness: number): void {
  const swap = drops.swap;

  if (!swap) {
    // Nothing left to exchange. Whatever was still gathering has no surface to
    // gather off any more, so it lets go — and `carry` finds it nowhere to go
    // and draws it back into the layer it is in. The alternative is a bead
    // hanging off a settled column for ever, which is what the first go did.
    for (const bead of drops.beads) {
      bead.filling = 0;
    }

    return;
  }

  const { beadAcross } = drops;
  let gathering = false;

  for (const bead of drops.beads) {
    if (bead.filling <= 0) {
      continue;
    }

    gathering = true;

    const grown = bead.reach + ((bead.wants - bead.reach) * step) / Math.max(step, bead.filling);

    bead.reach = Math.min(bead.wants, grown);
    // Hangs further off the fuller it gets, which is what stretches the neck:
    // the surface and the bead still overlap, so what is drawn between them is
    // a waist rather than a gap, right up until it is one.
    place(drops, bead, swap.at + (bead.rising ? -1 : 1) * bead.reach * SEEN * PENDANT);
    bead.filling = Math.max(0, bead.filling - step);
  }

  if (gathering) {
    return;
  }

  const rng = mulberry32(drops.seed + drops.cast * 9973);

  drops.cast += 1;

  const wide = beadAcross * randomBetween(rng, 1 - BEAD_SPREAD, 1 + BEAD_SPREAD);
  // Along the surface, and clear of the wall by its own width, or a bead would
  // be born half outside the cell and shoved in on its first frame.
  const half = Math.sqrt(Math.max(0, CHAMBER_RADIUS * CHAMBER_RADIUS - swap.at * swap.at));
  const across = randomBetween(rng, -1, 1) * Math.max(0, half - wide * 2);
  // A pair with less left to exchange drips more slowly, which is why the real
  // ones have a long tail. The same clock the areas move on: see Swap.
  const head = Math.max(SLOWEST, 1 - swap.progress);
  const waits = (GATHER * (1 + THICKEST_DRIP * clamp(thickness))) / head;

  // Both at once, off the same surface, going opposite ways. It is the plainest
  // thing in the cell to watch and it is also simply what has to happen: the
  // heavy liquid cannot get down past the light one unless the light one is
  // coming up past it at the same moment, because there is nowhere else in a
  // sealed tube for either of them to go.
  for (const rising of [false, true]) {
    const bead: Bead = {
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      // Down means the heavier of the pair, which is the band above; up means
      // the lighter, which is the one below it.
      liquid: rising ? swap.rose.liquid : swap.fell.liquid,
      reach: (wide / SEEN) * LEFT,
      wants: wide / SEEN,
      // Side by side rather than on top of each other, or the two would be born
      // as one blob and leave the surface as one.
      across: across + (rising ? wide * randomBetween(rng, 0.9, 1.8) : 0),
      filling: waits,
      landing: false,
      rising,
      wander: rng() * Math.PI * 2,
    };

    place(drops, bead, swap.at + (rising ? -1 : 1) * bead.reach * SEEN * PENDANT);
    drops.beads.push(bead);
  }
}

/** Puts a bead at a distance along down and a distance across it. */
function place(drops: Drops, bead: Bead, along: number): void {
  bead.x = drops.downX * along - drops.downY * bead.across;
  bead.y = drops.downY * along + drops.downX * bead.across;
}

/** Moves everything that is in flight, and lands what has arrived. */
function carry(
  drops: Drops,
  step: number,
  thickness: number,
  swirl: number,
  stir: DropsUpdate['stir'],
): void {
  const { downX, downY, swap } = drops;
  const damping = Math.max(0, 1 - DRAG * (1 + THICKEST * clamp(thickness)) * step);
  const alive: Bead[] = [];

  for (const bead of drops.beads) {
    if (bead.filling > 0) {
      alive.push(bead);
      continue;
    }

    const along = bead.x * downX + bead.y * downY;
    // Where this one is going. A bead cast by an exchange that has since
    // finished has nowhere left to be, and is drawn into whatever it is in.
    const home = swap ? (bead.rising ? swap.climb : swap.sink) : null;
    const arrived = home === null || (bead.rising ? along <= home : along >= home);

    if (bead.landing || arrived) {
      // Drawn into the layer rather than deleted into it: it shrinks over a
      // fraction of a second and the surface it is joining is already there to
      // meet it. Neither end of that is a frame where the picture jumps.
      bead.landing = true;
      bead.reach = Math.max(0, bead.reach - (drops.beadAcross / SEEN / SINK) * step);
      bead.x += downX * (bead.rising ? -0.1 : 0.1) * step;
      bead.y += downY * (bead.rising ? -0.1 : 0.1) * step;

      if (bead.reach > 1e-4) {
        alive.push(bead);
      }

      continue;
    }

    // Terminal drift rather than a slow acceleration, which is what a bead in a
    // liquid does: the weight it drifts under is already net of what it floats
    // in, and the drag turns that into a speed rather than a rate of gain.
    bead.wander += WANDER_RATE * step;

    const side = Math.sin(bead.wander) * WANDER;
    const pull = bead.rising ? -RISE : FALL;
    const flowX = -swirl * bead.y;
    const flowY = swirl * bead.x;
    const pushX = downX * pull - downY * side;
    const pushY = downY * pull + downX * side;

    bead.vx = flowX + (bead.vx + pushX * step - flowX) * damping;
    bead.vy = flowY + (bead.vy + pushY * step - flowY) * damping;

    // Carried along with the finger rather than shoved by it, the same rule the
    // wax next door is pushed with.
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
 * Where every surface in the column lies, in cell units along down.
 *
 * One more than there are bands: the first is the floor of the cell and the
 * last is its ceiling, and `edges[i]` is the bottom of band `i`. They come out
 * in descending order, because down is the positive direction and the bottom of
 * the cell is the largest value in it.
 */
export function surfacesOf(drops: Drops, into: number[]): void {
  let sum = 0;

  into.length = 0;
  into.push(CHAMBER_RADIUS);

  for (const band of drops.bands) {
    sum += band.area;
    into.push(CHAMBER_RADIUS * chordFor(sum));
  }
}

/** Scratch for the surfaces, which are wanted twice a frame. */
const edges: number[] = [];

/**
 * Where the surface of a layer holding this much lies, as a share of the radius.
 *
 * The area of a disc beyond a chord at `u·R` is `R²(acos u - u√(1-u²))`, which
 * has no inverse worth writing down, so it is bisected. Twenty four halvings of
 * `[-1, 1]` is the last bit of a float, and it runs a handful of times a frame.
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

/** The shortest way round from one angle to another. */
function wrap(angle: number): number {
  return angle - Math.PI * 2 * Math.round(angle / (Math.PI * 2));
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Smoothstep, for an edge that eases in and out rather than ramping. */
function smooth(at: number): number {
  return at <= 0 ? 0 : at >= 1 ? 1 : at * at * (3 - 2 * at);
}

/**
 * Paints the cell onto a small canvas, {@link FINE} pixels per grid cell.
 *
 * Every pixel inside the wall is liquid — that is what a sealed tube is — so
 * there is nothing to make transparent and nothing to composite: what is worked
 * out here is *how much of each liquid* the light has to cross, and the colour
 * is the three tints raised to those shares and multiplied together. Beer and
 * Lambert, three deep. Drawn with `multiply` by the renderer, so the tints are
 * three things light passes through rather than three coats of paint.
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

  shadeFor(drops.tints);
  layers(drops);

  const anyBeads = spread(drops, width);
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

  const edge = CHAMBER_RADIUS - width;

  for (let j = 0; j < across; j += 1) {
    const y = -CHAMBER_RADIUS + (j + 0.5) * fine;
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
      // The meniscus, as a share of how near the wall this is. Every surface in
      // the column is pushed the same way by it, which is up: the heavier
      // liquid of any pair is the one that wets the glass.
      const near = Math.max(0, 1 - (CHAMBER_RADIUS - away) / WETS);
      const along = x * drops.downX + y * drops.downY + CLIMB * near * near;
      const step = (along + SPAN) * (PROFILE / (2 * SPAN)) - 0.5;
      const low = Math.min(PROFILE - 2, Math.max(0, Math.floor(step)));
      const blend = Math.min(1, Math.max(0, step - low));
      const iLeft = lefts[i]!;
      const iRight = rights[i]!;
      const fx = eased[i]!;
      const cell = rowUp + iLeft;

      // Almost every pixel is layer and nothing else, and for those the colour
      // depends only on how far down the cell they are — so it is read
      // straight off the profile the layers were solved into, which is one
      // interpolation rather than three fields and nine table lookups.
      if (!anyBeads || !busy[cell]) {
        const one = low * 3;
        const two = one + 3;

        pixels[at] = tones[one]! + (tones[two]! - tones[one]!) * blend;
        pixels[at + 1] = tones[one + 1]! + (tones[two + 1]! - tones[one + 1]!) * blend;
        pixels[at + 2] = tones[one + 2]! + (tones[two + 2]! - tones[one + 2]!) * blend;
        pixels[at + 3] = away <= edge ? 255 : Math.round((1 - (away - edge) / width) * 255);
        continue;
      }

      let total = 0;

      for (let liquid = 0; liquid < LIQUIDS; liquid += 1) {
        const held = field[liquid]!;
        // The beads, read off their own grid with eased weights so the join
        // between two cells has no kink in it, and then thresholded — which is
        // what makes two beads that meet neck together rather than overlap.
        const sum =
          (1 - fy) * ((1 - fx) * held[rowUp + iLeft]! + fx * held[rowUp + iRight]!) +
          fy * ((1 - fx) * held[rowDown + iLeft]! + fx * held[rowDown + iRight]!);
        const body = Math.min(1, Math.max(0, (sum - SURFACE) / (1 - SURFACE)));
        // How much of this liquid the light has to cross here, and it is the
        // field that says: a bead is a bead-shaped body and not a disc of
        // colour, so there is more of it in the middle than at the rim.
        const much = smooth((sum - SURFACE) / (2 * BAND) + 0.5) * (RIM + (1 - RIM) * body);

        parts[liquid] = much;
        total += much;
      }

      // What the beads do not cover is the column, in the proportions the
      // profile has at this height.
      const rest = total > 1 ? 0 : 1 - total;
      const scale = total > 1 ? 1 / total : 1;
      let red = 255;
      let green = 255;
      let blue = 255;

      for (let liquid = 0; liquid < LIQUIDS; liquid += 1) {
        const share =
          parts[liquid]! * scale +
          rest *
            (bands[low * LIQUIDS + liquid]! +
              (bands[(low + 1) * LIQUIDS + liquid]! - bands[low * LIQUIDS + liquid]!) * blend);
        const shade = (liquid * SHADES + Math.round(share * (SHADES - 1))) * 3;

        red *= shades[shade]!;
        green *= shades[shade + 1]!;
        blue *= shades[shade + 2]!;
      }

      pixels[at] = red;
      pixels[at + 1] = green;
      pixels[at + 2] = blue;
      // Softened over the last cell of the wall, so the disc has an edge and
      // not a staircase. Everything past it is not in the tube at all.
      pixels[at + 3] = away <= edge ? 255 : Math.round((1 - (away - edge) / width) * 255);
    }
  }

  ctx.putImageData(image, 0, 0);

  return canvas;
}

/**
 * How thick a liquid is at the surface of a bead, as a share of the whole.
 *
 * Not nought, or a bead would fade out at its edge instead of having one — and
 * not one, or it would be a flat disc of colour. Half gives a bead a deep
 * middle and a lighter rim, which is what looking through a round thing does.
 */
const RIM = 0.5;

/** How wide the soft edge of a bead is, as a share of its field. */
const BAND = 0.12;

/** Steps in the shade table. Any more is finer than a byte can tell. */
const SHADES = 48;

/** Every depth of every liquid, as the share of the light it passes. */
const shades = new Float32Array(LIQUIDS * SHADES * 3);

/**
 * Fills {@link shades} for a set of liquids.
 *
 * Beer and Lambert: each unit of liquid passes a fixed *share* of what reaches
 * it, so what comes through a depth `d` is the tint raised to `d` rather than
 * scaled by it. Held as a share of one rather than as a colour, so the three
 * are multiplied together at the pixel and the answer is what got through all
 * of them — which is the whole of why nothing in here has to decide what a bead
 * crossing a layer looks like.
 */
function shadeFor(tints: Drops['tints']): void {
  for (let liquid = 0; liquid < LIQUIDS; liquid += 1) {
    const tint = tints[liquid]!;

    for (let k = 0; k < SHADES; k += 1) {
      const depth = k / (SHADES - 1);
      const at = (liquid * SHADES + k) * 3;

      shades[at] = Math.pow(tint[0] / 255, depth);
      shades[at + 1] = Math.pow(tint[1] / 255, depth);
      shades[at + 2] = Math.pow(tint[2] / 255, depth);
    }
  }
}

/**
 * Steps in the column's profile, and how far it reaches past the wall.
 *
 * The layers are flat and perpendicular to down, so what liquid is where
 * depends on one number — how far down the cell the pixel is — and that is a
 * curve rather than a picture. Solved once a frame into a table a few hundred
 * long and read back with a linear interpolation, which is what lets the
 * painting below do a pixel of plain layer in three table reads.
 *
 * Reaching past the wall is the meniscus: a pixel at the very edge is asked
 * what the column holds a little further down than it really is.
 */
const PROFILE = 384;
const SPAN = CHAMBER_RADIUS + CLIMB + POOL_REACH;

/** How much of each liquid the column holds at each step. Sums to one inside. */
const bands = new Float32Array(PROFILE * LIQUIDS);

/** And what colour that is, for the pixels no bead reaches. */
const tones = new Float32Array(PROFILE * 3);

/** Solves the column into {@link bands} and {@link tones}. */
function layers(drops: Drops): void {
  surfacesOf(drops, edges);
  bands.fill(0);

  for (let s = 0; s < PROFILE; s += 1) {
    const along = -SPAN + ((s + 0.5) * 2 * SPAN) / PROFILE;
    const at = s * LIQUIDS;

    // Each band is what is below its top surface and not below its bottom one,
    // with both smeared over POOL_REACH so a surface is a liquid's and not a
    // cut-out's. Telescoping, so the three always add to exactly one.
    for (let band = 0; band < drops.bands.length; band += 1) {
      const liquid = drops.bands[band]!.liquid;
      const share =
        smooth((along - edges[band + 1]!) / POOL_REACH + 0.5) -
        smooth((along - edges[band]!) / POOL_REACH + 0.5);

      bands[at + liquid] = bands[at + liquid]! + share;
    }

    let red = 255;
    let green = 255;
    let blue = 255;

    for (let liquid = 0; liquid < LIQUIDS; liquid += 1) {
      const shade = (liquid * SHADES + Math.round(bands[at + liquid]! * (SHADES - 1))) * 3;

      red *= shades[shade]!;
      green *= shades[shade + 1]!;
      blue *= shades[shade + 2]!;
    }

    tones[s * 3] = red;
    tones[s * 3 + 1] = green;
    tones[s * 3 + 2] = blue;
  }
}

/** Where the beads are, one field per liquid, and which cells they reach. */
const field = Array.from({ length: LIQUIDS }, () => new Float32Array(GRID * GRID));
const busy = new Uint8Array(GRID * GRID);

/**
 * Lays every bead into its own liquid's field.
 *
 * {@link busy} is the cheap half of it: a bead touches a few dozen cells out of
 * sixteen thousand, and marking which ones lets the painting take the plain
 * layer path — one interpolation instead of three fields and nine lookups — for
 * the ninety-odd per cent of the picture that has no bead anywhere near it.
 *
 * @returns Whether there was anything to lay down at all.
 */
function spread(drops: Drops, width: number): boolean {
  let any = false;

  for (const held of field) {
    held.fill(0);
  }

  busy.fill(0);

  for (const bead of drops.beads) {
    const span = bead.reach * bead.reach;

    if (span <= 0) {
      continue;
    }

    any = true;

    const held = field[bead.liquid]!;
    const from = Math.max(0, Math.floor((bead.x - bead.reach + CHAMBER_RADIUS) / width) - 1);
    const to = Math.min(GRID - 1, Math.ceil((bead.x + bead.reach + CHAMBER_RADIUS) / width) + 1);
    const start = Math.max(0, Math.floor((bead.y - bead.reach + CHAMBER_RADIUS) / width) - 1);
    const end = Math.min(GRID - 1, Math.ceil((bead.y + bead.reach + CHAMBER_RADIUS) / width) + 1);

    for (let j = start; j <= end; j += 1) {
      const y = -CHAMBER_RADIUS + (j + 0.5) * width - bead.y;
      const row = j * GRID;

      for (let i = from; i <= to; i += 1) {
        // A cell either side of the bead as well as under it, because the
        // painting reads the field bilinearly and would otherwise clip the
        // edge of the last cell the bead reaches.
        busy[row + i] = 1;

        const x = -CHAMBER_RADIUS + (i + 0.5) * width - bead.x;
        const at = (x * x + y * y) / span;

        if (at >= 1) {
          continue;
        }

        held[row + i] = held[row + i]! + (1 - at) * (1 - at);
      }
    }
  }

  return any;
}

/** Scratch for one pixel's worth, which is worked out tens of thousands of times. */
const parts = [0, 0, 0];

/** Where each painted column sits, and which two cells of the field it reads. */
let columns = new Float32Array(0);
let lefts = new Int32Array(0);
let rights = new Int32Array(0);
let eased = new Float32Array(0);

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
