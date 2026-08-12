/**
 * Which way is down, for a phone being held.
 *
 * Tipping a real kaleidoscope does not turn the figure — the mirrors and the
 * chamber are both fixed in the tube — it changes which way the pieces fall.
 * The chamber already takes a direction for gravity, so all this has to do is
 * work out which way down lies in the plane of the screen, and that goes to
 * gravity rather than to the figure.
 */

/** Radians per degree. */
const RADIANS = Math.PI / 180;

/**
 * Which way down lies in the plane of the screen, and how much of it is there.
 *
 * The device orientation event reports three Euler angles: `alpha` about the
 * vertical, then `beta` about the device's own x, then `gamma` about its own y.
 * Composed in that order the rotation from the device's axes to the room's is
 * `Rz(alpha) Rx(beta) Ry(gamma)`, and the room's upright direction written in
 * the device's own axes is that matrix's bottom row,
 * `(-cos b sin g, sin b, cos b cos g)`. Down is its negative, and the screen
 * shows the first two of those — with the sign of the second flipped, because a
 * canvas counts y downwards and the device counts it up.
 *
 * So: `x = cos(beta) sin(gamma)`, `y = sin(beta)`.
 *
 * `alpha` is absent on purpose. Turning on the spot with the phone held out in
 * front of you does not move the glass, and it should not.
 *
 * The length of this is what is left of gravity once the screen has taken its
 * share — 1 held upright, 0 laid flat on a table, where down is straight
 * through the glass and there is no direction in the screen for it to have.
 */
export interface ScreenGravity {
  x: number;
  y: number;
}

export function screenGravity(beta: number, gamma: number): ScreenGravity {
  if (!Number.isFinite(beta) || !Number.isFinite(gamma)) {
    return { x: 0, y: 1 };
  }

  const pitch = beta * RADIANS;
  const roll = gamma * RADIANS;

  return { x: Math.cos(pitch) * Math.sin(roll), y: Math.sin(pitch) };
}

/**
 * How far down has swung from the bottom of the screen, in radians.
 *
 * Positive is clockwise, which is the direction canvas angles grow and the way
 * gravity goes when the right edge of the phone dips.
 *
 * This was `atan2(gamma, beta)` for a long time, which is the two Euler angles
 * treated as if they were the components of a vector. They are not, and it
 * fails in exactly the way that was reported: tip the phone away from you and
 * `beta` runs down towards 0 while `gamma` stays near it, so the ratio of the
 * two — and with it the whole direction of gravity — swings across to the side
 * on a movement that has no side to it at all.
 */
export function screenAngleFromOrientation(beta: number, gamma: number): number {
  const down = screenGravity(beta, gamma);

  return Math.atan2(down.x, down.y);
}

/**
 * How much of gravity the screen still has, from 1 upright to 0 laid flat.
 *
 * Which is the same question as how much the angle above is worth believing.
 */
export function tiltStrength({ x, y }: ScreenGravity): number {
  return Math.hypot(x, y);
}

/**
 * Below this, the phone is flat enough that down has no direction on screen.
 *
 * A screen within about ten degrees of horizontal. The angle does not become
 * inaccurate there so much as meaningless — down points through the glass, and
 * what little is left in the plane is whichever way the hand happens to be
 * shaking. Readings this flat are dropped rather than smoothed, so a phone put
 * down on a table leaves the pile where it was instead of stirring it.
 */
export const TILT_FLAT = 0.18;

/**
 * Continues an angle past a wrap, rather than jumping the long way round.
 *
 * The sensor reports an angle in `(-pi, pi]`, so a hand turning steadily past
 * the top sends it from just under pi to just over -pi. Gravity itself does not
 * mind — it is a sine and a cosine, and those do not notice a whole turn — but
 * the smoothing below does: asked to move from one to the other it sweeps all
 * the way round through zero, and the pile slides the wrong way while it does.
 * Taking the shortest way between the two keeps the number continuous, however
 * many turns it has been through.
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
 * shiver. Low enough to take that out, high enough that gravity does not lag
 * the hand holding the phone.
 */
const TILT_SMOOTHING = 0.25;

/** Moves `from` a share of the way to `to`. */
export function smoothAngle(from: number, to: number, share = TILT_SMOOTHING): number {
  return from + (to - from) * share;
}
