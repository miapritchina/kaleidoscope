import { CHAMBER_RADIUS } from './chamber';
import { curlAt, velocityAt, type Flow } from './flow';
import { mulberry32, randomBetween } from './random';

/**
 * A cell of glitter.
 *
 * The whole content, not a sprinkle over something else: what is in the chamber
 * is thousands of flakes of foil hanging in clear fluid, and the mirrors repeat
 * those. One of the three things this instrument's object cell can hold instead
 * of loose pieces — see `lib/lava.ts` and `lib/smoke.ts` for the others.
 *
 * Real glitter is tiny flat mirrors lying at every angle, and it does not glow
 * — it *flashes*, one flake at a time, as the angle between the eye, the flake
 * and the light passes through alignment. So each flake keeps a normal of its
 * own and is lit properly: tip the phone and they go off in waves across the
 * cell.
 *
 * A flake is drawn twice, and the second time is the part that is easy to leave
 * out. Light added to a lit ground is still that ground, so a flake that only
 * flashed is invisible over anything pale — which is true of the real thing as
 * well, since a mirror cannot be brighter than a lit white page. What it can do
 * is *sit on* it. The flake is drawn as itself first, covering what is behind
 * it, and the flash goes over the top.
 *
 * A flake is a few microns of foil and weighs next to nothing for its area, so
 * the fluid carries it almost perfectly: it rides the swirl of a turning tube
 * rather than swimming through it, and sags only slowly when nothing is moving.
 *
 * Coordinates are in cell units, with the chamber centred on the origin.
 */
export interface Flake {
  /** Where it is, in cell units. */
  x: number;
  y: number;
  /** How fast it is travelling, in cell units per second. */
  vx: number;
  vy: number;
  /** How far the flake leans away from face-up. */
  lean: number;
  /** Which way it faces. */
  turn: number;
  /** How big it is drawn, in cell units. */
  size: number;
  /** Which of the {@link TINTS} it is cut from. */
  tint: number;
}

/**
 * How many flakes a cell holds at the two ends of the Amount slider.
 *
 * A cell of glitter and nothing else wants a great many more than a sprinkle
 * over glass did, and they are cheap: a flake is four numbers to advance and a
 * sprite to stamp.
 */
const FEWEST = 300;
export const MOST_FLAKES = 1800;

/**
 * How big a flake is, in cell units. Small: a speck, not a sequin.
 *
 * Bigger was tried, to make them easier to see, and reads as confetti stuck to
 * the picture. What makes them read is being solid rather than being large —
 * see {@link BODY}.
 */
const FLAKE_SMALLEST = 0.007;
const FLAKE_LARGEST = 0.016;

/**
 * How much of the fluid's push a flake takes per second, in a thin fluid.
 *
 * High, and that is the physics rather than a taste: drag goes with how much
 * surface is pushing through the liquid and weight with how much there is of
 * the thing, so a flake — almost all surface — is dragged along almost
 * perfectly.
 */
const FLAKE_GRIP = 9;

/** How much more of everything the far end of the Thickness slider is. */
const THICKEST = 3;

/**
 * How much of its own weight a flake still feels in the fluid.
 *
 * Not none: a slow sag is what keeps a swirl from reading as a rigid turntable,
 * because the flakes cross the streamlines as they go round.
 */
const FLAKE_SINK = 0.12;

/** Downward acceleration, matched to the chamber's own. */
const GRAVITY = 6;

/**
 * What glitter is cut from.
 *
 * Foil, and foil has a colour even in shadow: silver, gold, and the pink that
 * craft glitter is full of. It matters because a flake is not only a flash —
 * see {@link BODY}.
 */
const TINTS = ['rgb(232,238,246)', 'rgb(246,222,170)', 'rgb(246,206,222)'];

/** How solid a flake is when nothing is lighting it. */
const BODY = 0.62;

/** How much more solid it looks once it is catching the light. */
const BODY_LIT = 0.38;

/** Builds a cell of glitter, deterministically. */
export function createGlitter(seed: number, amount: number, scale = 1): Flake[] {
  const rng = mulberry32(seed);
  const count = Math.round(FEWEST + (MOST_FLAKES - FEWEST) * clamp(amount));
  const flakes: Flake[] = [];

  for (let i = 0; i < count; i += 1) {
    // Scattered over the disc by area rather than by radius, so the middle does
    // not come out crowded.
    const angle = rng() * Math.PI * 2;
    const distance = Math.sqrt(rng()) * CHAMBER_RADIUS;

    flakes.push({
      x: Math.cos(angle) * distance,
      y: Math.sin(angle) * distance,
      vx: 0,
      vy: 0,
      // Squared, so most lie nearly face up and only a few stand well over,
      // which is what settles how many are alight at once. Spread evenly over
      // a wide cone instead, and with a specular this sharp essentially none of
      // them ever line up and the whole thing is invisible.
      lean: rng() * rng() * 1.1,
      turn: rng() * Math.PI * 2,
      size: randomBetween(rng, FLAKE_SMALLEST, FLAKE_LARGEST) * Math.max(0.2, scale),
      tint: Math.min(TINTS.length - 1, Math.floor(rng() * TINTS.length)),
    });
  }

  return flakes;
}

export interface GlitterUpdate {
  /** Seconds to advance. */
  dt: number;
  /** How thick the fluid is, 0 thin to 1 gel. */
  thickness: number;
  /** How fast the fluid is turning within the cell, radians per second. */
  swirl: number;
  /** Which way is down in the cell's own frame, radians. */
  angle: number;
  /**
   * The body of fluid the flakes hang in, already advanced this frame.
   *
   * With it, a flake rides the fluid's own eddies — folding into sheets when
   * the cell is swirled or stirred — and tumbles at the rate the fluid is
   * turning where it hangs, which is what sends waves of flashes through the
   * cell from the motion itself rather than only from the light moving.
   * Without it the fluid is taken to turn as one rigid body, which is what
   * this substance did before there was a fluid to hand it.
   */
  fluid?: Flow;
}

/**
 * How fast a flake takes up the turning of the fluid around it.
 *
 * A platelet in a rotating patch of fluid is carried round with it — the
 * rigorous version is Jeffery (1922), where the orbit rate is set by the
 * local velocity gradient — so the facing turns at the local curl, and the
 * lean is worked over at a fraction of it: the same shear that spins a flake
 * about the eye's axis also rocks it over, and it is the rocking that drives
 * a flake through alignment and makes the flash travel with the flow.
 */
const TUMBLE = 0.5;

/** How much of the tumbling goes into the lean. */
const TUMBLE_LEAN = 0.35;

/** Advances the glitter in place. */
export function updateGlitter(
  flakes: Flake[],
  { dt, thickness, swirl, angle, fluid }: GlitterUpdate,
): void {
  if (dt <= 0 || flakes.length === 0) {
    return;
  }

  const step = Math.min(dt, 1 / 20);
  const thick = 1 + THICKEST * clamp(thickness);
  const grip = Math.min(1, FLAKE_GRIP * thick * step);
  // A thicker fluid holds a flake up as well as holding it back.
  const sink = (GRAVITY * FLAKE_SINK * step) / thick;
  const sinkX = Math.sin(angle) * sink;
  const sinkY = Math.cos(angle) * sink;

  for (const flake of flakes) {
    // The fluid's velocity where the flake hangs: the real field's, eddies
    // and all, or a rigid turn of the whole body where there is no field.
    if (fluid) {
      velocityAt(fluid, flake.x, flake.y, carried);

      // The rate the fluid turns at here is the rate the flake tumbles at.
      const turning = curlAt(fluid, flake.x, flake.y) * TUMBLE * step;

      flake.turn += turning;
      flake.lean += turning * TUMBLE_LEAN;
    } else {
      carried.x = -swirl * flake.y;
      carried.y = swirl * flake.x;
      flake.turn += swirl * step;
    }

    const flowX = carried.x;
    const flowY = carried.y;

    flake.vx += (flowX - flake.vx) * grip + sinkX;
    flake.vy += (flowY - flake.vy) * grip + sinkY;
    flake.x += flake.vx * step;
    flake.y += flake.vy * step;

    const distance = Math.hypot(flake.x, flake.y);

    // The wall. A flake has no size worth speaking of, so it simply stops at it
    // rather than being pushed out of it, and loses whatever speed was carrying
    // it through.
    if (distance > CHAMBER_RADIUS && distance > 0) {
      const back = CHAMBER_RADIUS / distance;

      flake.x *= back;
      flake.y *= back;

      const outward = (flake.vx * flake.x + flake.vy * flake.y) / (CHAMBER_RADIUS * CHAMBER_RADIUS);

      flake.vx -= outward * flake.x;
      flake.vy -= outward * flake.y;
    }
  }
}

export interface DrawGlitterOptions {
  /** Cell units to device pixels. */
  scale: number;
  /** Rotation of the chamber about its own centre, in radians. */
  rotation: number;
  /** Offset of the chamber from the apex, in cell units. */
  pan: { x: number; y: number };
  /**
   * Where the room's light is coming from, in the screen's own axes.
   *
   * The eye is straight ahead, so what a flake is measured against is this
   * tipped halfway towards it. Tilting the instrument moves the light rather
   * than the flakes, which is why they fire in waves as the phone moves and sit
   * still when it does not.
   */
  light: { x: number; y: number; z: number };
  /** The foil the flakes are cut from. See {@link createFlakeSprites}. */
  sprites: FlakeSprites;
}

/**
 * How sharply a flake has to be lined up before it lights.
 *
 * High, because a flake is a mirror and not a matte speck: dark until it is
 * nearly right, then very bright. This number and the lean in
 * {@link createGlitter} are one decision — together they set what share of the
 * flakes are alight at any moment, and a few percent is what reads as glitter
 * rather than as frost.
 */
const SPECULAR = 90;

/** Below this a flake's flash would not be seen, so it is not drawn. */
const TOO_DIM = 0.02;

/** How brightly each flake is lit this frame, worked out once and drawn twice. */
let alight = new Float32Array(MOST_FLAKES);

/** Scratch for the fluid's velocity, so the update allocates nothing. */
const carried = { x: 0, y: 0 };

/** Paints the glitter: every flake as itself, and the lit ones again as light. */
export function drawGlitter(
  ctx: CanvasRenderingContext2D,
  flakes: readonly Flake[],
  { scale, rotation, pan, light, sprites }: DrawGlitterOptions,
): void {
  const flash = sprites.flash();

  if (flakes.length === 0 || scale <= 0 || !flash) {
    return;
  }

  const length = Math.hypot(light.x, light.y, light.z + 1);

  if (length === 0) {
    return;
  }

  if (alight.length < flakes.length) {
    alight = new Float32Array(flakes.length);
  }

  // The eye is straight ahead, so what a flake is measured against is the light
  // tipped halfway towards it.
  const midX = light.x / length;
  const midY = light.y / length;
  const midZ = (light.z + 1) / length;

  for (let i = 0; i < flakes.length; i += 1) {
    const flake = flakes[i]!;
    const sine = Math.sin(flake.lean);
    const aligned =
      sine * Math.cos(flake.turn) * midX +
      sine * Math.sin(flake.turn) * midY +
      Math.cos(flake.lean) * midZ;

    // Both faces: foil is a mirror on either side, so a flake tumbled past
    // edge-on flashes again on the way over rather than going dark for half
    // of every tumble.
    alight[i] = Math.pow(Math.abs(aligned), SPECULAR);
  }

  ctx.save();
  ctx.translate(pan.x * scale, pan.y * scale);
  ctx.rotate(rotation);

  // The flakes themselves, which cover what is behind them.
  for (let i = 0; i < flakes.length; i += 1) {
    const flake = flakes[i]!;
    const foil = sprites.body(flake.tint);

    if (!foil) {
      continue;
    }

    const reach = flake.size * scale;
    // Foreshortened: a flake leaning over shows its edge, and at these sizes
    // the thinning is what lets the eye see it turning. The axis is not
    // drawn — a speck this small has no legible axis — only the width.
    const across = reach * (0.35 + 0.65 * Math.abs(Math.cos(flake.lean)));

    ctx.globalAlpha = Math.min(1, BODY + BODY_LIT * alight[i]!);
    ctx.drawImage(foil, flake.x * scale - across, flake.y * scale - reach, across * 2, reach * 2);
  }

  // And the flash, over the top and added rather than laid on: two flakes on
  // one speck are brighter than one, and a lit flake spills a little light onto
  // whatever it is lying on, which is why it is drawn wider than the flake is.
  ctx.globalCompositeOperation = 'lighter';

  for (let i = 0; i < flakes.length; i += 1) {
    const lit = alight[i]!;

    if (lit < TOO_DIM) {
      continue;
    }

    const flake = flakes[i]!;
    const reach = flake.size * scale * 3;

    ctx.globalAlpha = Math.min(1, lit);
    ctx.drawImage(flash, flake.x * scale - reach, flake.y * scale - reach, reach * 2, reach * 2);
  }

  ctx.restore();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

/** The foil the flakes are cut from, and the flash they make when lit. */
export interface FlakeSprites {
  /** One tint's worth of foil, or null where there is no canvas to be had. */
  body: (tint: number) => CanvasImageSource | null;
  /** The white flash, which is the same speck with the colour taken out. */
  flash: () => CanvasImageSource | null;
}

export interface FlakeSpriteOptions {
  /** Side of each sprite in pixels. */
  size?: number;
  createCanvas?: () => HTMLCanvasElement;
}

/**
 * Builds the specks the flakes are drawn with, once each.
 *
 * Round and soft at the edge, so a flake reads as a speck of foil rather than
 * as a drawn disc — at the size these are on screen an antialiased circle is
 * all edge, and the edge is the part that would look like a sticker.
 */
export function createFlakeSprites(options: FlakeSpriteOptions = {}): FlakeSprites {
  const size = Math.max(8, options.size ?? 32);
  const create = options.createCanvas ?? (() => document.createElement('canvas'));
  const cache = new Map<number, HTMLCanvasElement | null>();

  const cut = (tint: number) => ((Math.round(tint) % TINTS.length) + TINTS.length) % TINTS.length;

  const speck = (colour: string): HTMLCanvasElement | null => {
    const canvas = create();
    canvas.width = size;
    canvas.height = size;

    const ctx = canvas.getContext('2d');

    if (!ctx) {
      return null;
    }

    const middle = size / 2;
    const glow = ctx.createRadialGradient(middle, middle, 0, middle, middle, middle);
    const body = colour.replace('rgb(', 'rgba(').replace(')', ',');

    glow.addColorStop(0, `${body}1)`);
    glow.addColorStop(0.5, `${body}0.92)`);
    glow.addColorStop(1, `${body}0)`);
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, size, size);

    return canvas;
  };

  const cached = (key: number, colour: string) => {
    const found = cache.get(key);

    if (found !== undefined) {
      return found;
    }

    const made = speck(colour);
    cache.set(key, made);

    return made;
  };

  return {
    body: (tint) => cached(cut(tint), TINTS[cut(tint)]!),
    flash: () => cached(TINTS.length, 'rgb(255,255,255)'),
  };
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}
