import { CHAMBER_RADIUS } from './chamber';

/**
 * Reading a stir off a finger that is being folded.
 *
 * The screen shows one triangle of chamber and a field of its reflections, so
 * a finger is almost never over the chamber itself — it is over some mirror
 * image of it. Carrying it home is the body's arithmetic and lives there, in
 * `KaleidoscopeBody.probe`: it is the body's own placement run backwards, and
 * a second copy of it would be a second thing to keep in step.
 *
 * What is left here is the part that is not geometry at all — turning a
 * sequence of folded points into a velocity, which is harder than it sounds
 * for exactly the reason the fold makes it interesting, and for a second
 * reason besides: the finger is in the room and the chamber is turning under
 * it, so the two frames have to be kept apart until the very last step. The
 * body hands over a point in *its* frame, the differencing happens there, and
 * only the answer is carried into the chamber's. See {@link trackStir}.
 */

/**
 * Anything of the body's frame, turned into the chamber's.
 *
 * Kept here rather than in the body because it is the last step of reading a
 * stir, and reading a stir is the whole of what this file does.
 */
function intoCell(vector: { x: number; y: number }, cell: number): { x: number; y: number } {
  const turnCos = Math.cos(-cell);
  const turnSin = Math.sin(-cell);

  return {
    x: vector.x * turnCos - vector.y * turnSin,
    y: vector.x * turnSin + vector.y * turnCos,
  };
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
 * The tracking is done in the body's frame and only the answer is turned
 * into the chamber's, and that is the point of the whole function. Differencing
 * the point *after* the cell's turn has been divided out measures the frame
 * turning as well as the finger moving: a finger resting perfectly still on
 * the glass of a tube being turned at six radians a second reported a stir of
 * three cell units a second — more than the wax can move on its own — pointed
 * against the turn, everywhere at once, for as long as it was held. That is
 * what a finger fighting its own rotation looked like, and nobody wrote it. A
 * still finger stirs nothing; a moving one stirs by exactly how far it moved.
 *
 * @param tracker One object per touch, holding the previous point in the
 *   body's frame. Pass `last: null` after a lift, so the next touch
 *   starts fresh.
 * @param held Where the finger is now, from `KaleidoscopeBody.probe`.
 * @param cell How far the chamber is turned in its bearing, which carries both the point and
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
