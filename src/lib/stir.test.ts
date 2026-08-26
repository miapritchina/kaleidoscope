import { describe, expect, it } from 'vitest';

import { CHAMBER_RADIUS } from './chamber';
import { trackStir } from './stir';

describe('trackStir', () => {
  it('has a position and no velocity on the first frame of a touch', () => {
    const tracker = { last: null };

    expect(trackStir(tracker, { x: 0.1, y: 0 }, 0, 1 / 60)).toBeNull();

    const sample = trackStir(tracker, { x: 0.2, y: 0 }, 0, 1 / 60);

    expect(sample).not.toBeNull();
    expect(sample!.vx).toBeGreaterThan(0);
    expect(sample!.vy).toBe(0);
  });

  it('treats a seam crossing as a fresh touch rather than a thunderclap', () => {
    const tracker = { last: null };

    trackStir(tracker, { x: -0.5, y: 0 }, 0, 1 / 60);

    // The fold is discontinuous at a mirror: the point lands far away in one
    // frame. On screen that was continuous; as a velocity it would be huge.
    expect(trackStir(tracker, { x: 0.5, y: 0 }, 0, 1 / 60)).toBeNull();
  });

  it('caps the speed a flick can claim', () => {
    const tracker = { last: null };

    trackStir(tracker, { x: 0, y: 0 }, 0, 1 / 60);

    const sample = trackStir(tracker, { x: 0.3, y: 0 }, 0, 1 / 60);

    expect(sample).not.toBeNull();
    expect(Math.hypot(sample!.vx, sample!.vy)).toBeLessThanOrEqual(CHAMBER_RADIUS * 2 + 1e-9);
  });

  // The reason the tracking happens in the body's frame at all. A finger
  // resting on the glass of a tube being turned under it has not stirred
  // anything; differenced after the bearing had been divided out, it reported
  // more stir than the wax can manage on its own, pointed against the turn,
  // everywhere at once, for as long as it was held.
  it('stirs nothing at all while the finger is still and the chamber turns', () => {
    const tracker = { last: null as { x: number; y: number } | null };
    // One point in the body's frame, which is where a still finger stays.
    const held = { x: 0.42, y: -0.31 };

    trackStir(tracker, held, 0, 1 / 60);

    for (const bearing of [0.1, 0.2, 0.3]) {
      const sample = trackStir(tracker, held, bearing, 1 / 60);

      expect(sample).not.toBeNull();
      expect(Math.hypot(sample!.vx, sample!.vy)).toBeCloseTo(0, 10);
    }
  });

  it('reads a moving finger the same however far the chamber has turned', () => {
    // The same movement of the same finger is the same stir, said in whatever
    // frame the chamber happens to be in — so its size cannot depend on the
    // bearing, and its direction has to turn with the chamber exactly.
    const from = { x: 0.42, y: -0.31 };
    const to = { x: 0.52, y: -0.31 };
    const speeds: number[] = [];

    for (const bearing of [0, 1, 2.5, -0.7]) {
      const tracker = { last: null as { x: number; y: number } | null };

      trackStir(tracker, from, bearing, 1 / 60);

      const sample = trackStir(tracker, to, bearing, 1 / 60);

      expect(sample).not.toBeNull();
      speeds.push(Math.hypot(sample!.vx, sample!.vy));
    }

    for (const speed of speeds) {
      expect(speed).toBeCloseTo(speeds[0]!, 10);
    }
  });

  // And the direction does turn with it: the same movement read at a quarter
  // turn comes back rotated by a quarter turn, which is what puts the stir
  // under the finger rather than a quarter of the cell away from it.
  it("turns the reading into the chamber's frame", () => {
    const tracker = { last: null as { x: number; y: number } | null };

    // Slow enough not to meet the cap, so this is about direction alone.
    trackStir(tracker, { x: 0, y: 0 }, Math.PI / 2, 1 / 60);

    const sample = trackStir(tracker, { x: 0.02, y: 0 }, Math.PI / 2, 1 / 60);

    expect(sample).not.toBeNull();
    expect(sample!.vx).toBeCloseTo(0, 6);
    expect(sample!.vy).toBeCloseTo(-1.2, 6);
  });
});
