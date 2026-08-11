/**
 * Turning the tube by turning the phone.
 *
 * A real kaleidoscope is held and rotated, and the chips fall because gravity
 * stays where it is while the tube does not. The chamber already works that
 * way — it is given the cell's angle and puts gravity down in the world — so
 * all this has to do is say how far the phone has been rotated in its own
 * plane.
 */

/** Radians per degree. */
const RADIANS = Math.PI / 180;

/**
 * How far the device is rotated in the plane of its own screen, in radians.
 *
 * `beta` is the front-to-back tilt and `gamma` the left-to-right one, as the
 * device orientation event reports them: held upright and facing you, `beta` is
 * about 90 and `gamma` about 0. Rotate it clockwise in its own plane and `beta`
 * falls towards 0 while `gamma` falls towards -90, so the two together give the
 * angle directly.
 *
 * Positive is clockwise on screen, which is the direction canvas angles grow.
 *
 * Flat on a table both are near zero and the angle is meaningless — there is no
 * "up" in the screen's plane to measure from. That is not an error to guard
 * against: it comes out as a number that wanders, and the caller's smoothing is
 * what keeps it from twitching.
 */
export function screenAngleFromOrientation(beta: number, gamma: number): number {
  if (!Number.isFinite(beta) || !Number.isFinite(gamma)) {
    return 0;
  }

  return Math.atan2(-gamma * RADIANS, beta * RADIANS);
}

/**
 * Continues an angle past a wrap, rather than jumping the long way round.
 *
 * The sensor reports an angle in `(-pi, pi]`, so a hand turning steadily past
 * the top sends it from just under pi to just over -pi. Fed to the chamber as
 * it stands, that is a full turn in one frame: the pile is flung round and the
 * contents unwind for seconds afterwards. Taking the shortest way between the
 * two keeps the number continuous, however many turns it has been through.
 */
export function unwrapAngle(previous: number, next: number): number {
  const turn = Math.PI * 2;
  const delta = ((((next - previous) % turn) + turn + Math.PI) % turn) - Math.PI;

  return previous + delta;
}

/**
 * Smoothing applied to the tilt, per reading.
 *
 * The sensor is noisy at rest, and an unsmoothed angle makes a settled pile
 * shiver. Low enough to take that out, high enough that the tube does not lag
 * the hand holding it.
 */
const TILT_SMOOTHING = 0.25;

/** Moves `from` a share of the way to `to`. */
export function smoothAngle(from: number, to: number, share = TILT_SMOOTHING): number {
  return from + (to - from) * share;
}
