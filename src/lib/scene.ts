import { CHAMBER_RADIUS, settleChamber, updateChamber } from './chamber';
import { CHIP_VARIANTS, tracePolygon, type ChipSprites } from './chips';
import { hashSeed, mulberry32, randomBetween, randomInt, randomItem } from './random';
import { measureSource, type SkinPatches } from './skin';

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
   * How much of that circle the glass actually fills, across.
   *
   * 1 for a piece as wide as it is long. A cut-out sliver fills a fraction of
   * its own circle, and colliding with the circle would hold everything a
   * sliver's length away in every direction — the pile settles full of air and
   * pieces come to rest on nothing. Set from the picture the pieces are cut
   * from; the drawn size is {@link Shard.radius} either way.
   */
  girth: number;
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
   * where it is let go, which is what dragging something means. A photo cannot
   * tile, so its travel is bounded by however much hangs outside the wedge.
   */
  drag: { x: number; y: number };
  /**
   * How far the instrument is tilted, in radians.
   *
   * Gravity's direction on screen, and nothing else — the figure does not turn
   * with it. Kept so the debug overlay has something to point at.
   */
  tilt: number;
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
 */
const DEPTH_OVERLAP = 1.3;

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

/** Builds a deterministic chamber of glass for the given seed. */
export function createScene(seed: string, shardCount: number, chipScale = 1): Scene {
  const rng = mulberry32(hashSeed(seed));
  const count = Math.max(1, Math.floor(shardCount));
  const shards: Shard[] = [];

  for (let i = 0; i < count; i += 1) {
    // Scattered over the disc by area, not by radius, so the middle does not
    // come out crowded.
    const angle = rng() * Math.PI * 2;
    const distance = Math.sqrt(rng()) * CHAMBER_RADIUS * 0.85;

    shards.push({
      kind: randomItem(rng, SHARD_KINDS),
      variant: randomInt(rng, 0, CHIP_VARIANTS - 1),
      x: Math.cos(angle) * distance,
      y: Math.sin(angle) * distance,
      vx: 0,
      vy: 0,
      // Sized so the glass packs the chamber to around three quarters by area:
      // a real cell is full, so tipping it rearranges the pile rather than
      // emptying most of the view. The range is wide because a real one holds
      // everything from a splinter to a bead.
      // Scaled here rather than at draw time, because a bigger piece is a
      // bigger piece: it displaces its neighbours, packs differently and piles
      // differently. Scaling only the sprite leaves every arrangement identical
      // and just draws it smaller, which is a picture of the same chamber.
      radius: randomBetween(rng, 0.08, 0.26) * Math.max(0.05, chipScale),
      // Until a picture says otherwise the drawn shapes are round enough to
      // collide as the circles they are cut to.
      girth: 1,
      rotation: randomBetween(rng, 0, Math.PI * 2),
      spin: 0,
      skin: { x: rng(), y: rng() },
    });
  }

  const scene: Scene = {
    seed,
    shards,
    pan: { x: 0, y: 0 },
    cell: 0,
    tilt: 0,
    contents: 0,
    drag: { x: 0, y: 0 },
    elapsed: 0,
  };

  // Open on a resting pile rather than letting the chips visibly rain down.
  settleChamber(shards);

  return scene;
}

/**
 * Tells each piece how much of its circle the glass it is cut to actually fills.
 *
 * Called when the picture changes rather than every frame: it is a property of
 * the cut, and the cut is fixed for a piece. Without a picture, or for a piece
 * whose cut has gone, the circle is the answer — the drawn shapes fill theirs.
 *
 * @returns Whether anything changed, so a caller can skip resettling a chamber
 *   that is already right.
 */
export function applyCutGirth(shards: Shard[], patches: SkinPatches | null): boolean {
  let changed = false;

  for (const shard of shards) {
    const girth = patches?.cut(shard.skin)?.girth ?? 1;

    if (shard.girth !== girth) {
      shard.girth = girth;
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
  { dt, turn, drag, tilt = 0, framework = 0 }: SceneUpdate,
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

  // Gravity keeps pointing at the floor whatever the instrument does, so its
  // direction within the cell is however far the cell has been turned, plus
  // however far the framework it is drawn inside has been turned, plus however
  // far the whole thing is tilted. All three compose: turning the tube sweeps
  // gravity around the cell, holding the instrument at an angle takes it back
  // off again, and tipping the phone moves it once more without turning
  // anything on screen. Nothing else moves the pieces — they tip, avalanche and
  // settle, which is what a real one does and why it never repeats.
  updateChamber(scene.shards, { dt: step, angle: scene.cell + framework + tilt });

  return scene;
}

export interface DrawChamberOptions {
  /** Cell units to device pixels. */
  scale: number;
  /** Rotation of the chamber about its own centre, in radians. */
  rotation: number;
  /** Offset of the chamber from the apex, in cell units. */
  pan: { x: number; y: number };
  /** Multiplies chip size without changing how many there are. */
  sprites: ChipSprites;
  /**
   * The picture the pieces are cut out of.
   *
   * Each piece is cut from its own patch of it, so a chamber of them samples
   * the picture all over rather than repeating one crop. Nothing about the
   * lighting changes — a photographed surface is still a surface, and it gets
   * the same shading and the same blaze as a coloured one.
   */
  skin?: CanvasImageSource | null;
  /**
   * Where in that photograph each piece is cut from.
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
  { scale, rotation, pan, sprites, skin = null, patches = null }: DrawChamberOptions,
): void {
  if (scale <= 0) {
    return;
  }

  ctx.save();
  // The pieces are solid, so each one covers what is behind it rather than
  // tinting it.
  ctx.globalCompositeOperation = 'source-over';
  ctx.translate(pan.x * scale, pan.y * scale);
  ctx.rotate(rotation);

  for (const shard of scene.shards) {
    const radius = shard.radius * scale * DEPTH_OVERLAP;

    // Nothing is drawn without a picture to cut it out of. There is no
    // generated piece to fall back to any more, and a chamber of nothing is a
    // truer answer than one full of shapes nobody asked for.
    if (skin) {
      drawSkinned(ctx, shard, sprites, skin, patches, scale, radius);
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
