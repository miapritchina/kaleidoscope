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

/**
 * Where a stage point lands, in the frame the finger's own motion belongs to.
 *
 * Folded into the source triangle and put into cell units — but *before* the
 * cell's own turn is taken off, because the finger is in the room and not in
 * the tube. Turning the tube does not move a finger resting on the glass, and
 * a velocity read after the turn has been divided out says that it does. See
 * {@link trackStir}, which is the whole reason this stops one step short.
 */
export function heldPoint(
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
  return {
    x: (folded.x - side / 2) / cellScale - view.drag.x * DRAG_CELLS,
    y: (folded.y - (side * Math.sqrt(3)) / 6) / cellScale - view.drag.y * DRAG_CELLS,
  };
}

/** Anything of the framework's frame, turned into the cell's. */
function intoCell(vector: { x: number; y: number }, cell: number): { x: number; y: number } {
  const turnCos = Math.cos(-cell);
  const turnSin = Math.sin(-cell);

  return {
    x: vector.x * turnCos - vector.y * turnSin,
    y: vector.x * turnSin + vector.y * turnCos,
  };
}

/** Where a stage point lands in the cell, in cell units. */
export function stirPoint(
  point: { x: number; y: number },
  view: StirView,
): { x: number; y: number } {
  return intoCell(heldPoint(point, view), view.cell);
}

/**
 * Fastest the fluid is told the finger moves, in cell units per second.
 *
 * A flick maps to several cells a frame through the fold; unclamped it reads
 * as an explosion rather than a stir. Two chamber radii a second is a finger
 * sweeping the whole cell in half of one, which is as hard as anybody stirs
 * anything — and it is the scale the cell itself works at, where the old cap
 * of five was not: the wax's own top speed is 1.6, so every drag that reached
 * the cap drove the cell at three times what anything in it can do, and the
 * substance came apart rather than swirled.
 */
const FASTEST = CHAMBER_RADIUS * 2;

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
 * The tracking is done in the framework's frame and only the answer is turned
 * into the cell's, and that is the point of the whole function. Differencing
 * the point *after* the cell's turn has been divided out measures the frame
 * turning as well as the finger moving: a finger resting perfectly still on
 * the glass of a tube being turned at six radians a second reported a stir of
 * three cell units a second — more than the wax can move on its own — pointed
 * against the turn, everywhere at once, for as long as it was held. That is
 * what a finger fighting its own rotation looked like, and nobody wrote it. A
 * still finger stirs nothing; a moving one stirs by exactly how far it moved.
 *
 * @param tracker One object per touch, holding the previous point in the
 *   framework's frame. Pass `last: null` after a lift, so the next touch
 *   starts fresh.
 * @param held Where the finger is now, from {@link heldPoint}.
 * @param cell How far the cell is turned, which carries both the point and
 *   the velocity into the frame the fluid is held in.
 * @returns The stir for this frame, in the cell's own frame, or null while
 *   there is nothing to say — the first frame of a touch has a position and
 *   no velocity yet.
 */
export function trackStir(
  tracker: { last: { x: number; y: number } | null },
  held: { x: number; y: number },
  cell: number,
  dt: number,
): StirSample | null {
  const last = tracker.last;

  tracker.last = { x: held.x, y: held.y };

  if (!last || dt <= 0) {
    return null;
  }

  const dx = held.x - last.x;
  const dy = held.y - last.y;

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

  const at = intoCell(held, cell);
  const along = intoCell({ x: vx, y: vy }, cell);

  return { x: at.x, y: at.y, vx: along.x, vy: along.y };
}
