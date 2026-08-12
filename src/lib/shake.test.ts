import { describe, expect, it } from 'vitest';

import { createShakeDetector, motionOf, type Motion } from './shake';

/** A hand holding the phone still: gravity, and nothing else. */
const STILL: Motion = { x: 0, y: -9.8, z: 0 };

/** Feeds a run of readings and counts the shakes noticed. */
function run(detector: ReturnType<typeof createShakeDetector>, readings: [Motion, number][]) {
  return readings.filter(([motion, at]) => detector.push(motion, at)).length;
}

/** A waggle: `count` reversals of the same size, `every` milliseconds apart. */
function waggle(size: number, count: number, from = 0, every = 60): [Motion, number][] {
  return Array.from({ length: count }, (_, step) => [
    { x: 0, y: -9.8 + (step % 2 === 0 ? size : -size), z: 0 },
    from + step * every,
  ]);
}

describe('createShakeDetector', () => {
  it('says nothing about the first reading, having nothing to compare it to', () => {
    expect(createShakeDetector().push(STILL, 0)).toBe(false);
  });

  it('ignores a phone being held', () => {
    const detector = createShakeDetector();

    // A hand is never quite still, and the reading includes gravity.
    const held: [Motion, number][] = Array.from({ length: 60 }, (_, step) => [
      { x: Math.sin(step / 4) * 0.4, y: -9.8 + Math.cos(step / 3) * 0.5, z: 0.2 },
      step * 60,
    ]);

    expect(run(detector, held)).toBe(0);
  });

  // One knock is a phone being set down on a table, which is not an
  // instruction. It is two jolts, not one — into the table and out of it.
  it('ignores a single knock', () => {
    const detector = createShakeDetector();
    const knock: [Motion, number][] = [
      [STILL, 0],
      [STILL, 60],
      [{ x: 0, y: -9.8 + 25, z: 0 }, 120],
      [STILL, 180],
      [STILL, 240],
      [STILL, 300],
    ];

    expect(run(detector, knock)).toBe(0);
  });

  it('notices a shake', () => {
    const detector = createShakeDetector();

    expect(run(detector, waggle(20, 8))).toBe(1);
  });

  // A hand does not stop cleanly, so without a rest one waggle reseeds the
  // chamber a dozen times over and the figure never settles long enough to see.
  it('counts a long shake once', () => {
    const detector = createShakeDetector();

    expect(run(detector, waggle(20, 20))).toBe(1);
  });

  it('takes a second shake after the hand has stopped', () => {
    const detector = createShakeDetector();
    const quiet: [Motion, number][] = Array.from({ length: 30 }, (_, step) => [
      STILL,
      600 + step * 60,
    ]);

    expect(run(detector, [...waggle(20, 8), ...quiet, ...waggle(20, 8, 2600)])).toBe(2);
  });

  // Jolts spread out are a phone in a pocket on a walk, not a shake.
  it('wants the jolts close together', () => {
    const detector = createShakeDetector();
    const occasional = Array.from({ length: 6 }, (_, step) => waggle(20, 2, step * 1500)).flat();

    expect(run(detector, occasional)).toBe(0);
  });

  it('gives a number for readings that are not ones', () => {
    const detector = createShakeDetector();

    detector.push(STILL, 0);

    expect(detector.push({ x: 0, y: 40, z: 0 }, Number.NaN)).toBe(false);
  });
});

describe('motionOf', () => {
  const event = (reading: unknown, withGravity: unknown = null) =>
    ({ acceleration: reading, accelerationIncludingGravity: withGravity }) as DeviceMotionEvent;

  it('prefers the reading with gravity taken out', () => {
    expect(motionOf(event({ x: 1, y: 2, z: 3 }, { x: 9, y: 9, z: 9 }))).toEqual({
      x: 1,
      y: 2,
      z: 3,
    });
  });

  // Plenty of devices only ever populate the other one. Either works, since what
  // is measured is the change between samples and a constant drops out of that.
  it('falls back to the one that still has gravity in it', () => {
    expect(motionOf(event(null, { x: 0, y: -9.8, z: 0 }))).toEqual({ x: 0, y: -9.8, z: 0 });
  });

  it('gives nothing for an event carrying no numbers', () => {
    expect(motionOf(event(null, null))).toBeNull();
    expect(motionOf(event({ x: null, y: null, z: null }))).toBeNull();
  });
});
