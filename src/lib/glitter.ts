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
  /**
   * How fast it rocks over on its own, in radians a second.
   *
   * A flake of foil in a liquid is never quite still: it is a few microns
   * thick, it is not neutrally buoyant, and it drifts and rocks for as long as
   * it is in there. Without this the only thing that moves a flake through
   * alignment is the fluid turning or the phone tilting — so on a cell left
   * alone, with no gravity reading to sweep the light across, the flashes were
   * *frozen*: the same few hundred specks alight in the same places for as
   * long as anybody looked, which read as a photograph of glitter rather than
   * as glitter. Given its own slow rock, each flake comes through alignment on
   * its own schedule and the cell twinkles all the time, without anything
   * having to be done to it.
   */
  rock: number;
  /** How big it is drawn, in cell units. */
  size: number;
  /** Which of the {@link TINTS} it is cut from. */
  tint: number;
}

/**
 * How many flakes a cell holds at the two ends of the Amount slider.
 *
 * Far fewer than the eighteen hundred this once held, and the count is half of
 * why that cell read as a night sky rather than as glitter. Eighteen hundred
 * specks in a cell an inch across is not a suspension of flakes, it is a
 * *texture* — and a texture folded six times by the mirrors is static, because
 * the figure a kaleidoscope makes is only legible when the eye can pick out
 * the thing being repeated. Four hundred flakes, each of them large enough to
 * be an object, repeat into a figure. They are cheap either way: a flake is
 * four numbers to advance and a sprite to stamp.
 */
const FEWEST = 110;
export const MOST_FLAKES = 700;

/**
 * How big a flake is, in cell units. A speck, not a sequin — but a speck you
 * can see.
 *
 * Bigger still was tried once and reads as confetti stuck to the picture, and
 * the note that came out of it — that what makes a flake read is being solid
 * rather than being large — is right and was taken too far. At the sizes it
 * left, a flake was between three and seven device pixels across on a phone,
 * which is a *speckle* and not an object: the cell came out looking like a
 * photograph of a night sky, and no amount of flashing rescues something the
 * eye reads as noise. Half again as large, and with the range opened up so the
 * cell holds obvious flakes as well as fine ones, they read as cut foil.
 */
const FLAKE_SMALLEST = 0.014;
const FLAKE_LARGEST = 0.042;

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
 * Foil, and foil has a colour even in shadow, which matters because a flake is
 * not only a flash — see {@link BODY}. A jar of craft glitter is not one
 * colour and it is not three: it is silver and gold and rose and a green and a
 * blue, and the mixture is most of why a jar of it is worth looking at. The
 * tints are held bright, because foil is a mirror and a mirror in a lit cell
 * is pale whatever it is made of; the colour is a lean and not a paint.
 */
const TINTS = [
  'rgb(236,242,250)',
  'rgb(250,226,168)',
  'rgb(250,206,220)',
  'rgb(186,238,226)',
  'rgb(198,214,250)',
  'rgb(238,206,250)',
];

/** How solid a flake is when nothing is lighting it. */
const BODY = 0.72;

/** How much more solid it looks once it is catching the light. */
const BODY_LIT = 0.28;

/**
 * The fastest a flake rocks over on its own, in radians a second.
 *
 * Slow enough that a flake is plainly a flake drifting rather than a light
 * being switched on and off, and fast enough that the cell is never the same
 * twice: at this rate a flake passes through alignment every few seconds, so
 * at any moment a different handful of the cell's several hundred is alight.
 */
const ROCK = 0.55;

/**
 * The breeze the flakes' own fluid is given.
 *
 * Every other substance in the cell pushes on the fluid it hangs in — the dye
 * and the oil are heavier than what carries them, the wax is driven by its own
 * heat — and a cell of glitter is the one that pushes on nothing at all: foil
 * is carried and does not carry. So left alone its fluid comes to rest, and a
 * cell at rest is a cell where the flakes hang exactly where they are for as
 * long as anyone looks. A slow wandering draught, weak enough that nothing in
 * the cell appears to be blown about, is what keeps the flakes drifting
 * through each other and the flashes travelling. See `breatheFlow` in
 * `lib/flow.ts` for what it is.
 */
export const GLITTER_BREEZE = { strength: 0.28, grain: 2.2, tempo: 0.16 } as const;

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
      // Its own slow rock, either way, and a wide spread of rates: all of them
      // at one rate is a cell that flashes in time with itself. See Flake.rock.
      rock: randomBetween(rng, -1, 1) * ROCK,
      // Cut in a range rather than evenly: a jar of glitter is mostly fine
      // stuff with a few large flakes through it, and the large ones are what
      // the eye finds first.
      size:
        randomBetween(rng, FLAKE_SMALLEST, FLAKE_LARGEST) *
        (rng() < 0.12 ? 1.5 : 1) *
        Math.max(0.2, scale),
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

    // And its own rocking, which is what keeps a cell nobody is touching
    // twinkling. See Flake.rock.
    flake.lean += flake.rock * step;

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
    // Foreshortened: a flake leaning over shows its edge, and the thinning is
    // what lets the eye see it turning. Turned as well as thinned, because a
    // cut flake has corners and a field of them all squared to the screen
    // reads as a printed texture — which is what a sprite stamped without a
    // rotation is.
    const across = reach * (0.22 + 0.78 * Math.abs(Math.cos(flake.lean)));

    ctx.globalAlpha = Math.min(1, BODY + BODY_LIT * alight[i]!);
    ctx.save();
    ctx.translate(flake.x * scale, flake.y * scale);
    ctx.rotate(flake.turn);
    ctx.drawImage(foil, -across, -reach, across * 2, reach * 2);
    ctx.restore();
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

  /**
   * One flake of foil: a cut hexagon, edge to edge, with a sheen across it.
   *
   * It was a soft round dot, and a soft round dot is *dust*. Craft glitter is
   * die-cut — hexagons, squares, stars — and the corner is the whole of what
   * says so: a field of round specks reads as grain in a photograph however
   * bright it is made, and the same field with corners on it reads as cut
   * foil. The sheen across the face is what a bent flake does with the light
   * it is not flashing back, and it is what keeps a flake from being a flat
   * sticker in the frames where it is not alight.
   */
  const speck = (colour: string): HTMLCanvasElement | null => {
    const canvas = create();
    canvas.width = size;
    canvas.height = size;

    const ctx = canvas.getContext('2d');

    if (!ctx) {
      return null;
    }

    const middle = size / 2;
    // A whisker inside the sprite, so the cut edge has a pixel to be
    // antialiased into rather than being clipped by the sprite's own square.
    const reach = middle * 0.94;
    const body = colour.replace('rgb(', 'rgba(').replace(')', ',');
    const sheen = ctx.createLinearGradient(0, 0, size, size);

    sheen.addColorStop(0, `${body}1)`);
    sheen.addColorStop(0.45, `${body}0.86)`);
    sheen.addColorStop(1, `${body}0.62)`);
    ctx.fillStyle = sheen;
    ctx.beginPath();

    for (let corner = 0; corner < 6; corner += 1) {
      const at = (corner / 6) * Math.PI * 2 + Math.PI / 6;
      const x = middle + Math.cos(at) * reach;
      const y = middle + Math.sin(at) * reach;

      if (corner === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }

    ctx.closePath();
    ctx.fill();

    return canvas;
  };

  /**
   * The flash: a bright core with four rays off it.
   *
   * A round glow is a *bulb*, and a bulb is what a lit flake looked like — a
   * soft dot brightening and dimming, which is the one shape that says
   * "sparkle" to nobody. What the eye reads as a glint is the star, and the
   * star is not in the world: it is what a lens or an eyelash does to a small
   * bright thing, which is exactly the case a lit flake is. So the flash has
   * rays, and they are what turns a lit speck into a sparkle.
   */
  const star = (): HTMLCanvasElement | null => {
    const canvas = create();
    canvas.width = size;
    canvas.height = size;

    const ctx = canvas.getContext('2d');

    if (!ctx) {
      return null;
    }

    const middle = size / 2;
    const glow = ctx.createRadialGradient(middle, middle, 0, middle, middle, middle);

    glow.addColorStop(0, 'rgba(255,255,255,1)');
    glow.addColorStop(0.18, 'rgba(255,255,255,0.62)');
    glow.addColorStop(0.55, 'rgba(255,255,255,0.1)');
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, size, size);

    // Four rays, each a soft bar fading out from the middle. Drawn as a
    // gradient along the bar so the ray has no end to it, and added rather
    // than laid on, since this whole sprite is light.
    ctx.globalCompositeOperation = 'lighter';

    for (const across of [true, false]) {
      const ray = across
        ? ctx.createLinearGradient(0, 0, size, 0)
        : ctx.createLinearGradient(0, 0, 0, size);

      ray.addColorStop(0, 'rgba(255,255,255,0)');
      ray.addColorStop(0.5, 'rgba(255,255,255,0.85)');
      ray.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = ray;

      const thin = Math.max(1, size * 0.07);

      if (across) {
        ctx.fillRect(0, middle - thin / 2, size, thin);
      } else {
        ctx.fillRect(middle - thin / 2, 0, thin, size);
      }
    }

    return canvas;
  };

  const cached = (key: number, make: () => HTMLCanvasElement | null) => {
    const found = cache.get(key);

    if (found !== undefined) {
      return found;
    }

    const made = make();
    cache.set(key, made);

    return made;
  };

  return {
    body: (tint) => cached(cut(tint), () => speck(TINTS[cut(tint)]!)),
    flash: () => cached(TINTS.length, star),
  };
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}
