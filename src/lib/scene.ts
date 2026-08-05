import type { ColorRamp } from './colorRamp';
import { hashSeed, mulberry32, randomBetween, randomInt, randomItem } from './random';

/**
 * The "object cell" of the kaleidoscope: the small chamber of loose shards that
 * the mirrors repeat. Coordinates are normalised to a unit cell that tiles
 * infinitely, so the field never runs out however far it drifts.
 */

export const SHARD_KINDS = ['disc', 'ring', 'petal', 'sliver'] as const;

export type ShardKind = (typeof SHARD_KINDS)[number];

export interface Shard {
  kind: ShardKind;
  /** Position within the unit cell, always kept in `[0, 1)`. */
  x: number;
  y: number;
  /** Drift velocity in cells per second. */
  vx: number;
  vy: number;
  /** Radius as a fraction of the cell. */
  radius: number;
  rotation: number;
  /** Angular velocity in radians per second. */
  spin: number;
  /** Position along the palette ramp. */
  colorStop: number;
  /** How fast this shard slides along the palette. */
  colorDrift: number;
  alpha: number;
  /** Amplitude of the size pulse. */
  pulse: number;
  /** Phase offset so shards do not pulse in lockstep. */
  phase: number;
}

export interface Scene {
  readonly seed: string;
  readonly shards: Shard[];
  /** Accumulated pan of the cell, in cells. */
  pan: { x: number; y: number };
  /** Accumulated rotation of the source within the mirrors, in radians. */
  rotation: number;
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
  /** Rotation speed in turns per second. */
  speed: number;
  /** Current drag position, each axis in `[-1, 1]`. */
  drag: { x: number; y: number };
}

/** Largest step the simulation will take, so a backgrounded tab cannot jump. */
const MAX_STEP_SECONDS = 1 / 20;

/** How far a full drag moves the shard field, in cells. */
export const DRAG_CELLS = 1.5;

/** Idle drift of the shard field, in cells per second. */
const DRIFT = 0.01;

/** Builds a deterministic field of shards for the given seed. */
export function createScene(seed: string, shardCount: number): Scene {
  const rng = mulberry32(hashSeed(seed));
  const count = Math.max(1, Math.floor(shardCount));
  const shards: Shard[] = [];

  for (let i = 0; i < count; i += 1) {
    shards.push({
      kind: randomItem(rng, SHARD_KINDS),
      x: rng(),
      y: rng(),
      vx: randomBetween(rng, -0.035, 0.035),
      vy: randomBetween(rng, -0.035, 0.035),
      radius: randomBetween(rng, 0.03, 0.16),
      rotation: randomBetween(rng, 0, Math.PI * 2),
      spin: randomBetween(rng, -0.6, 0.6),
      colorStop: rng(),
      colorDrift: randomBetween(rng, -0.05, 0.05),
      alpha: randomBetween(rng, 0.35, 0.9),
      pulse: randomBetween(rng, 0, 0.35),
      phase: randomBetween(rng, 0, Math.PI * 2),
    });
  }

  // Guarantee at least one large shard so the centre never looks empty.
  shards[randomInt(rng, 0, shards.length - 1)]!.radius = randomBetween(rng, 0.18, 0.26);

  return {
    seed,
    shards,
    pan: { x: 0, y: 0 },
    rotation: 0,
    drag: { x: 0, y: 0 },
    elapsed: 0,
  };
}

/**
 * Advances the simulation in place.
 *
 * Mutation is deliberate: this runs every frame and the scene is owned by the
 * renderer, never by React state, so there is nothing to diff.
 */
export function updateScene(scene: Scene, { dt, speed, drag }: SceneUpdate): Scene {
  const step = Math.min(Math.max(dt, 0), MAX_STEP_SECONDS);

  scene.elapsed += step;
  scene.rotation += speed * Math.PI * 2 * step;
  scene.drag.x = drag.x;
  scene.drag.y = drag.y;
  scene.pan.x += DRIFT * step;

  for (const shard of scene.shards) {
    shard.x = wrapUnit(shard.x + shard.vx * step);
    shard.y = wrapUnit(shard.y + shard.vy * step);
    shard.rotation += shard.spin * step;
    shard.colorStop = wrapUnit(shard.colorStop + shard.colorDrift * step);
  }

  return scene;
}

export interface DrawCellOptions {
  /** Side of the square region to fill, in device pixels. */
  size: number;
  /** Side of one tile of the cell, in device pixels. */
  cellSize: number;
  /** Rotation of the field about the wedge apex, in radians. */
  rotation: number;
  /** Pan of the field, in cells. */
  pan: { x: number; y: number };
  ramp: ColorRamp;
  /** Additive blending for overlapping shards. */
  glow: boolean;
}

/**
 * Paints the shard field across a square region, tiling the unit cell as many
 * times as needed to cover it. The caller is responsible for clearing or fading
 * the surface first, and for placing the wedge apex at the origin.
 */
export function drawCell(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  { size, cellSize, rotation, pan, ramp, glow }: DrawCellOptions,
): void {
  if (size <= 0 || cellSize <= 0) {
    return;
  }

  // The visible square is `[0, size]` on both axes from the apex. Rotating the
  // field means covering that square in the field's own frame, so its corners
  // are mapped back through the inverse rotation and tiles laid over the result.
  // Tiling a rotation-agnostic bounding box instead would draw up to twice the
  // shards needed at the shallow angles that dominate.
  const bounds = rotatedBounds(size, -rotation);
  const offsetX = wrapTo(pan.x * cellSize, cellSize);
  const offsetY = wrapTo(pan.y * cellSize, cellSize);

  const firstColumn = Math.floor((bounds.minX - offsetX) / cellSize);
  const lastColumn = Math.ceil((bounds.maxX - offsetX) / cellSize);
  const firstRow = Math.floor((bounds.minY - offsetY) / cellSize);
  const lastRow = Math.ceil((bounds.maxY - offsetY) / cellSize);

  ctx.save();
  ctx.globalCompositeOperation = glow ? 'lighter' : 'source-over';
  ctx.rotate(rotation);

  for (let row = firstRow; row <= lastRow; row += 1) {
    for (let column = firstColumn; column <= lastColumn; column += 1) {
      const originX = offsetX + column * cellSize;
      const originY = offsetY + row * cellSize;

      for (const shard of scene.shards) {
        drawShard(ctx, shard, {
          x: originX + shard.x * cellSize,
          y: originY + shard.y * cellSize,
          scale: cellSize,
          bounds,
          elapsed: scene.elapsed,
          ramp,
        });
      }
    }
  }

  ctx.restore();
}

interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** Axis-aligned bounds of the square `[0, size]^2` rotated by `angle`. */
function rotatedBounds(size: number, angle: number): Bounds {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const xs: number[] = [];
  const ys: number[] = [];

  for (const [x, y] of [
    [0, 0],
    [size, 0],
    [0, size],
    [size, size],
  ] as const) {
    xs.push(x * cos - y * sin);
    ys.push(x * sin + y * cos);
  }

  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

interface DrawShardOptions {
  x: number;
  y: number;
  scale: number;
  bounds: Bounds;
  elapsed: number;
  ramp: ColorRamp;
}

function drawShard(
  ctx: CanvasRenderingContext2D,
  shard: Shard,
  { x, y, scale, bounds, elapsed, ramp }: DrawShardOptions,
): void {
  const pulse = 1 + Math.sin(elapsed * 1.3 + shard.phase) * shard.pulse;
  const radius = shard.radius * scale * pulse;

  // Cheap cull: tiles are laid beyond the visible region on every side.
  if (
    x + radius < bounds.minX ||
    y + radius < bounds.minY ||
    x - radius > bounds.maxX ||
    y - radius > bounds.maxY
  ) {
    return;
  }

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(shard.rotation);
  ctx.fillStyle = ramp.css(shard.colorStop, shard.alpha);
  ctx.strokeStyle = ctx.fillStyle;

  switch (shard.kind) {
    case 'disc': {
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'ring': {
      ctx.lineWidth = Math.max(1, radius * 0.22);
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'petal': {
      ctx.beginPath();
      ctx.moveTo(0, -radius);
      ctx.quadraticCurveTo(radius, 0, 0, radius);
      ctx.quadraticCurveTo(-radius, 0, 0, -radius);
      ctx.fill();
      break;
    }
    case 'sliver': {
      ctx.beginPath();
      ctx.moveTo(0, -radius);
      ctx.lineTo(radius * 0.42, radius);
      ctx.lineTo(-radius * 0.42, radius * 0.6);
      ctx.closePath();
      ctx.fill();
      break;
    }
  }

  ctx.restore();
}

/** Wraps a value into `[0, 1)`. */
function wrapUnit(value: number): number {
  return ((value % 1) + 1) % 1;
}

/** Wraps a value into `[0, span)`. */
function wrapTo(value: number, span: number): number {
  return ((value % span) + span) % span;
}
