import { describe, expect, it } from 'vitest';

import {
  screenAngleFromOrientation,
  screenGravity,
  smoothAngle,
  TILT_FLAT,
  tiltStrength,
  unwrapAngle,
} from './tilt';

const degrees = (radians: number) => (radians * 180) / Math.PI;

describe('screenAngleFromOrientation', () => {
  // Held upright and facing you: beta about 90, gamma about 0, and the tube is
  // where it started.
  it('reads upright as no turn at all', () => {
    expect(screenAngleFromOrientation(90, 0)).toBeCloseTo(0, 6);
  });

  // Leaning the phone to the right dips its right edge, so down moves towards
  // that edge: beta falls towards 0 and gamma rises towards 90. Positive is
  // clockwise, which is the way canvas angles grow, so gravity swings towards
  // the edge that went down rather than the one that came up.
  //
  // This is the pair that was the wrong way round, and it took a phone to say
  // so: on screen the pieces slid uphill.
  it('sends gravity towards the edge that dips, not the one that rises', () => {
    expect(degrees(screenAngleFromOrientation(0, 90))).toBeCloseTo(90, 4);
  });

  it('reads a lean the other way as the opposite', () => {
    expect(degrees(screenAngleFromOrientation(0, -90))).toBeCloseTo(-90, 4);
  });

  it('reads the halfway points in between', () => {
    // Not 45: the two are Euler angles, not the sides of a triangle. Down in
    // the screen is (cos b sin g, sin b), which here is (0.5, 0.707).
    expect(degrees(screenAngleFromOrientation(45, 45))).toBeCloseTo(35.26, 2);
    expect(degrees(screenAngleFromOrientation(45, -45))).toBeCloseTo(-35.26, 2);
  });

  // The reported bug, and the reason the Euler angles cannot be used as a
  // vector. Tipping the phone away from you has no side to it, but it runs
  // `beta` down towards 0 while `gamma` stays near it — so a ratio of the two
  // swings the whole direction of gravity across to the side.
  it('leaves gravity alone when the phone is tipped away, not sideways', () => {
    for (const beta of [90, 75, 60, 45, 30, 20]) {
      expect(degrees(screenAngleFromOrientation(beta, 0)), `beta ${String(beta)}`).toBeCloseTo(
        0,
        6,
      );
    }
  });

  // And a hand is never exactly level, so a degree or two of roll must not turn
  // into a lurch as the phone comes down towards flat.
  it('does not magnify a hand’s wobble as the phone is laid down', () => {
    for (const beta of [90, 60, 40, 25]) {
      const wobble = Math.abs(degrees(screenAngleFromOrientation(beta, 3)));

      expect(wobble, `beta ${String(beta)}`).toBeLessThan(8);
    }
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

describe('screenGravity', () => {
  // Rolling the phone in its own plane keeps all of gravity on the screen and
  // simply turns it. This is the motion the whole feature is for.
  it('keeps its whole length as the phone is rolled', () => {
    for (let turn = 0; turn <= 80; turn += 10) {
      // A roll of `turn` degrees reads as beta 90 - turn with gamma at 90.
      const down = screenGravity(90 - turn, 90);

      expect(tiltStrength(down), `rolled ${String(turn)}`).toBeCloseTo(1, 6);
      expect(degrees(Math.atan2(down.x, down.y)), `rolled ${String(turn)}`).toBeCloseTo(turn, 4);
    }
  });

  // Laid flat, down goes through the glass and there is nothing of it left in
  // the plane of the screen to point at.
  it('has nothing left once the screen is horizontal', () => {
    expect(tiltStrength(screenGravity(0, 0))).toBeCloseTo(0, 6);
    expect(tiltStrength(screenGravity(0, 0))).toBeLessThan(TILT_FLAT);
    expect(tiltStrength(screenGravity(90, 0))).toBeCloseTo(1, 6);
  });

  it('loses it gradually as the phone is tipped away', () => {
    const held = tiltStrength(screenGravity(90, 0));
    const leaning = tiltStrength(screenGravity(45, 0));
    const nearlyFlat = tiltStrength(screenGravity(8, 0));

    expect(held).toBeGreaterThan(leaning);
    expect(leaning).toBeGreaterThan(nearlyFlat);
    expect(nearlyFlat).toBeLessThan(TILT_FLAT);
  });

  it('points straight down for a reading that is not one', () => {
    expect(screenGravity(Number.NaN, 0)).toEqual({ x: 0, y: 1 });
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
