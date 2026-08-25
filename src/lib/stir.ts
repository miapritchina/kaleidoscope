import { CHAMBER_RADIUS } from './chamber';
import { foldIntoTriangle } from './fold';
import { triangleSideFor } from './renderer';
import { DRAG_CELLS } from './scene';
import { frameworkRadians, triangleCentre } from './tiling';

/**
 * A finger on the figure, folded back into the cell.
 *
 * The screen shows one triangle of cell and a field of its reflections, so a
 * finger is almost never over the cell itself — it is over some mirror image
 * of it. The fold knows which: the same arithmetic that carries each pixel
 * back into the source triangle (`lib/fold.ts`) carries the finger back too,
 * so a drag *anywhere* on the figure stirs the one cell, and the stir appears
 * under the finger and in every reflection at once — which is the only place
 * it could honestly appear, since what is under the finger *is* a reflection.
 *
 * The mapping retraces the view's own placement exactly: the same triangle
 * side formula the renderer draws with, the same centring, the same framework
 * rotation, the same pan, the same turn of the cell. Then the fold, and the
 * point lands in the cell's own frame, where the fluids live.
 */

export interface StirView {
  /** The stage, in the same pixels as the point. */
  width: number;
  height: number;
  /** The mirror-size slider. */
  zoom: number;
  /** The mirror-angle slider, in degrees. */
  angleDegrees: number;
  /** How far the cell has been turned, radians. `Scene.cell`. */
  cell: number;
  /** Where the source has been dragged to, each axis in `[-1, 1]`. */
  drag: { x: number; y: number };
}

/** Where a stage point lands in the cell, in cell units. */
export function stirPoint(
  point: { x: number; y: number },
  view: StirView,
): { x: number; y: number } {
  const side = triangleSideFor(view.width, view.height, view.zoom);
  const framework = frameworkRadians(view.angleDegrees);

  // Undo the view's placement: centre, then the framework's rotation, then
  // the offset that put the source triangle's centre in the middle.
  const dx = point.x - view.width / 2;
  const dy = point.y - view.height / 2;
  const cos = Math.cos(-framework);
  const sin = Math.sin(-framework);
  const centre = triangleCentre(side);
  const fieldX = dx * cos - dy * sin + centre.x;
  const fieldY = dx * sin + dy * cos + centre.y;

  // Fold into the source triangle, apex at the origin.
  const folded = foldIntoTriangle({ x: fieldX, y: fieldY }, side).point;

  // Into cell units: the cell is centred on the triangle's centroid and its
  // radius is the circumradius, exactly as the renderer paints it.
  const cellScale = side / Math.sqrt(3) / CHAMBER_RADIUS;
  const cellX = (folded.x - side / 2) / cellScale - view.drag.x * DRAG_CELLS;
  const cellY = (folded.y - (side * Math.sqrt(3)) / 6) / cellScale - view.drag.y * DRAG_CELLS;

  // And into the turning cell's own frame.
  const turnCos = Math.cos(-view.cell);
  const turnSin = Math.sin(-view.cell);

  return {
    x: cellX * turnCos - cellY * turnSin,
    y: cellX * turnSin + cellY * turnCos,
  };
}

/**
 * Fastest the fluid is told the finger moves, in cell units per second.
 *
 * A flick maps to several cells a frame through the fold; unclamped it reads
 * as an explosion rather than a stir.
 */
const FASTEST = 5;

/**
 * A jump bigger than this between two frames is not motion.
 *
 * The fold is discontinuous at every mirror: a finger crossing a seam lands
 * its folded point somewhere else in the cell in one frame. That is the same
 * fold the eye is watching, so it looks perfectly continuous on screen — but
 * read as a velocity it would be a thunderclap. A jump is a fresh touch.
 */
const TELEPORT = CHAMBER_RADIUS * 0.5;

export interface StirSample {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/**
 * Tracks a folded point from frame to frame and reads a stir off it.
 *
 * @param tracker One object per touch, holding the previous folded point.
 *   Pass `last: null` after a lift, so the next touch starts fresh.
 * @returns The stir for this frame, or null while there is nothing to say —
 *   the first frame of a touch has a position and no velocity yet, and a
 *   held-still finger returns zero velocity, which is a spoon held in the
 *   fluid rather than no spoon.
 */
export function trackStir(
  tracker: { last: { x: number; y: number } | null },
  at: { x: number; y: number },
  dt: number,
): StirSample | null {
  const last = tracker.last;

  tracker.last = { x: at.x, y: at.y };

  if (!last || dt <= 0) {
    return null;
  }

  const dx = at.x - last.x;
  const dy = at.y - last.y;

  if (Math.hypot(dx, dy) > TELEPORT) {
    return null;
  }

  let vx = dx / dt;
  let vy = dy / dt;
  const speed = Math.hypot(vx, vy);

  if (speed > FASTEST) {
    vx *= FASTEST / speed;
    vy *= FASTEST / speed;
  }

  return { x: at.x, y: at.y, vx, vy };
}
