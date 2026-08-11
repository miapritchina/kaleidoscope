import { describe, expect, it } from 'vitest';

import { screenAngleFromOrientation, smoothAngle, unwrapAngle } from './tilt';

const degrees = (radians: number) => (radians * 180) / Math.PI;

describe('screenAngleFromOrientation', () => {
  // Held upright and facing you: beta about 90, gamma about 0, and the tube is
  // where it started.
  it('reads upright as no turn at all', () => {
    expect(screenAngleFromOrientation(90, 0)).toBeCloseTo(0, 6);
  });

  // Rotating the phone clockwise in its own plane takes beta towards 0 and
  // gamma towards -90. Positive is clockwise, which is the way canvas angles
  // grow, so the tube turns the way the hand does.
  it('reads a quarter turn clockwise as a quarter turn clockwise', () => {
    expect(degrees(screenAngleFromOrientation(0, -90))).toBeCloseTo(90, 4);
  });

  it('reads a quarter turn anticlockwise as the opposite', () => {
    expect(degrees(screenAngleFromOrientation(0, 90))).toBeCloseTo(-90, 4);
  });

  it('reads the halfway points in between', () => {
    expect(degrees(screenAngleFromOrientation(45, -45))).toBeCloseTo(45, 4);
    expect(degrees(screenAngleFromOrientation(45, 45))).toBeCloseTo(-45, 4);
  });

  // Upside down is half a turn either way; which of the two it names does not
  // matter, only that it is half a turn.
  it('reads upside down as half a turn', () => {
    expect(Math.abs(degrees(screenAngleFromOrientation(-90, 0)))).toBeCloseTo(180, 4);
  });

  it('gives a number for readings that are not ones', () => {
    expect(screenAngleFromOrientation(Number.NaN, 0)).toBe(0);
    expect(screenAngleFromOrientation(0, Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('unwrapAngle', () => {
  // The sensor reports within a single turn, so a hand turning steadily past
  // the top sends it from just under pi to just over -pi. Taken as read that is
  // a whole turn in one frame: the pile is flung round and the contents unwind
  // for seconds afterwards.
  it('carries on past the wrap rather than going the long way round', () => {
    const before = Math.PI - 0.05;
    const after = unwrapAngle(before, -Math.PI + 0.05);

    expect(after).toBeCloseTo(Math.PI + 0.05, 6);
    expect(after - before).toBeCloseTo(0.1, 6);
  });

  it('carries on the other way too', () => {
    const before = -Math.PI + 0.05;

    expect(unwrapAngle(before, Math.PI - 0.05) - before).toBeCloseTo(-0.1, 6);
  });

  it('keeps counting through turn after turn', () => {
    let angle = 0;

    // Ten full turns, in twelfths, read back as a wrapped angle each time.
    for (let step = 1; step <= 120; step += 1) {
      const wrapped = Math.atan2(
        Math.sin((step / 12) * Math.PI * 2),
        Math.cos((step / 12) * Math.PI * 2),
      );
      angle = unwrapAngle(angle, wrapped);
    }

    expect(angle).toBeCloseTo(Math.PI * 2 * 10, 6);
  });

  it('leaves an angle that has not moved alone', () => {
    expect(unwrapAngle(1.2, 1.2)).toBeCloseTo(1.2, 9);
  });
});

describe('smoothAngle', () => {
  // The sensor is noisy at rest, and an unsmoothed angle makes a settled pile
  // shiver.
  it('moves part of the way, not all of it', () => {
    expect(smoothAngle(0, 1, 0.25)).toBeCloseTo(0.25, 6);
  });

  it('converges on the reading rather than stopping short', () => {
    let angle = 0;

    for (let step = 0; step < 60; step += 1) {
      angle = smoothAngle(angle, 2);
    }

    expect(angle).toBeCloseTo(2, 6);
  });
});
