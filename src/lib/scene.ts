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
  /** Accumulated rotation of the mirror assembly, in radians. */
  rotation: number;
  /** Seconds elapsed since the scene was created. */
  elapsed: number;
}

export interface SceneUpdate {
  /** Seconds since the previous frame. */
  dt: number;
  /** Rotation speed in turns per second. */
  speed: number;
  /** Pointer offset from the centre, each axis in `[-1, 1]`. */
  pointer: { x: number; y: number };
}

/** Largest step the simulation will take, so a backgrounded tab cannot jump. */
const MAX_STEP_SECONDS = 1 / 20;

/** How strongly the pointer pushes the cell around, in cells per second. */
const POINTER_INFLUENCE = 0.09;

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

  return { seed, shards, pan: { x: 0, y: 0 }, rotation: 0, elapsed: 0 };
}

/**
 * Advances the simulation in place.
 *
 * Mutation is deliberate: this runs every frame and the scene is owned by the
 * renderer, never by React state, so there is nothing to diff.
 */
export function updateScene(scene: Scene, { dt, speed, pointer }: SceneUpdate): Scene {
  const step = Math.min(Math.max(dt, 0), MAX_STEP_SECONDS);

  scene.elapsed += step;
  scene.rotation += speed * Math.PI * 2 * step;
  scene.pan.x += (pointer.x * POINTER_INFLUENCE + 0.01) * step;
  scene.pan.y += pointer.y * POINTER_INFLUENCE * step;

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
  ramp: ColorRamp;
  /** Additive blending for overlapping shards. */
  glow: boolean;
}

/**
 * Paints the shard field across a square region, tiling the unit cell as many
 * times as needed to cover it. The caller is responsible for clearing or fading
 * the surface first.
 */
export function drawCell(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  { size, cellSize, ramp, glow }: DrawCellOptions,
): void {
  if (size <= 0 || cellSize <= 0) {
    return;
  }

  const tiles = Math.ceil(size / cellSize) + 1;
  const offsetX = wrapTo(scene.pan.x * cellSize, cellSize);
  const offsetY = wrapTo(scene.pan.y * cellSize, cellSize);

  ctx.save();
  ctx.globalCompositeOperation = glow ? 'lighter' : 'source-over';

  for (let row = -1; row < tiles; row += 1) {
    for (let column = -1; column < tiles; column += 1) {
      const originX = offsetX + column * cellSize;
      const originY = offsetY + row * cellSize;

      for (const shard of scene.shards) {
        drawShard(ctx, shard, {
          x: originX + shard.x * cellSize,
          y: originY + shard.y * cellSize,
          scale: cellSize,
          bounds: size,
          elapsed: scene.elapsed,
          ramp,
        });
      }
    }
  }

  ctx.restore();
}

interface DrawShardOptions {
  x: number;
  y: number;
  scale: number;
  bounds: number;
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

  // Cheap cull: tiles are drawn beyond the visible square on every side.
  if (x + radius < 0 || y + radius < 0 || x - radius > bounds || y - radius > bounds) {
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
