/**
 * The device's own numbers, written out for a person to read.
 *
 * Debug mode draws the triangle and points at gravity, which says what the
 * instrument thinks is happening. This says what it is being told — the raw
 * sensor readings the rest of it is derived from. When the two disagree, the
 * difference between them is the bug.
 */

import { screenGravity, TILT_FLAT, tiltStrength } from './tilt';

export interface Orientation {
  /** Compass heading, in degrees. */
  alpha: number;
  /** Front-to-back tilt, in degrees. About 90 held upright and facing you. */
  beta: number;
  /** Left-to-right tilt, in degrees. Positive when the right edge dips. */
  gamma: number;
}

/** The accelerometer, in metres per second squared. */
export interface Motion {
  x: number;
  y: number;
  z: number;
}

export interface DeviceReadings {
  orientation: Orientation | null;
  motion: Motion | null;
  /** False where the browser has no such sensors at all. */
  supported: boolean;
}

/** Radians per degree. */
const DEGREES = Math.PI / 180;

/**
 * The readout, one line per row.
 *
 * Signed and padded so the numbers hold their place: a column that jumps
 * sideways every time a value crosses zero is unreadable however often it is
 * updated.
 *
 * @param tilt Where the app has decided down is, in radians, or `null` when it
 *   is not being asked. Shown alongside the readings it comes from, because the
 *   whole use of this is telling those two apart.
 */
export function readoutLines(readings: DeviceReadings, tilt: number | null): string[] {
  if (!readings.supported) {
    return ['no motion sensors on this device'];
  }

  const lines: string[] = [];

  if (readings.motion) {
    const { x, y, z } = readings.motion;
    lines.push(`x ${number(x)}  y ${number(y)}  z ${number(z)}  m/s²`);
  }

  if (readings.orientation) {
    const { alpha, beta, gamma } = readings.orientation;
    lines.push(`α ${number(alpha, 0)}  β ${number(beta, 0)}  γ ${number(gamma, 0)}  deg`);
  }

  if (lines.length === 0) {
    // Every browser but Safari simply reports; Safari wants the permission the
    // gravity toggle asks for, and there is nowhere else to say so.
    return ['no readings yet — on iOS, switch on Real gravity'];
  }

  if (tilt !== null) {
    lines.push(`down ${number(tilt / DEGREES, 0)} deg${share(readings.orientation)}`);
  }

  return lines;
}

/**
 * How much of gravity is left in the plane of the screen, as a percentage.
 *
 * The direction above is only worth as much as this: upright it is all of it,
 * laid flat there is none and down points through the glass instead.
 */
function share(orientation: Orientation | null): string {
  if (!orientation) {
    return '';
  }

  const left = tiltStrength(screenGravity(orientation.beta, orientation.gamma));

  return `  ${String(Math.round(left * 100))}%${left < TILT_FLAT ? ' flat' : ''}`;
}

/** A signed, fixed-width number, so a column of them does not jump about. */
function number(value: number, places = 2): string {
  if (!Number.isFinite(value)) {
    return '—';
  }

  // Padded around the sign rather than inside it, so the digits line up and the
  // sign stays attached to them.
  return `${value < 0 ? '-' : '+'}${Math.abs(value).toFixed(places)}`.padStart(
    places === 0 ? 4 : 6,
    ' ',
  );
}
