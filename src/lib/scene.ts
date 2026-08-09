import { CHAMBER_RADIUS, settleChamber, updateChamber } from './chamber';
import type { ChipSprites } from './chips';
import { hashSeed, mulberry32, randomBetween, randomItem } from './random';

/**
 * The object chamber of the kaleidoscope: the loose glass that the mirrors
 * repeat. Coordinates are in cell units, centred on the chamber.
 */

export const SHARD_KINDS = ['disc', 'ring', 'petal', 'sliver'] as const;

export type ShardKind = (typeof SHARD_KINDS)[number];

export interface Shard {
  kind: ShardKind;
  /** Position in the chamber, in cell units from its centre. */
  x: number;
  y: number;
  /** Velocity in cell units per second. */
  vx: number;
  vy: number;
  /** Radius in cell units. */
  radius: number;
  rotation: number;
  /** Angular velocity in radians per second. */
  spin: number;
  /** Position along the palette ramp. Glass does not change colour. */
  colorStop: number;
  alpha: number;
}

export interface Scene {
  readonly seed: string;
  readonly shards: Shard[];
  /** Accumulated pan of the cell, in cells. */
  pan: { x: number; y: number };
  /**
   * Angle of the tube — the mirror assembly — in radians.
   *
   * Turning a real kaleidoscope turns the mirrors and the chamber together, so
   * the whole figure revolves. This is that angle.
   */
  tube: number;
  /**
   * Angle of the contents inside the tube, in radians.
   *
   * The chips are loose, so they lag the tube and then settle. That lag is the
   * relative angle between this and {@link Scene.tube}, and it is what makes the
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
  /** Seconds elapsed since the scene was created. */
  elapsed: number;
}

export interface SceneUpdate {
  /** Seconds since the previous frame. */
  dt: number;
  /** How fast the tube is being turned, in radians per second. */
  turn: number;
  /** Current drag position, each axis in `[-1, 1]`. */
  drag: { x: number; y: number };
}

/** Largest step the simulation will take, so a backgrounded tab cannot jump. */
const MAX_STEP_SECONDS = 1 / 20;

/** How far a full drag moves the chamber, in cell units. */
export const DRAG_CELLS = 0.5;

/**
 * How quickly the contents catch up with the tube, per second.
 *
 * Loose chips are dragged round by friction rather than bolted to the barrel:
 * they trail while the tube is turning and settle once it stops. Without this
 * lag the figure would revolve perfectly rigidly, which is the thing that reads
 * as a picture being rotated rather than an instrument being turned.
 */
const CONTENTS_CATCHUP = 4;

/**
 * Furthest the contents may trail the tube, in radians.
 *
 * Without a cap the lag settles at `rate / catchup`, so a brisk swipe leaves the
 * chips half a turn behind and they go on unwinding for seconds after the finger
 * lifts — which reads as the tube still turning. Friction does not work that
 * way: past a point the chips simply get dragged along.
 */
const MAX_LAG = 0.3;

/** Builds a deterministic chamber of glass for the given seed. */
export function createScene(seed: string, shardCount: number): Scene {
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
      x: Math.cos(angle) * distance,
      y: Math.sin(angle) * distance,
      vx: 0,
      vy: 0,
      // Sized so the glass packs the chamber to around two thirds by area: a
      // real cell is full, so tipping it rearranges the pile rather than
      // emptying most of the view.
      radius: randomBetween(rng, 0.09, 0.26),
      rotation: randomBetween(rng, 0, Math.PI * 2),
      spin: 0,
      colorStop: rng(),
      alpha: randomBetween(rng, 0.55, 0.95),
    });
  }

  const scene: Scene = {
    seed,
    shards,
    pan: { x: 0, y: 0 },
    tube: 0,
    contents: 0,
    drag: { x: 0, y: 0 },
    elapsed: 0,
  };

  // Open on a resting pile rather than letting the chips visibly rain down.
  settleChamber(shards);

  return scene;
}

/**
 * Advances the simulation in place.
 *
 * Mutation is deliberate: this runs every frame and the scene is owned by the
 * renderer, never by React state, so there is nothing to diff.
 */
export function updateScene(scene: Scene, { dt, turn, drag }: SceneUpdate): Scene {
  const step = Math.min(Math.max(dt, 0), MAX_STEP_SECONDS);

  scene.elapsed += step;
  scene.tube += turn * step;
  // Exponential approach, clamped so a long frame cannot overshoot past the
  // tube and swing back.
  scene.contents += (scene.tube - scene.contents) * Math.min(1, CONTENTS_CATCHUP * step);

  const lag = scene.tube - scene.contents;

  if (Math.abs(lag) > MAX_LAG) {
    scene.contents = scene.tube - Math.sign(lag) * MAX_LAG;
  }

  scene.drag.x = drag.x;
  scene.drag.y = drag.y;

  // The chamber is fixed to the tube, so gravity sweeps around it as the tube
  // turns. Nothing else moves the glass: it tips, avalanches and settles, which
  // is what a real one does and why it never repeats.
  updateChamber(scene.shards, { dt: step, tube: scene.tube });

  return scene;
}

export interface DrawChamberOptions {
  /** Cell units to device pixels. */
  scale: number;
  /** Rotation of the chamber about the wedge apex, in radians. */
  rotation: number;
  /** Offset of the chamber from the apex, in cell units. */
  pan: { x: number; y: number };
  /** Multiplies chip size without changing how many there are. */
  chipScale?: number;
  sprites: ChipSprites;
  /** Additive blending for overlapping chips. */
  glow: boolean;
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
  { scale, rotation, pan, chipScale = 1, sprites, glow }: DrawChamberOptions,
): void {
  if (scale <= 0) {
    return;
  }

  ctx.save();
  ctx.globalCompositeOperation = glow ? 'lighter' : 'source-over';
  ctx.translate(pan.x * scale, pan.y * scale);
  ctx.rotate(rotation);

  for (const shard of scene.shards) {
    const sprite = sprites.get(shard.kind, shard.colorStop);

    if (!sprite) {
      continue;
    }

    const radius = shard.radius * scale * chipScale;

    ctx.save();
    ctx.translate(shard.x * scale, shard.y * scale);
    ctx.rotate(shard.rotation);
    ctx.globalAlpha = shard.alpha;
    ctx.drawImage(sprite, -radius, -radius, radius * 2, radius * 2);
    ctx.restore();
  }

  ctx.restore();
}
