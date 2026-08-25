import { CHAMBER_RADIUS, type Medium } from './chamber';
import { mulberry32, randomBetween } from './random';
import type { Shard } from './scene';

/**
 * The glitter in the chamber.
 *
 * Real glitter is thousands of tiny flat mirrors lying at every angle, and it
 * does not glow — it *flashes*, one flake at a time, as the angle between the
 * eye, the flake and the light passes through alignment. That part was right
 * from the start and is unchanged here: each flake keeps a normal of its own
 * and is lit properly, so tipping the phone sets them off in waves.
 *
 * What was wrong is that the flakes were nowhere. They were a lattice in the
 * source triangle's own frame, worked out per pixel in the shader — so they sat
 * perfectly still while the glass avalanched underneath them and the fluid
 * swept past, which is the tell of an effect laid over a picture rather than
 * something in the cell. Now they are matter, and **a flake goes wherever what
 * surrounds it goes**:
 *
 * - In a dry chamber it is caught on a piece of glass — glitter poured in with
 *   the shards sits among them, it does not hang in the air — so it rides that
 *   piece exactly, tumbling as it tumbles and resting when it rests.
 * - In a liquid one it is loose in the fluid, and it goes where the fluid goes:
 *   held up almost perfectly, because a flake is a few microns of foil and
 *   weighs next to nothing for its area, and swept round by the swirl of the
 *   turning tube long after the glass has given up.
 *
 * Coordinates are in cell units, with the chamber centred on the origin —
 * the same frame the glass is in.
 */
export interface Flake {
  /** Where it is, in cell units. */
  x: number;
  y: number;
  /** How fast it is travelling. Only a loose flake in a fluid has any. */
  vx: number;
  vy: number;
  /** Which piece of glass carries it in a dry cell. */
  host: number;
  /** Where on that piece it is caught, in the piece's frame, as a fraction. */
  onX: number;
  onY: number;
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
 * How many flakes a chamber is made with.
 *
 * The Glitter slider spends this rather than scaling one fixed field: more
 * glitter is more flakes, so at a fifth of the way up only a fifth of them are
 * simulated or drawn and the rest cost nothing at all.
 */
export const MAX_FLAKES = 700;

/**
 * How big a flake is, in cell units. Small: a speck, not a sequin.
 *
 * A tenth of a normal piece of glass at most, which is about what craft glitter
 * is against the gems in a real cell. Bigger was tried to make them easier to
 * see and reads as confetti stuck to the picture; what makes them read is being
 * solid rather than being large — see {@link BODY}.
 */
const FLAKE_SMALLEST = 0.006;
const FLAKE_LARGEST = 0.013;

/**
 * How much of the fluid's push a flake takes per second.
 *
 * Far higher than the glass gets, and that is the physics rather than a taste:
 * drag goes with how much surface is pushing through the liquid and weight with
 * how much there is of the thing, so a flake — which is almost all surface —
 * is dragged along almost perfectly. It rides the fluid rather than swimming
 * through it.
 */
const FLAKE_GRIP = 9;

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
 * Builds a chamber's worth of glitter, deterministically.
 *
 * @param hosts How many pieces of glass there are to be caught on.
 */
export function createGlitter(seed: number, hosts: number): Flake[] {
  const rng = mulberry32(seed);
  const flakes: Flake[] = [];

  for (let i = 0; i < MAX_FLAKES; i += 1) {
    // Scattered over the disc by area rather than by radius, so the middle
    // does not come out crowded — the same way the glass is placed.
    const angle = rng() * Math.PI * 2;
    const distance = Math.sqrt(rng()) * CHAMBER_RADIUS;

    flakes.push({
      x: Math.cos(angle) * distance,
      y: Math.sin(angle) * distance,
      vx: 0,
      vy: 0,
      host: hosts > 0 ? Math.min(hosts - 1, Math.floor(rng() * hosts)) : 0,
      // Anywhere on the piece it is caught on, and a little beyond its edge:
      // glitter settles in the gaps between shards as much as on top of them.
      onX: randomBetween(rng, -1.1, 1.1),
      onY: randomBetween(rng, -1.1, 1.1),
      // Squared, so most lie nearly face up and only a few stand well over,
      // which is what settles how many are alight at once. Spread evenly over
      // a wide cone instead, and with a specular this sharp essentially none
      // of them ever line up and the whole thing is invisible.
      lean: rng() * rng() * 1.1,
      turn: rng() * Math.PI * 2,
      size: randomBetween(rng, FLAKE_SMALLEST, FLAKE_LARGEST),
      tint: Math.min(TINTS.length - 1, Math.floor(rng() * TINTS.length)),
    });
  }

  return flakes;
}

export interface GlitterUpdate {
  /** Seconds to advance. */
  dt: number;
  /** What the cell is filled with. */
  medium: Medium;
  /** How fast the fluid is turning within the cell, radians per second. */
  swirl: number;
  /** Which way is down in the cell's own frame, radians. */
  angle: number;
  /** How many flakes are live, from the Glitter setting. */
  live: number;
}

/**
 * Advances the glitter in place.
 *
 * Only the live prefix is touched — see {@link MAX_FLAKES} — so a chamber with
 * the slider low pays for the flakes it shows and no others.
 */
export function updateGlitter(
  flakes: Flake[],
  shards: readonly Shard[],
  { dt, medium, swirl, angle, live }: GlitterUpdate,
): void {
  const count = Math.min(flakes.length, Math.max(0, Math.floor(live)));

  if (count === 0) {
    return;
  }

  // A dry cell: every flake rides the piece it is caught on, exactly. Nothing
  // is integrated, so a settled pile's glitter is as still as the pile — which
  // is right, and is what a lattice could never be, because the lattice was
  // also still while the pile avalanched.
  if (medium.stir <= 0) {
    if (shards.length === 0) {
      return;
    }

    for (let i = 0; i < count; i += 1) {
      const flake = flakes[i]!;
      const host = shards[flake.host % shards.length]!;
      const cos = Math.cos(host.rotation);
      const sin = Math.sin(host.rotation);
      const alongX = flake.onX * host.radius;
      const alongY = flake.onY * host.radius;

      flake.x = host.x + alongX * cos - alongY * sin;
      flake.y = host.y + alongX * sin + alongY * cos;
    }

    return;
  }

  if (dt <= 0) {
    return;
  }

  // A liquid cell: loose in the fluid, and almost perfectly carried by it.
  const grip = Math.min(1, FLAKE_GRIP * dt);
  const sinkX = Math.sin(angle) * GRAVITY * FLAKE_SINK * (1 - medium.density) * dt;
  const sinkY = Math.cos(angle) * GRAVITY * FLAKE_SINK * (1 - medium.density) * dt;

  for (let i = 0; i < count; i += 1) {
    const flake = flakes[i]!;
    // The fluid turns as one body, so its speed here is the swirl about the
    // middle — the same field the glass is dragged against.
    const flowX = -swirl * flake.y;
    const flowY = swirl * flake.x;

    flake.vx += (flowX - flake.vx) * grip + sinkX;
    flake.vy += (flowY - flake.vy) * grip + sinkY;
    flake.x += flake.vx * dt;
    flake.y += flake.vy * dt;

    const distance = Math.hypot(flake.x, flake.y);

    // The wall. A flake has no size worth speaking of, so it simply stops at
    // it rather than being pushed out of it, and loses whatever speed was
    // carrying it through.
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
  /** How many flakes are live, from the Glitter setting. */
  live: number;
  /** The foil the flakes are cut from. See {@link createFlakeSprites}. */
  sprites: FlakeSprites;
}

/**
 * What glitter is cut from.
 *
 * Foil, and foil has a colour even in shadow: silver, gold, and the pink that
 * craft glitter is full of. It matters because a flake is not only a flash —
 * see {@link BODY}.
 */
const TINTS = ['rgb(232,238,246)', 'rgb(246,222,170)', 'rgb(246,206,222)'];

/**
 * How solid a flake is when nothing is lighting it.
 *
 * A flake is an object and not a highlight, so it is drawn twice: once as
 * itself, which covers what is behind it, and again as the flash when it lines
 * up with the light. Drawing only the flash was tried first and is the trap the
 * whole effect falls into — **light added to a white ground is still white**,
 * and the chamber's ground is white, so half the cell's flakes were perfectly
 * invisible and the ones over the glass only tinged it. Which is also true of
 * the real thing: a mirror cannot be brighter than a lit white page. What it
 * can do is *sit on* it, which is this.
 */
const BODY = 0.62;

/** How much more solid it looks once it is catching the light. */
const BODY_LIT = 0.38;

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

/** Below this a flake would not be seen, so it is not drawn. */
const TOO_DIM = 0.02;

/** Paints the live glitter, additively, over whatever is already there. */
export function drawGlitter(
  ctx: CanvasRenderingContext2D,
  flakes: readonly Flake[],
  { scale, rotation, pan, light, live, sprites }: DrawGlitterOptions,
): void {
  const count = Math.min(flakes.length, Math.max(0, Math.floor(live)));
  const flash = sprites.flash();

  if (count === 0 || scale <= 0 || !flash) {
    return;
  }

  const length = Math.hypot(light.x, light.y, light.z + 1);

  if (length === 0) {
    return;
  }

  // The eye is straight ahead, so what a flake is measured against is the light
  // tipped halfway towards it.
  const midX = light.x / length;
  const midY = light.y / length;
  const midZ = (light.z + 1) / length;

  for (let i = 0; i < count; i += 1) {
    const flake = flakes[i]!;
    const sine = Math.sin(flake.lean);
    const aligned =
      sine * Math.cos(flake.turn) * midX +
      sine * Math.sin(flake.turn) * midY +
      Math.cos(flake.lean) * midZ;

    alight[i] = aligned > 0 ? Math.pow(aligned, SPECULAR) : 0;
  }

  ctx.save();
  ctx.translate(pan.x * scale, pan.y * scale);
  ctx.rotate(rotation);

  // The flakes themselves, which cover what is behind them.
  for (let i = 0; i < count; i += 1) {
    const flake = flakes[i]!;
    const foil = sprites.body(flake.tint);

    if (!foil) {
      continue;
    }

    const reach = flake.size * scale;

    ctx.globalAlpha = Math.min(1, BODY + BODY_LIT * alight[i]!);
    ctx.drawImage(foil, flake.x * scale - reach, flake.y * scale - reach, reach * 2, reach * 2);
  }

  // And the flash, over the top and added rather than laid on: two flakes on
  // one speck are brighter than one, and a lit flake spills a little light onto
  // whatever it is lying on, which is why it is drawn wider than the flake is.
  ctx.globalCompositeOperation = 'lighter';

  for (let i = 0; i < count; i += 1) {
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

/** How brightly each flake is lit this frame, worked out once and drawn twice. */
const alight = new Float32Array(MAX_FLAKES);

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
