import {
  advanceFlow,
  AIR,
  CHAMBER_RADIUS,
  REFERENCE_PIECE,
  settleChamber,
  updateChamber,
  type Medium,
} from './chamber';
import { CHIP_VARIANTS, tracePolygon, type ChipSprites } from './chips';
import { createGlitter, updateGlitter, type Flake } from './glitter';
import { createLava, updateLava, type Lava } from './lava';
import { hashSeed, mulberry32, randomBetween, randomInt, randomItem } from './random';
import { ROUND, shapeOf, type Shape } from './shape';
import { measureSource, type SkinCut, type SkinPatches } from './skin';
import type { SubstanceId } from './settings';
import { createSmoke, updateSmoke, type Smoke } from './smoke';
import { chamberOverride } from './solver';

/**
 * The object chamber of the kaleidoscope: the loose glass that the mirrors
 * repeat. Coordinates are in cell units, centred on the chamber.
 */

export const SHARD_KINDS = ['triangle', 'shard', 'bead', 'sliver'] as const;

export type ShardKind = (typeof SHARD_KINDS)[number];

export interface Shard {
  kind: ShardKind;
  /** Which cut of that shape, so a chamber is not full of identical glass. */
  variant: number;
  /** Position in the chamber, in cell units from its centre. */
  x: number;
  y: number;
  /** Velocity in cell units per second. */
  vx: number;
  vy: number;
  /** Radius in cell units: the circle the piece is cut to fit. */
  radius: number;
  /**
   * What the chamber collides on: a chain of circles laid along the piece.
   *
   * The drawn shape is the polygon traced out of the picture; this is what a
   * solver of circles can make of it. See `lib/shape.ts`. Shared between every
   * piece cut from the same object, and never mutated.
   */
  shape: Shape;
  rotation: number;
  /** Angular velocity in radians per second. */
  spin: number;
  /**
   * Where on a photograph this piece is cut from, each axis in `[0, 1]`.
   *
   * Fixed per piece rather than derived from where it currently lies, so a
   * piece keeps its own patch of the picture as it tumbles instead of the
   * image swimming about underneath the chamber.
   */
  skin: { x: number; y: number };
}

export interface Scene {
  readonly seed: string;
  readonly shards: Shard[];
  /**
   * The piece-size multiplier this glass was cut at.
   *
   * The glass is only recut once a pinch has come to rest — rebuilding and
   * resettling the pile is too much work to do per pointer move — but the hand
   * still has to see something growing under it. The renderer divides the live
   * setting by this to know how far the drawn glass is running ahead of the
   * cut, and magnifies the sprites by the difference until the recut lands.
   */
  readonly chipScale: number;
  /** Accumulated pan of the cell, in cells. */
  pan: { x: number; y: number };
  /**
   * Angle the object cell has been turned to, in radians.
   *
   * Plenty of real kaleidoscopes turn the cell and not the barrel: the mirrors
   * are fixed in the tube and the chamber of glass rotates against them on its
   * own bearing. That is this, and it is why the figure's framework holds still
   * on screen while what is inside it moves.
   */
  cell: number;
  /**
   * Angle of the contents inside the tube, in radians.
   *
   * The chips are loose, so they lag the cell and then settle. That lag is the
   * relative angle between this and {@link Scene.cell}, and it is what makes the
   * figure evolve rather than only revolve.
   */
  contents: number;
  /**
   * Where the viewer has dragged the source to, each axis in `[-1, 1]`.
   *
   * A position rather than a velocity: the source follows the pointer and stays
   * where it is let go, which is what dragging something means. A photo's
   * travel reaches the wedge's own span plus whatever hangs outside it, so its
   * edges may be dragged into view but some of it always remains.
   */
  drag: { x: number; y: number };
  /**
   * How far the instrument is tilted, in radians.
   *
   * Gravity's direction on screen, and nothing else — the figure does not turn
   * with it. Kept so the debug overlay has something to point at.
   */
  tilt: number;
  /**
   * How fast the fluid in the cell is turning, in radians per second.
   *
   * The world's frame, not the cell's. Nought for a dry cell, where there is
   * nothing to turn; in a liquid one it chases the tube's own rate and lags
   * behind it both ways, which is what makes the glass hang back as a turn
   * starts and sail on after it stops. See `advanceFlow` in `lib/chamber.ts`.
   */
  flow: number;
  /**
   * What the cell is filled with instead of glass, or null when it holds glass.
   *
   * A chamber is one thing or the other and never both: either loose pieces in
   * {@link Scene.shards}, or a substance — and then `shards` is empty and one
   * of the three below is what is in there.
   */
  readonly substance: SubstanceId | null;
  /** Blobs of a second liquid, climbing and sinking. See `lib/lava.ts`. */
  lava: Lava | null;
  /** A fluid and the dye carried on it. See `lib/smoke.ts`. */
  smoke: Smoke | null;
  /** Flakes of foil hanging in clear fluid. See `lib/glitter.ts`. */
  flakes: Flake[] | null;
  /** Seconds elapsed since the scene was created. */
  elapsed: number;
}

export interface SceneUpdate {
  /** Seconds since the previous frame. */
  dt: number;
  /** How fast the cell is being turned, in radians per second. */
  turn: number;
  /** Current drag position, each axis in `[-1, 1]`. */
  drag: { x: number; y: number };
  /**
   * How far the instrument itself is tilted, in radians.
   *
   * This moves gravity, not the figure. The mirrors and the chamber are both
   * fixed in the tube and the tube is the phone, so tilting it turns nothing on
   * screen — what changes is which way the pieces fall, exactly as it does when
   * you tip a real one in your hand.
   */
  tilt?: number | undefined;
  /**
   * How far the mirror framework itself is turned, in radians.
   *
   * The figure turns with it and the pieces do not: gravity does not care which
   * way up the tube is held. Since the cell is drawn inside the framework, its
   * rotation has to come off gravity's direction here, or holding the
   * instrument sideways would have the pile falling sideways with it.
   */
  framework?: number | undefined;
  /**
   * How thick the substance cell's fluid is, 0 thin to 1 gel.
   *
   * The one number all three substances share: how much the fluid resists what
   * is moving through it.
   */
  thickness?: number | undefined;
  /**
   * What the cell is filled with. Left out, the dry one.
   *
   * A whole instrument rather than a setting of one: glass in oil sinks
   * instead of falling, and is swept round by the fluid rather than only
   * tipped by gravity. See {@link Medium}.
   */
  medium?: Medium | undefined;
}

/** Largest step the simulation will take, so a backgrounded tab cannot jump. */
const MAX_STEP_SECONDS = 1 / 20;

/** How far a full drag moves the chamber, in cell units. */
export const DRAG_CELLS = 0.5;

/**
 * How much larger a chip is drawn than the footprint it collides with.
 *
 * A chamber is several pieces deep, and the simulation is one layer: the radius
 * is what keeps two pieces from occupying the same place in the pile, not the
 * size of the glass. Drawn at exactly that radius nothing ever overlaps
 * anything, and the whole point of glass over glass — that it deepens, and that
 * a green over a red goes nearly black — never once happens.
 *
 * Exported for the test that watches the picture rather than the physics: what
 * the view shows as covered is the glass at this drawn size, not the collision
 * footprint.
 */
export const DEPTH_OVERLAP = 1.3;

/**
 * How quickly the contents catch up with the cell, per second.
 *
 * Loose chips are dragged round by friction rather than bolted to the wall:
 * they trail while the cell is turning and settle once it stops. Without this
 * lag the figure would revolve perfectly rigidly, which is the thing that reads
 * as a picture being rotated rather than an instrument being turned.
 */
const CONTENTS_CATCHUP = 4;

/**
 * Furthest the contents may trail the cell, in radians.
 *
 * Without a cap the lag settles at `rate / catchup`, so a brisk swipe leaves the
 * chips half a turn behind and they go on unwinding for seconds after the finger
 * lifts — which reads as the tube still turning. Friction does not work that
 * way: past a point the chips simply get dragged along.
 */
const MAX_LAG = 0.3;

/** Fractional part, for turning a piece's fixed number into a stable choice. */
function frac(value: number): number {
  return value - Math.floor(value);
}

/**
 * Normal size for a piece, in cell units, before the size gesture scales it.
 *
 * The same size a medium's drag is quoted at, deliberately: "normal" ought to
 * mean one thing in the chamber, and the piece that feels exactly the drag
 * written down is the piece the glass is cut around. How *full* the cell is
 * lives in the piece count rather than here — see the `shards` default and
 * limits in `lib/settings.ts`, which fill the cell as far as the pile can stand
 * while still resting and still avalanching.
 */
const PIECE_MIDDLE = REFERENCE_PIECE;

/**
 * How far the widest variety spreads the sizes, as a natural logarithm.
 *
 * A ratio rather than a width, because size is felt as a proportion: a piece
 * twice its neighbour reads the same way whether the two are grit or boulders.
 * At the widest, `e^1.15` is a little over three, so the biggest piece is ten
 * times the smallest across the whole range — everything from a speck to a
 * bead, which is what a real cell holds.
 */
const PIECE_SPREAD = 1.15;

/**
 * How much bigger the average piece comes out for a given spread.
 *
 * Sizes are spread evenly in the logarithm, so with `r = m·e^(u·h)` for `u`
 * even over `[-1, 1]`, the mean of `r²` is `m²·sinh(2h)/2h`. Dividing the
 * middle by the root of that holds the total area of glass constant, which is
 * the point: **the variety slider changes only the variety.** Left alone, a
 * wider spread would put more glass in the cell than a narrow one — a piece
 * three times across is nine times the area — so widening it would fill the
 * chamber as well as mixing it, and there would be no way to ask for one
 * without the other.
 */
function evenness(half: number): number {
  return half === 0 ? 1 : Math.sinh(2 * half) / (2 * half);
}

/**
 * How big one piece is cut, in cell units.
 *
 * @param draw Where in the spread this piece falls, in `[0, 1)`.
 */
export function pieceRadius(draw: number, variety: number): number {
  const half = PIECE_SPREAD * Math.min(1, Math.max(0, variety));
  const middle = PIECE_MIDDLE / Math.sqrt(evenness(half));

  return middle * Math.exp((Math.min(1, Math.max(0, draw)) * 2 - 1) * half);
}

/** How a chamber's glass is cut, over and above how many pieces there are. */
export interface SceneCut {
  /**
   * What the cell holds: loose pieces, or a substance instead of them.
   *
   * Two instruments rather than two settings of one. A cell of glass is built
   * and settled; a cell of substance has no pieces in it at all, and nothing to
   * settle.
   */
  holds?: 'glass' | 'substance';
  /** Which substance, when that is what it holds. */
  substance?: SubstanceId;
  /** How much of it there is, from a trace to a cell full. */
  amount?: number;
  /**
   * Multiplies every piece's size, from the pinch on the artwork.
   *
   * Geometry rather than drawing: a bigger piece displaces its neighbours and
   * piles differently, so the glass is recut rather than the sprites magnified.
   */
  scale?: number;
  /**
   * What the cell is filled with. The fresh glass is settled against it, and a
   * liquid cell is unpacked rather than settled — see `settleChamber`.
   */
  medium?: Medium;
  /**
   * How far the piece sizes spread, from 0 for one size to 1 for the widest.
   *
   * Nought is every piece exactly {@link PIECE_MIDDLE}; the spread opens
   * symmetrically about that in proportion rather than in width, and the total
   * area of glass is held constant across the whole range. See {@link evenness}.
   *
   * Left out, the middle of the range — which is about the spread this chamber
   * has always been cut at, and is what the app opens on.
   */
  variety?: number;
}

/** Builds a deterministic chamber for the given seed. */
export function createScene(seed: string, shardCount: number, cut: SceneCut = {}): Scene {
  const {
    scale: chipScale = 1,
    medium = AIR,
    variety = 0.5,
    holds = 'glass',
    substance = 'lava',
    amount = 0.55,
  } = cut;
  const rng = mulberry32(hashSeed(seed));
  const count = holds === 'glass' ? Math.max(1, Math.floor(shardCount)) : 0;
  const shards: Shard[] = [];

  for (let i = 0; i < count; i += 1) {
    // Sized before it is placed, so it can be born clear of the wall.
    // Scaled here rather than at draw time, because a bigger piece is a
    // bigger piece: it displaces its neighbours, packs differently and piles
    // differently. Scaling only the sprite leaves every arrangement identical
    // and just draws it smaller, which is a picture of the same chamber.
    const radius = pieceRadius(rng(), variety) * Math.max(0.05, chipScale);
    // Scattered over the disc by area, not by radius, so the middle does not
    // come out crowded — and held inside the wall by its own radius, so
    // nothing starts beyond it and has to be shoved in.
    const angle = rng() * Math.PI * 2;
    const distance = Math.sqrt(rng()) * Math.max(0, CHAMBER_RADIUS - radius);

    shards.push({
      kind: randomItem(rng, SHARD_KINDS),
      variant: randomInt(rng, 0, CHIP_VARIANTS - 1),
      x: Math.cos(angle) * distance,
      y: Math.sin(angle) * distance,
      vx: 0,
      vy: 0,
      radius,
      // Until a picture says otherwise the drawn shapes are round enough to
      // collide as the single circle they are cut to.
      shape: ROUND,
      rotation: randomBetween(rng, 0, Math.PI * 2),
      spin: 0,
      skin: { x: rng(), y: rng() },
    });
  }

  const scene: Scene = {
    seed,
    shards,
    chipScale: Math.max(0.05, chipScale),
    pan: { x: 0, y: 0 },
    cell: 0,
    tilt: 0,
    contents: 0,
    drag: { x: 0, y: 0 },
    flow: 0,
    substance: holds === 'substance' ? substance : null,
    // Whichever one the cell is filled with, and only that one: the other two
    // are not built, so switching between them costs a rebuild of the one being
    // switched to and nothing else.
    lava:
      holds === 'substance' && substance === 'lava'
        ? createLava(hashSeed(`${seed}:lava`), amount, chipScale)
        : null,
    smoke:
      holds === 'substance' && substance === 'smoke'
        ? createSmoke(hashSeed(`${seed}:smoke`), amount)
        : null,
    flakes:
      holds === 'substance' && substance === 'glitter'
        ? createGlitter(hashSeed(`${seed}:glitter`), amount, chipScale)
        : null,
    elapsed: 0,
  };

  // Open on a resting pile rather than letting the chips visibly rain down.
  // Nothing to do for a cell of substance: there is no pile in it, and every
  // one of the three is meant to be caught mid-motion.
  if (holds === 'glass') {
    settleChamber(shards, 0, medium.settleSeconds, medium);
  }

  return scene;
}

/**
 * One set of glass the chamber is loaded with: a picture and where in it each
 * piece is cut from.
 *
 * The chamber can hold several at once, so the renderer hands the drawing an
 * array of these rather than a single picture. Which set a given piece belongs
 * to is fixed for that piece — see {@link glassAt} — so the pieces are shared
 * out evenly and a splinter keeps its own scrap of its own set as it tumbles.
 */
export interface Glass {
  /** The picture the pieces of this set are cut out of. */
  readonly skin: CanvasImageSource;
  /** Where in it each piece is cut from, or `null` to cut at random. */
  readonly patches: SkinPatches | null;
}

/**
 * Which of the loaded sets a piece is cut from.
 *
 * Fixed for a piece and spread evenly across whatever sets are on offer.
 * Derived from the same fixed pair that places the piece within a set, but
 * mixed so a piece's set is decorrelated from where in that set it is cut —
 * left tied to `skin.x` alone, a set would only ever show the pieces from one
 * end of its own picture.
 */
function glassAt(shard: Shard, count: number): number {
  if (count <= 1) {
    return 0;
  }

  const mixed = frac(shard.skin.x * 0.7548776662 + shard.skin.y * 0.569840290998);

  return Math.min(count - 1, Math.floor(mixed * count));
}

/**
 * Gives each piece the shape of whatever it is cut to.
 *
 * Called when the glass changes rather than every frame: the shape belongs to
 * the cut, and the cut is fixed for a piece. Without a picture, or for a piece
 * whose cut has gone, a piece is the circle it was cut to fit — which is what
 * the drawn shapes are.
 *
 * @returns Whether anything changed, so a caller can leave a chamber alone that
 *   is already right.
 */
export function applyCutShape(shards: Shard[], glasses: readonly Glass[]): boolean {
  // One shape per cut, not one per piece: a hundred splinters off the same
  // object are the same shape, and the solver reads it every frame.
  const shapes = new Map<SkinCut, Shape>();
  let changed = false;

  for (const shard of shards) {
    const patches = glasses[glassAt(shard, glasses.length)]?.patches ?? null;
    const cut = patches?.cut(shard.skin) ?? null;
    let shape = ROUND;

    if (cut) {
      shape = shapes.get(cut) ?? shapeOf(cut.extent, cut.area, cut.outline);
      shapes.set(cut, shape);
    }

    if (shard.shape !== shape) {
      shard.shape = shape;
      changed = true;
    }
  }

  return changed;
}

/**
 * Advances the simulation in place.
 *
 * Mutation is deliberate: this runs every frame and the scene is owned by the
 * renderer, never by React state, so there is nothing to diff.
 */
export function updateScene(
  scene: Scene,
  { dt, turn, drag, tilt = 0, framework = 0, medium = AIR, thickness = 0.35 }: SceneUpdate,
): Scene {
  const step = Math.min(Math.max(dt, 0), MAX_STEP_SECONDS);

  scene.elapsed += step;
  scene.cell += turn * step;
  scene.tilt = tilt;
  // Exponential approach, clamped so a long frame cannot overshoot past the
  // tube and swing back.
  scene.contents += (scene.cell - scene.contents) * Math.min(1, CONTENTS_CATCHUP * step);

  const lag = scene.cell - scene.contents;

  if (Math.abs(lag) > MAX_LAG) {
    scene.contents = scene.cell - Math.sign(lag) * MAX_LAG;
  }

  scene.drag.x = drag.x;
  scene.drag.y = drag.y;
  // The fluid is dragged round by the wall rather than bolted to it, so it
  // trails the tube and then outlives it. In a dry cell this is the tube's own
  // rate, and the swirl below comes out at exactly nought.
  scene.flow = advanceFlow(scene.flow, step, turn, medium);

  // Gravity keeps pointing at the floor whatever the instrument does, so its
  // direction within the cell is however far the cell has been turned, plus
  // however far the framework it is drawn inside has been turned, plus however
  // far the whole thing is tilted. All three compose: turning the tube sweeps
  // gravity around the cell, holding the instrument at an angle takes it back
  // off again, and tipping the phone moves it once more without turning
  // anything on screen. Nothing else moves the pieces — they tip, avalanche and
  // settle, which is what a real one does and why it never repeats.
  // Which way is down, in the cell's own frame. Everything loose in the cell
  // wants it: the glass, the flakes and the ink alike.
  const angle = scene.cell + framework + tilt;
  // The fluid's turning as the cell sees it: the tube's own rate taken off,
  // since everything in the cell is held in the cell's frame, not the world's.
  const swirl = scene.flow - turn;

  // The classic solver unless the Rapier spike has been asked for and has
  // loaded — see `lib/solver.ts`. Both take the same update and mutate the
  // same shards, so the rest of the scene cannot tell them apart.
  (chamberOverride() ?? updateChamber)(scene.shards, { dt: step, angle, medium, swirl });

  // Whichever substance the cell holds, if it holds one. All three take the
  // same three things — how thick the fluid is, how fast it is turning, and
  // which way is down — because those are the whole of what a cell does to
  // what is in it.
  if (scene.lava) {
    updateLava(scene.lava, { dt: step, thickness, swirl, angle });
  }

  if (scene.smoke) {
    updateSmoke(scene.smoke, { dt: step, thickness, swirl, angle });
  }

  if (scene.flakes) {
    updateGlitter(scene.flakes, { dt: step, thickness, swirl, angle });
  }

  return scene;
}

export interface DrawChamberOptions {
  /** Cell units to device pixels. */
  scale: number;
  /**
   * Draws every piece this much larger than the size it collides at.
   *
   * The live feedback for a pinch in progress: the glass is only recut once
   * the size holds still, but the hand has to see it growing under the
   * fingers, so the sprites run ahead of the cut by this much until it lands.
   * The physics is untouched — pieces overlap a little while it is above one,
   * and the recut resolves it.
   */
  magnify?: number;
  /** Rotation of the chamber about its own centre, in radians. */
  rotation: number;
  /** Offset of the chamber from the apex, in cell units. */
  pan: { x: number; y: number };
  /** Multiplies chip size without changing how many there are. */
  sprites: ChipSprites;
  /**
   * The sets of glass the chamber is loaded with, mixed together.
   *
   * Each piece is cut from one of them — fixed per piece, spread evenly — and
   * from its own patch of that one, so a chamber of them samples every set all
   * over rather than repeating one crop. Left out, the single `skin` and
   * `patches` below stand in as a one-set list, which is what the tests lean on.
   */
  glasses?: readonly Glass[];
  /**
   * The picture the pieces are cut out of, when there is only one set.
   *
   * A convenience for the single-set case: equivalent to a `glasses` of one.
   * Each piece is cut from its own patch of it, so a chamber of them samples
   * the picture all over rather than repeating one crop. Nothing about the
   * lighting changes — a photographed surface is still a surface, and it gets
   * the same shading and the same blaze as a coloured one.
   */
  skin?: CanvasImageSource | null;
  /**
   * Where in that one picture each piece is cut from.
   *
   * Left out, the pieces are cut at uniformly random spots, which is right for
   * a picture that is interesting all over and wrong for one that is a subject
   * on a plain backdrop. See `lib/skin.ts`.
   */
  patches?: SkinPatches | null;
}

/**
 * Paints the chamber, centred on the origin.
 *
 * The caller is responsible for clearing or fading the surface first, and for
 * placing the wedge apex at the origin.
 */
export function drawChamber(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  {
    scale,
    magnify = 1,
    rotation,
    pan,
    sprites,
    glasses,
    skin = null,
    patches = null,
  }: DrawChamberOptions,
): void {
  if (scale <= 0) {
    return;
  }

  // The single `skin`/`patches` are a one-set list; either way the drawing sees
  // only an array of sets to share the pieces out across.
  const sets = glasses ?? (skin ? [{ skin, patches }] : []);

  ctx.save();
  // The pieces are solid, so each one covers what is behind it rather than
  // tinting it.
  ctx.globalCompositeOperation = 'source-over';
  ctx.translate(pan.x * scale, pan.y * scale);
  ctx.rotate(rotation);

  for (const shard of scene.shards) {
    const radius = shard.radius * scale * DEPTH_OVERLAP * magnify;
    const glass = sets[glassAt(shard, sets.length)];

    // Nothing is drawn without a picture to cut it out of. There is no
    // generated piece to fall back to any more, and a chamber of nothing is a
    // truer answer than one full of shapes nobody asked for.
    if (glass) {
      drawSkinned(ctx, shard, sprites, glass.skin, glass.patches, scale, radius);
    }
  }

  ctx.restore();
}

/**
 * One piece, cut from a photograph.
 *
 * Two ways round, depending on what the picture turned out to be.
 *
 * When it is a few separate things on a plain backdrop, the pieces *are* those
 * things: each one is clipped to an object's own traced silhouette and filled
 * from the rectangle that object occupies. Nothing is lit — the photograph
 * arrived with its own light in it, and a second one laid over the top only
 * argues with the first.
 *
 * When it is not — a landscape, a live camera, anything with no backdrop to
 * separate objects from — there is nothing to cut out, so a piece falls back to
 * a generated shape filled with a patch of the picture, and that shape is a
 * solid, so it takes the lighting.
 *
 * Either way it happens here rather than in a cached sprite, which is what lets
 * the camera skin the pieces: its picture is different every frame.
 */
function drawSkinned(
  ctx: CanvasRenderingContext2D,
  shard: Shard,
  sprites: ChipSprites,
  skin: CanvasImageSource,
  patches: SkinPatches | null,
  scale: number,
  radius: number,
): void {
  const source = measureSource(skin);

  if (source.width === 0 || source.height === 0) {
    return;
  }

  const cut = patches?.cut(shard.skin) ?? null;

  if (cut) {
    ctx.save();
    ctx.translate(shard.x * scale, shard.y * scale);
    ctx.rotate(shard.rotation);

    tracePolygon(
      ctx,
      cut.outline.map((point) => ({ x: point.x * radius, y: point.y * radius })),
    );
    ctx.clip();

    // The object's own proportions, so a splinter stays a splinter instead of
    // being stretched to fill a circle.
    const width = cut.extent.x * radius;
    const height = cut.extent.y * radius;

    ctx.drawImage(
      skin,
      cut.source.x,
      cut.source.y,
      cut.source.width,
      cut.source.height,
      -width,
      -height,
      width * 2,
      height * 2,
    );
    ctx.restore();

    return;
  }

  drawPatched(ctx, shard, sprites, skin, source, patches, scale, radius);
}

/** A generated shape filled with a patch of the picture, and lit as a solid. */
function drawPatched(
  ctx: CanvasRenderingContext2D,
  shard: Shard,
  sprites: ChipSprites,
  skin: CanvasImageSource,
  source: { width: number; height: number },
  patches: SkinPatches | null,
  scale: number,
  radius: number,
): void {
  const shading = sprites.shading(shard.kind, shard.variant);
  const blaze = sprites.blaze(shard.kind, shard.variant);

  if (!shading || !blaze) {
    return;
  }

  // A square patch, so the picture is not stretched by the piece's proportions.
  const patch = Math.min(source.width, source.height) * SKIN_PATCH;
  const where = patches ? patches.pick(shard.skin) : shard.skin;
  const left = where.x * (source.width - patch);
  const top = where.y * (source.height - patch);

  ctx.save();
  ctx.translate(shard.x * scale, shard.y * scale);
  ctx.rotate(shard.rotation);

  tracePolygon(
    ctx,
    sprites.outline(shard.kind, shard.variant).map((point) => ({
      x: point.x * radius,
      y: point.y * radius,
    })),
  );
  ctx.clip();

  ctx.drawImage(skin, left, top, patch, patch, -radius, -radius, radius * 2, radius * 2);
  ctx.globalCompositeOperation = 'multiply';
  ctx.drawImage(shading, -radius, -radius, radius * 2, radius * 2);
  ctx.globalCompositeOperation = 'lighter';
  ctx.drawImage(blaze, -radius, -radius, radius * 2, radius * 2);
  ctx.restore();
}

/**
 * Fraction of a picture's shorter side that one piece is cut from.
 *
 * Small enough that neighbouring pieces are visibly different scraps rather
 * than near-copies of the whole picture, and large enough that a piece carries
 * a recognisable part of something rather than a swatch of one colour.
 */
export const SKIN_PATCH = 0.26;
