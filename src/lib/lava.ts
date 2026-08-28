import { CHAMBER_RADIUS } from './chamber';
import { mulberry32, randomBetween } from './random';

/**
 * A lava lamp in the object cell.
 *
 * Not glass in a liquid — liquid instead of glass. What is in the cell is a
 * second fluid that will not mix with the first: blobs of it climb, flatten,
 * cool, sink, run into each other on the way and come apart when they are
 * stretched. None of it is a picture of a blob — the shapes are whatever the
 * arithmetic gives.
 *
 * The first build of this simulated *blobs*: a handful of large metaballs
 * with explicit rules for when two became one and when one became two. Every
 * artifact it fought — the two-frame stagger, the pop on split, the settle
 * timer that existed only to break the merge/split loop — came from the same
 * place: the discrete rules were re-deciding topology the metaball field was
 * already deciding continuously, and the two disagreed at frame rate. The
 * record of that fight is in ROADMAP.md, "A lava lamp".
 *
 * So this build simulates *wax*, and lets the field alone decide what a blob
 * is. The wax is a few dozen small particles with the short-range behaviour
 * of a liquid — pressed apart when crowded, drawn together when near — after
 * Clavet, Beaudoin and Poulin, _Particle-based Viscoelastic Fluid Simulation_
 * (SCA 2005): their double density relaxation, which is a pressure from how
 * crowded a particle is plus a sharper one from its very nearest neighbours,
 * applied as position displacements. Merging and splitting are not events any
 * more. Two clumps that drift together interleave and their summed fields
 * neck and join; a clump stretched by the convection thins in the middle, the
 * field drops below the surface, and it pinches in two — with the neck drawn
 * correctly on the way, because drawing necks is what metaball fields do.
 * There is nothing left to stagger.
 *
 * **The heat cycle** is carried over from the first build, because it was
 * right — including the part that was hard-won: heat must track *history*,
 * not height. A particle warms only near the bottom and cools only near the
 * top, and in between it keeps what it has; aimed instead at a temperature
 * read off its own height, lift points at the middle from both directions and
 * the cycle is a spring — the first build measured the whole cell converging
 * to its centre and stopping inside twenty seconds. Two things are new, both
 * from how convection actually works (Boussinesq, Rayleigh–Bénard): **heat
 * diffuses between neighbouring particles**, so a warm patch rises as one
 * plume rather than as loose particles, and **cold wax is stiffer than hot**,
 * so what has cooled at the top slumps and hangs while the risers run.
 *
 * Coordinates are in cell units, centred on the chamber, and gravity arrives
 * in the cell's own frame — so turning the tube sweeps the whole circulation
 * round with it.
 */
export interface Drop {
  /** Where it is, in cell units. */
  x: number;
  y: number;
  /** How fast, in cell units per second. */
  vx: number;
  vy: number;
  /** How warm it is: 0 cold and sinking, 1 warm and climbing. */
  heat: number;
  /**
   * What colour its wax is, as red, green and blue.
   *
   * Carried rather than looked up, and it spreads between touching drops the
   * way heat does — see {@link blend}. A palette index would speckle: a body
   * of wax is a few dozen drops that have drifted in from wherever, and drawn
   * from their own indices it comes out mottled pink and orange rather than
   * being *a colour*. The old build carried a colour per blob for exactly this
   * reason and averaged it on a merge; this is the same thing said
   * continuously, and it is what makes two clumps running together blend over
   * a second or so instead of interleaving into speckle.
   */
  red: number;
  green: number;
  blue: number;
  /**
   * Which of the {@link TINTS} its wax actually is, which never changes.
   *
   * The shown colour above drifts towards its neighbours' and is drawn slowly
   * back to this — see {@link TINT_HOLD}. Two kinds of wax interleaving is not
   * two kinds of wax *dissolving*: what mixes is what you see.
   */
  readonly wax: readonly [number, number, number];
}

export interface Lava {
  drops: Drop[];
  /** Seconds banked since the last step of the wax. See {@link RATE}. */
  due: number;
  /**
   * How far each drop's field reaches, in cell units. One size for the whole
   * cell: the wax is one substance, and uniform particles are what lets the
   * density relaxation find one rest spacing.
   */
  readonly reach: number;
  readonly seed: number;
}

/**
 * Cells across the chamber the surface is worked out on.
 *
 * The field is smooth, so this is not resolving detail — it is deciding how
 * accurately the *edge* lands, because the surface is a contour through it
 * and a coarse grid puts that contour a cell's width out.
 *
 * Which is exactly what went wrong at 128. The cell is drawn across
 * `2 * side / sqrt(3)` device pixels, so on a phone at the default zoom one
 * grid cell was three device pixels and at the far end of the zoom slider
 * nearly eight — and the wax came out visibly blocky, its edges stepping in
 * squares rather than curving. Bilinear filtering does not save it: the
 * contour of a bilinearly reconstructed field kinks at every cell boundary,
 * and at eight pixels a kink those kinks *are* the staircase. At 256 the
 * contour lands within about a pixel and a half at the widest the slider
 * goes, which is under the eye's resolution for an edge, and the blocks are
 * gone. See ROADMAP.md, "A lava lamp", for the measured cost of the change.
 */
export const GRID = 256;

/**
 * How many cells apart the two samples the normal is differenced from are.
 *
 * The contour wants the fine grid and the normal does not, and they are not
 * the same want. The surface is where the field crosses {@link SURFACE}, and
 * that is worth resolving as finely as can be afforded. The *normal* is meant
 * to describe the body of wax, and differenced cell to cell at 256 it
 * describes something else: the packing of the individual particles, which
 * comes out as creases between them and — through a specular this tight — as
 * a hard streak along every one. Differenced across four cells it spans what
 * the old 128 grid's own neighbours spanned, so the light falls where it has
 * always fallen and only the edge gets the finer grid.
 */
const SLOPE_STEP = GRID / 128;

/**
 * Where the surface is, as a sum of the drops' fields.
 *
 * A drop's own field peaks at 1 in its middle, so this is above what any one
 * of them can reach on its own: it takes two overlapping to cross it, and a
 * clump crosses it well outside any one member. That is what makes a few dozen
 * particles read as one body of wax with a surface rather than as the
 * particles — and it is deliberately higher than it was, against a drawn reach
 * that is deliberately wider, because the pair is what decides how *fat* and
 * how smooth a body comes out. See {@link DRAWN}.
 *
 * It moves with {@link DRAWN} and it has to: the summed field goes as the area
 * of a drop's kernel, so widening the reach without raising this fills the
 * cell with one connected sheet of wax. The two were raised together, in
 * proportion to the square of the reach, and the wax covers what it covered.
 */
const SURFACE = 1.5;

/**
 * How much of the cell the wax covers.
 *
 * Sized on the drawn discs as if separate, which understates it — clumped
 * fields cross the surface in the gaps — so this is lower than the coverage
 * that lands on screen.
 */
const COVER = 0.2;

/** Particles at the two ends of the Amount slider. */
const FEWEST = 36;
const MOST = 104;

/** Downward acceleration, matched to the chamber's own. */
const GRAVITY = 6;

/**
 * How hard the heat cycle drives, as a share of gravity.
 *
 * More than twice what it was, and with {@link DRAG} it is half of why the
 * cell holds several bodies of wax rather than one. Surface tension always
 * wins in a small cell left alone — the wax has one lowest-energy shape and it
 * is a single blob — so what keeps a lamp looking like a lamp is that the
 * circulation tears bodies apart about as fast as they run together. Under a
 * gentle drive it does not, and every cell ended as one sausage circling the
 * tube.
 */
const BUOYANCY = 1.3;

/**
 * How fast a drop takes the temperature of the end of the cell it is at.
 *
 * Per second, and only while it is at an end — see {@link ENDS}.
 */
const EXCHANGE = 0.8;

/**
 * How much of each end of the cell is warm or cold, as a share of the radius.
 *
 * The bulb at the bottom, the cool glass at the top, and **in between a drop
 * keeps whatever heat it has**. The lag is the cycle — see the module note.
 */
const ENDS = 0.35;

/**
 * How fast heat spreads between touching drops, per second.
 *
 * Nought, and that is a finding rather than an omission. It was 1.6, on the
 * reasoning that a warm patch should rise as one plume rather than as loose
 * particles — which it does, and the cost is the whole substance. Heat that
 * spreads through a body makes every drop in it the same temperature, a body
 * at one temperature rises or sinks as a rigid lump, and a lump that is never
 * sheared is never stretched and never pinches. Every cell ended as one
 * sausage of wax circling the tube, which is not a lava lamp and is not what
 * the first build looked like.
 *
 * The *difference* in temperature across a body is what a lamp runs on: the
 * end of a blob that has reached the cool glass sinks while the rest of it is
 * still climbing, the blob stretches, and where it thins the field drops below
 * the surface and it comes apart. That is the Rayleigh-Plateau break-up the
 * module note promises, and it only happens if the drops are allowed to
 * disagree about how hot they are.
 *
 * Kept as a constant, with the plumbing intact, because it is a real knob and
 * a small amount of it may yet be wanted — see ROADMAP.md.
 */
const HEAT_SPREAD = 0;

/**
 * How fast colour spreads between touching drops, per second.
 *
 * What heat used to do, applied to the thing that actually wanted it. A body
 * of wax is a few dozen drops that have drifted together from wherever, so
 * drawn from their own colours it comes out mottled rather than being *a*
 * colour; spread between touching drops, a body settles to one colour within a
 * second or two and two bodies running together blend into the mixture, which
 * is the thing worth watching and is what the first build did on a merge.
 */
const TINT_SPREAD = 0.15;

/**
 * How fast a drop's shown colour is drawn back to its own wax, per second.
 *
 * Spreading colour between touching drops is what makes a body *a* colour, and
 * left on its own it has one end: everything in the cell touches everything
 * else eventually, every mixture is a mixture of mixtures, and after a few
 * minutes the whole cell is the average of the four — the puddle the palette
 * note warns about, arrived at by a different road. This is the wax being wax
 * rather than dye. It is far slower than the spreading, so a body still reads
 * as one colour and two bodies running together still visibly blend; what it
 * stops is the blend being permanent, and it is why the cell still holds four
 * colours of wax after ten minutes.
 */
const TINT_HOLD = 0.09;

/** How much stiffer stone-cold wax is than running-hot wax. */
const COLD_STIFF = 1.4;

/**
 * Speed lost per second by hot wax in thin fluid, before either scales it.
 *
 * A quarter of what it was, which is the other half of the break-up above: it
 * is the *terminal* speed a drop reaches under the heat cycle that has to beat
 * the cohesion holding a body together, and at the old drag that speed was
 * about a third of a cell width a second — under half what it takes to stretch
 * a body until it necks. The Thickness slider still multiplies this by up to
 * {@link THICKEST}, so a gel cell still hangs.
 */
const DRAG = 0.6;

/** How much thicker the far end of the Thickness slider is. */
const THICKEST = 4;

/**
 * The double density relaxation, in the paper's shape.
 *
 * `REST` is the crowding a particle is content with; below it the pressure
 * goes negative and near neighbours are *drawn in*, which is the surface
 * tension that rounds a blob off. `STIFF` scales the pressure into
 * displacement and `STIFF_NEAR` scales the sharper near-pressure that stops
 * the attraction collapsing a clump to a point. The near term has no negative
 * side, by construction: crowding can pull, but closeness only pushes.
 */
const REST = 2.6;
const STIFF = 0.004;
const STIFF_NEAR = 0.02;

/** Neighbour radius, in multiples of a drop's drawn reach. */
const NEIGHBOURHOOD = 1.8;

/**
 * How far a drop's *drawn* field reaches, in multiples of the same.
 *
 * Wider than the physics, and much wider than it was. The drawn field decides
 * the shape of the body, not the arithmetic that moves the particles, so this
 * is the knob that says how fat and how smooth a clump of drops comes out —
 * and at 1.55, against a surface a single drop could cross on its own, a body
 * came out as the lumpy union of its members, every particle a bump on the
 * surface and every gap a crease for the light to catch. Widened, with
 * {@link SURFACE} raised to match so the wax covers the same ground, the same
 * particles read as one smooth body with a rounded edge. Nothing about how the
 * wax *moves* changed with it.
 *
 * Widened again since, for the last of the same fault: at 2.2 the edge of a
 * body still carried a fine scalloping — a ripple at the spacing of the
 * particles under it — which is invisible at the default zoom and plain at the
 * top of the slider, where a cell is drawn three times the size. The kernel is
 * what smooths the particles into a field, so the cure for a lumpy contour is
 * a wider kernel and not a finer grid.
 */
const DRAWN = 2.5;

/** Fastest the wax moves, in cell units per second. Wax oozes; it does not dart. */
const FASTEST = 1.6;

/**
 * How much of the wax's own time a second of the clock buys, thin to gel.
 *
 * The Thickness slider, and it is the only honest place to put it. Everything
 * else that could slow the wax down changes what the wax *is*: more drag and
 * the terminal speed falls under what it takes to stretch a body until it
 * necks, so the cell ends as one sausage circling the tube — which is the
 * finding recorded on {@link DRAG} and on {@link HEAT_SPREAD}, arrived at twice
 * from different directions. Dilating time changes nothing at all. The wax
 * still reaches the same speeds in its own frame, still breaks up at the same
 * places, still holds the same number of bodies; a second of watching just
 * buys less of it.
 *
 * It had to be put somewhere, because before this the slider did almost
 * nothing. Every drop rides the {@link FASTEST} cap nearly all the time — the
 * heat cycle drives at several times the speed the drag can spend, so terminal
 * speed is above the cap at *both* ends of the slider and what is left of the
 * difference is the cold wax hanging. Measured over twenty seconds at the top
 * of the slider the wax averaged 0.53 cell widths a second, against 1.14 at
 * the bottom: a gel that ran at half the speed of a thin oil and crossed the
 * whole cell in four seconds, which is not what a lamp does and is what
 * prompted this.
 */
const PACE_THIN = 0.55;
const PACE_GEL = 0.26;

/**
 * Steps of the wax per second, and the most of them one frame may run.
 *
 * A *fixed* step, banked, rather than whatever the frame happened to be —
 * which is not a nicety here. The relaxation is a position solver: it moves a
 * drop by the pressure times the square of the step, so its strength grows as
 * the square of a slow frame and its stability falls the same way. At sixty
 * frames a second it is exactly as tuned; at twenty, which is all the clamp
 * used to allow, every displacement is *nine times* what these constants mean
 * and the wax blows itself apart into a spray of separate droplets. That is a
 * substance that looks like a different substance on a phone under load, and
 * it is not something a viewer can be expected to understand.
 *
 * Banked and fixed, a slow frame runs the wax two or three times instead of
 * once and it looks the same everywhere; below about twenty frames a second
 * the cap takes over and the wax runs slow rather than wrong, which is the
 * right way round. The fluids in `lib/flow.ts` bank on the same reasoning.
 *
 * This is a rate of *steps*, not a rate of the wax's own time: how much time
 * each step advances is {@link PACE_THIN}. Sixty steps a second is what keeps
 * the motion smooth, and it stays sixty however slowly the wax is running —
 * a gel taken by running six full steps a second instead of sixty small ones
 * would judder, which is the trap the obvious way of slowing it down walks
 * into.
 */
const RATE = 60;
const MOST_STEPS = 3;

/**
 * The light on the wax: what a surface facing away still gets, how much more
 * one facing the light gets, and how bright the specular is.
 *
 * Much softer than the first go, which had a shaded side at 0.62 — dark enough
 * to turn the orange wax brown — and a specular of 190 through a
 * twenty-fourth power, which draws a hard white streak along every ridge and,
 * on the lumpy surface that build had, along every few pixels. What is wanted
 * is the *rounding*: a rim that falls away and a soft sheen.
 *
 * They are up again from where that correction left them, because it went one
 * stop too far the other way: at a shading of 0.88 against a throw of 0.22 the
 * wax had no roundness left at all, and a screenshot at any zoom showed flat
 * pink shapes with a coloured edge. The surface is smooth now — see
 * {@link DRAWN} — so a stronger light has nothing to catch on, and what it
 * does instead is the thing it is for: the wax comes forward in the middle and
 * turns away at the rim.
 */
const AMBIENT = 0.8;
const THROW = 0.34;
const GLEAM = 95;

/**
 * What the wax is coloured with.
 *
 * All four warm, and that is the whole of why they are these four: wax mixes
 * where clumps interleave, mixing averages, and averaging colours from
 * opposite sides of the wheel gives mud — the first build proved it with
 * rose, amber, violet and teal, and a minute later the cell was the colour of
 * a puddle. Neighbours on the wheel average to neighbours on the wheel.
 */
const TINTS: readonly [number, number, number][] = [
  [244, 63, 94],
  [251, 113, 43],
  [250, 176, 46],
  [219, 39, 119],
];

/** Builds a cell of lava, deterministically, in a few clumps of wax. */
export function createLava(seed: number, amount: number, scale = 1): Lava {
  const rng = mulberry32(seed);
  const count = Math.max(8, Math.round(FEWEST + (MOST - FEWEST) * clamp(amount)));
  const reach = CHAMBER_RADIUS * Math.sqrt(COVER / count) * 1.9 * Math.max(0.35, Math.sqrt(scale));
  const drops: Drop[] = [];

  // Poured as a few clumps rather than a scatter: the cell opens holding
  // blobs, mid-circulation, instead of taking half a minute to gather itself.
  const clumps = Math.max(2, Math.round(2 + 3 * clamp(amount)));
  const centres = Array.from({ length: clumps }, () => {
    const angle = rng() * Math.PI * 2;
    const distance = Math.sqrt(rng()) * CHAMBER_RADIUS * 0.65;

    return {
      x: Math.cos(angle) * distance,
      y: Math.sin(angle) * distance,
      heat: rng(),
      tint: TINTS[Math.min(TINTS.length - 1, Math.floor(rng() * TINTS.length))]!,
    };
  });

  for (let i = 0; i < count; i += 1) {
    const home = centres[i % clumps]!;
    const angle = rng() * Math.PI * 2;
    const distance = Math.sqrt(rng()) * reach * 2.2;

    drops.push({
      x: clampWall(home.x + Math.cos(angle) * distance, reach),
      y: clampWall(home.y + Math.sin(angle) * distance, reach),
      vx: 0,
      vy: 0,
      // The clump's own warmth, spread a little, so the cell opens with
      // risers and sinkers rather than everything waiting at the bottom.
      heat: clamp(home.heat + randomBetween(rng, -0.15, 0.15)),
      red: home.tint[0],
      green: home.tint[1],
      blue: home.tint[2],
      wax: home.tint,
    });
  }

  return { drops, reach, seed, due: 0 };
}

function clampWall(value: number, reach: number): number {
  const limit = CHAMBER_RADIUS - reach * 0.6;

  return Math.min(limit, Math.max(-limit, value));
}

export interface LavaUpdate {
  /** Seconds to advance. */
  dt: number;
  /** How thick the fluid is, 0 thin to 1 gel. */
  thickness: number;
  /** How fast the fluid is turning within the cell, radians per second. */
  swirl: number;
  /** Which way is down in the cell's own frame, radians. */
  angle: number;
  /** A finger in the cell, pushing the wax it touches. */
  stir?: { x: number; y: number; vx: number; vy: number } | null | undefined;
}

/** Scratch, sized to the most drops a cell can hold. */
const density = new Float32Array(MOST);
const nearDensity = new Float32Array(MOST);
const previousX = new Float32Array(MOST);
const previousY = new Float32Array(MOST);
const warmed = new Float32Array(MOST);
const reddened = new Float32Array(MOST);
const greened = new Float32Array(MOST);
const blued = new Float32Array(MOST);

/**
 * Advances the wax in place: forces, then the relaxation, then the wall —
 * and velocity read back off how far each drop actually travelled, which is
 * the same position-based ledger the glass chamber keeps.
 */
export function updateLava(lava: Lava, update: LavaUpdate): void {
  if (!(update.dt > 0) || lava.drops.length === 0) {
    return;
  }

  // Real seconds between steps, and how much of the wax's own time each one
  // advances. The first is fixed so the motion is smooth; the second is the
  // Thickness slider. See {@link PACE_THIN}.
  const beat = 1 / RATE;
  const pace = PACE_THIN + (PACE_GEL - PACE_THIN) * clamp(update.thickness);

  lava.due += update.dt;

  // Banked, and never more than a few at once: a tab that has been in the
  // background for a minute comes back to a cell that has moved on a little,
  // not to one that has run a minute of wax in a single frame.
  for (let run = 0; run < MOST_STEPS && lava.due >= beat; run += 1) {
    lava.due -= beat;
    stepLava(lava, update, beat * pace, pace);
  }

  if (lava.due > MOST_STEPS * beat) {
    lava.due = MOST_STEPS * beat;
  }
}

/**
 * One fixed step of the wax. See {@link updateLava}, which banks the time.
 *
 * @param step How much of the wax's own time to advance.
 * @param pace How much of that time a second of the clock buys. The wall's
 *   turning is quoted in real seconds and has to be divided through by it: the
 *   wax runs in slow motion, the hand holding the tube does not, and a gel that
 *   turned at a quarter of the speed of the tube it was sealed in would be a
 *   plain mistake rather than a thick liquid. A finger is not — see the note
 *   where the stir is applied.
 */
function stepLava(
  lava: Lava,
  { thickness, swirl, angle, stir }: LavaUpdate,
  step: number,
  pace: number,
): void {
  const { drops, reach } = lava;
  const downX = Math.sin(angle);
  const downY = Math.cos(angle);
  const thick = 1 + THICKEST * clamp(thickness);
  const h = reach * NEIGHBOURHOOD;
  const turning = swirl / pace;

  for (let i = 0; i < drops.length; i += 1) {
    const drop = drops[i]!;
    // How far down the cell it is, from -1 at the top to 1 at the bottom, in
    // whichever direction down currently happens to be.
    const along = (drop.x * downX + drop.y * downY) / CHAMBER_RADIUS;
    const warming = Math.max(0, (along - ENDS) / (1 - ENDS));
    const cooling = Math.max(0, (-along - ENDS) / (1 - ENDS));

    drop.heat = clamp(drop.heat + (warming - cooling) * EXCHANGE * step);

    // Warm is lighter than what it floats in and climbs; cold is heavier and
    // sinks. Nothing else lifts the wax, which is why the cell circulates.
    const lift = (0.5 - drop.heat) * 2 * BUOYANCY;
    const flowX = -turning * drop.y;
    const flowY = turning * drop.x;
    // Cold wax is stiffer: what has cooled at the top slumps and hangs while
    // the hot risers run. One factor, a lot of wax-ness.
    const damping = Math.max(0, 1 - DRAG * thick * (1 + COLD_STIFF * (1 - drop.heat)) * step);

    drop.vx = flowX + (drop.vx + downX * GRAVITY * lift * step - flowX) * damping;
    drop.vy = flowY + (drop.vy + downY * GRAVITY * lift * step - flowY) * damping;

    if (stir) {
      // How far a finger's push reaches, and it widens with the Thickness
      // slider because that is what viscosity *is*: how far momentum spreads
      // sideways before the drag has spent it. A narrow push through a gel is
      // a hole cut in it, and a cell of wax stirred that way comes apart into
      // a spray of droplets that then takes the whole of its own slow clock to
      // gather again. A wide one takes a body of wax along with it, which is
      // what stirring treacle does.
      const finger = CHAMBER_RADIUS * (0.3 + 0.4 * clamp(thickness));
      const away = Math.hypot(drop.x - stir.x, drop.y - stir.y) / finger;

      if (away < 1) {
        const much = (1 - away) * (1 - away);

        // In the wax's own time, and *not* divided through by the pace the way
        // the wall's turning is. The two are different in kind: the wall turns
        // the whole cell rigidly and a rigid turn cannot deform anything, so it
        // has to be right in real seconds or the wax visibly lags the tube it
        // is sealed in. A finger is a local shear, and quoted in real seconds
        // it becomes, in the wax's own frame, a shear four times anything these
        // constants were tuned against — four flicks at the top of the
        // Thickness slider tore a cell of wax into a spray of separate
        // droplets, which is the failure mode {@link RATE} exists to prevent
        // arriving by another road. Left in the wax's time, a gel follows a
        // finger slowly, which is what a gel does.
        drop.vx += (stir.vx - drop.vx) * much;
        drop.vy += (stir.vy - drop.vy) * much;
      }
    }

    previousX[i] = drop.x;
    previousY[i] = drop.y;
    drop.x += drop.vx * step;
    drop.y += drop.vy * step;
  }

  relax(lava, h, step);
  blend(lava, h, step);

  for (let i = 0; i < drops.length; i += 1) {
    const drop = drops[i]!;

    confine(drop, reach);
    // Velocity is where it ended up, not where it was sent: the relaxation
    // and the wall have both had their say, and the ledger has to agree.
    drop.vx = (drop.x - previousX[i]!) / step;
    drop.vy = (drop.y - previousY[i]!) / step;

    // Wax does not dart. The relaxation can land a crowded drop a long way
    // in one frame, and read back as velocity that would be a kick it never
    // received; the cap keeps the ledger honest without touching where
    // anything ended up.
    const speed = Math.hypot(drop.vx, drop.vy);

    if (speed > FASTEST) {
      drop.vx *= FASTEST / speed;
      drop.vy *= FASTEST / speed;
    }
  }
}

/**
 * The double density relaxation. See the constants above for the shape.
 *
 * Two passes over the pairs: one to measure how crowded each drop is, one to
 * move them. The displacement is shared half and half — the drops are all the
 * same size, so there is no mass to weight it by.
 */
function relax(lava: Lava, h: number, step: number): void {
  const { drops } = lava;
  const scale = step * step * 3600;

  for (let i = 0; i < drops.length; i += 1) {
    density[i] = 0;
    nearDensity[i] = 0;
  }

  for (let i = 0; i < drops.length; i += 1) {
    const a = drops[i]!;

    for (let j = i + 1; j < drops.length; j += 1) {
      const b = drops[j]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const apart = Math.hypot(dx, dy);

      if (apart >= h) {
        continue;
      }

      const q = 1 - apart / h;

      density[i] = density[i]! + q * q;
      density[j] = density[j]! + q * q;
      nearDensity[i] = nearDensity[i]! + q * q * q;
      nearDensity[j] = nearDensity[j]! + q * q * q;
    }
  }

  for (let i = 0; i < drops.length; i += 1) {
    const a = drops[i]!;
    const pressure = STIFF * (density[i]! - REST);
    const nearPressure = STIFF_NEAR * nearDensity[i]!;

    for (let j = i + 1; j < drops.length; j += 1) {
      const b = drops[j]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const apart = Math.hypot(dx, dy);

      if (apart >= h || apart === 0) {
        continue;
      }

      const q = 1 - apart / h;
      const pressureB = STIFF * (density[j]! - REST);
      const nearB = STIFF_NEAR * nearDensity[j]!;
      // The paper's displacement, symmetrised: crowding presses (or, below
      // rest, draws), closeness only ever presses.
      const push =
        scale * ((pressure + pressureB) * 0.5 * q + (nearPressure + nearB) * 0.5 * q * q);
      const alongX = (dx / apart) * push * 0.5;
      const alongY = (dy / apart) * push * 0.5;

      a.x -= alongX;
      a.y -= alongY;
      b.x += alongX;
      b.y += alongY;
    }
  }
}

/**
 * Colour — and, if it is ever turned back up, heat — spreading between
 * touching drops.
 *
 * One pass over the pairs for both, because they want the same pairs and the
 * pair loop is the cost. See {@link TINT_SPREAD} and {@link HEAT_SPREAD} for
 * what each is for and why one of them is nought.
 */
function blend(lava: Lava, h: number, step: number): void {
  const { drops } = lava;
  const warmRate = Math.min(0.5, HEAT_SPREAD * step);
  const tintRate = Math.min(0.5, TINT_SPREAD * step);

  if (warmRate <= 0 && tintRate <= 0) {
    return;
  }

  for (let i = 0; i < drops.length; i += 1) {
    warmed[i] = 0;
    reddened[i] = 0;
    greened[i] = 0;
    blued[i] = 0;
  }

  for (let i = 0; i < drops.length; i += 1) {
    const a = drops[i]!;

    for (let j = i + 1; j < drops.length; j += 1) {
      const b = drops[j]!;
      const apart = Math.hypot(b.x - a.x, b.y - a.y);

      if (apart >= h) {
        continue;
      }

      const q = 1 - apart / h;

      if (warmRate > 0) {
        const trade = (b.heat - a.heat) * q * warmRate;

        warmed[i] = warmed[i]! + trade;
        warmed[j] = warmed[j]! - trade;
      }

      const share = q * tintRate;
      const red = (b.red - a.red) * share;
      const green = (b.green - a.green) * share;
      const blue = (b.blue - a.blue) * share;

      reddened[i] = reddened[i]! + red;
      reddened[j] = reddened[j]! - red;
      greened[i] = greened[i]! + green;
      greened[j] = greened[j]! - green;
      blued[i] = blued[i]! + blue;
      blued[j] = blued[j]! - blue;
    }
  }

  const hold = Math.min(0.5, TINT_HOLD * step);

  for (let i = 0; i < drops.length; i += 1) {
    const drop = drops[i]!;

    drop.heat = clamp(drop.heat + warmed[i]!);
    drop.red = drop.red + reddened[i]!;
    drop.green = drop.green + greened[i]!;
    drop.blue = drop.blue + blued[i]!;

    if (hold > 0) {
      const wax = drop.wax;

      drop.red += (wax[0] - drop.red) * hold;
      drop.green += (wax[1] - drop.green) * hold;
      drop.blue += (wax[2] - drop.blue) * hold;
    }
  }
}

/** Keeps a drop inside the wall, and takes the speed that carried it there. */
function confine(drop: Drop, reach: number): void {
  const distance = Math.hypot(drop.x, drop.y);
  const limit = Math.max(0, CHAMBER_RADIUS - reach * 0.6);

  if (distance <= limit || distance === 0) {
    return;
  }

  const outX = drop.x / distance;
  const outY = drop.y / distance;

  drop.x = outX * limit;
  drop.y = outY * limit;
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Paints the lava onto a small canvas, one pixel per grid cell.
 *
 * The fields are summed per cell and the colour with them, so where two
 * colours of wax interleave the drawn colour is the mixture in proportion.
 * Then the wax is *lit*: the summed field is a height, its gradient is a
 * surface normal, and each pixel takes a little diffuse shading and a small
 * specular from a light up and to the left. Flat-filled metaballs read as gel
 * stickers; the same metaballs with a falling-away rim and one bright spot
 * read as bodies of wax with a glass wall in front of them.
 *
 * @returns The canvas, or null where there is no canvas to be had.
 */
export function paintLava(lava: Lava): HTMLCanvasElement | null {
  const surface = lavaSurface();

  if (!surface) {
    return null;
  }

  const { canvas, ctx, image } = surface;
  const pixels = image.data;
  const width = (2 * CHAMBER_RADIUS) / GRID;
  // The drawn field reaches well past the interaction radius — see DRAWN.
  const drawn = lava.reach * DRAWN;
  const span = drawn * drawn;
  // Cleared in full, in one pass each. Clearing only the rows the wax reaches
  // was tried and taken out: two drops with a gap of empty rows between them
  // left that gap uncleared, the shading below still ran over it, and last
  // frame's wax came back as rectangular blocks hanging in the cell. A memset
  // of a megabyte is not what this function costs.
  weight.fill(0);
  tinted.fill(0);
  // Which rows the wax is in, so the shading below skips the empty ones. Only
  // the *loop* is bounded by this; every cell it can read has been cleared.
  let lowest = GRID;
  let highest = -1;

  for (const drop of lava.drops) {
    const { red, green, blue } = drop;
    const from = Math.max(0, Math.floor((drop.x - drawn + CHAMBER_RADIUS) / width));
    const to = Math.min(GRID - 1, Math.ceil((drop.x + drawn + CHAMBER_RADIUS) / width));
    const start = Math.max(0, Math.floor((drop.y - drawn + CHAMBER_RADIUS) / width));
    const end = Math.min(GRID - 1, Math.ceil((drop.y + drawn + CHAMBER_RADIUS) / width));

    if (start < lowest) {
      lowest = start;
    }

    if (end > highest) {
      highest = end;
    }

    for (let j = start; j <= end; j += 1) {
      const y = -CHAMBER_RADIUS + (j + 0.5) * width - drop.y;
      const row = j * GRID;
      // Where this row enters and leaves the drop's own circle. The square its
      // field is bounded by is a quarter larger than the circle inside it, and
      // at this reach that is a quarter of the whole paint spent on cells that
      // are about to be skipped.
      const half = span - y * y;

      if (half <= 0) {
        continue;
      }

      const reach = Math.sqrt(half);
      const left = Math.max(from, Math.ceil((drop.x - reach + CHAMBER_RADIUS) / width - 0.5));
      const right = Math.min(to, Math.floor((drop.x + reach + CHAMBER_RADIUS) / width - 0.5));

      for (let i = left; i <= right; i += 1) {
        const x = -CHAMBER_RADIUS + (i + 0.5) * width - drop.x;
        const away = (x * x + y * y) / span;

        if (away >= 1) {
          continue;
        }

        const much = (1 - away) * (1 - away);
        const k = row + i;
        const at = k * 3;

        weight[k] = weight[k]! + much;
        tinted[at] = tinted[at]! + much * red;
        tinted[at + 1] = tinted[at + 1]! + much * green;
        tinted[at + 2] = tinted[at + 2]! + much * blue;
      }
    }
  }

  // Everything outside that band is empty cell, which is one clear rather than
  // a pass of the shading below.
  pixels.fill(0, 0, Math.max(0, lowest) * GRID * 4);
  pixels.fill(0, (highest + 1) * GRID * 4);

  // The surface: where the sum crosses SURFACE, softened over a little either
  // side so the edge is a liquid's and not a cut-out's.
  const edge = 0.14;
  const low = SURFACE - edge;
  const high = SURFACE + edge;
  // The normal's two samples, in cells across and in cells down — see
  // SLOPE_STEP.
  const near = SLOPE_STEP;
  const rows = SLOPE_STEP * GRID;

  for (let j = Math.max(0, lowest); j <= highest; j += 1) {
    const row = j * GRID;

    for (let i = 0; i < GRID; i += 1) {
      const k = row + i;
      const at = k * 4;
      const much = weight[k]!;

      if (much <= low) {
        pixels[at] = 0;
        pixels[at + 1] = 0;
        pixels[at + 2] = 0;
        pixels[at + 3] = 0;
        continue;
      }

      const tint = k * 3;
      // The average of what is here rather than the sum, or a deep overlap
      // would come out white — and the average is what makes two colours
      // running together mix along the seam between them.
      let red = tinted[tint]! / much;
      let green = tinted[tint + 1]! / much;
      let blue = tinted[tint + 2]! / much;

      // Lit off the field's own slope. The gradient is read from the summed
      // field, which is smooth, so the normal is too. Held in an array of its
      // own rather than interleaved with the colour: the row above and the row
      // below are read for every lit pixel, and a stride of one puts them in
      // cache where a stride of four did not.
      const left = i >= near ? weight[k - near]! : much;
      const right = i < GRID - near ? weight[k + near]! : much;
      const up = j >= near ? weight[k - rows]! : much;
      const down = j < GRID - near ? weight[k + rows]! : much;
      const slopeX = (right - left) * 0.5;
      const slopeY = (down - up) * 0.5;
      // Not Math.hypot: this runs once per lit pixel and the guard against
      // overflow it buys is worth nothing on slopes of a field that peaks in
      // the single digits.
      const length = Math.sqrt(slopeX * slopeX + slopeY * slopeY + 0.81);
      // Light up and to the left, a little towards the eye.
      const facing = (slopeX * 0.42 + slopeY * 0.62 + 0.594) / length;
      const lit = facing > 0 ? facing : 0;
      const diffuse = AMBIENT + THROW * lit;
      // The twenty-fourth power, as five multiplications. `** 24` calls out to
      // a general pow, which for a whole exponent this small is pure overhead.
      const lit2 = lit * lit;
      const lit4 = lit2 * lit2;
      const lit8 = lit4 * lit4;
      const gleam = lit8 * lit8 * lit8 * GLEAM;

      red = red * diffuse + gleam;
      green = green * diffuse + gleam;
      blue = blue * diffuse + gleam;

      pixels[at] = red > 255 ? 255 : red;
      pixels[at + 1] = green > 255 ? 255 : green;
      pixels[at + 2] = blue > 255 ? 255 : blue;
      pixels[at + 3] = much >= high ? 255 : Math.round(smooth((much - low) / (high - low)) * 255);
    }
  }

  ctx.putImageData(image, 0, 0);

  return canvas;
}

/**
 * Where the fields are summed, before any of it is a colour.
 *
 * Summed in floats and not in the picture's own bytes: the whole of the
 * metaball trick is that the fields *add* past the surface — two clumps
 * overlapping reach two and more — and a canvas's bytes stop at one, which
 * would flatten every overlap to the same value and take the pinch with it.
 */
const weight = new Float32Array(GRID * GRID);
const tinted = new Float32Array(GRID * GRID * 3);

/** Smoothstep, for an edge that eases in and out rather than ramping. */
function smooth(at: number): number {
  return at * at * (3 - 2 * at);
}

/** The one surface the lava is drawn on, built once. */
let surface: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; image: ImageData } | null =
  null;
let surfaceTried = false;

function lavaSurface() {
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
