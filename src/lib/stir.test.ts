import { describe, expect, it } from 'vitest';

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

  it('stirs nothing at all while the finger is still and the cell turns', () => {
    const tracker = { last: null };
    const point = { x: 620, y: 470 };
    const turning = (cell: number) => view({ cell });

    trackStir(tracker, heldPoint(point, turning(0)), 0, 1 / 60);

    // A brisk turn, and a finger that has not moved a pixel. It is resting on
    // the glass of a tube that is being turned under it, which is no stir.
    for (const cell of [0.1, 0.2, 0.3]) {
      const sample = trackStir(tracker, heldPoint(point, turning(cell)), cell, 1 / 60);

      expect(sample).not.toBeNull();
      expect(Math.hypot(sample!.vx, sample!.vy)).toBeCloseTo(0, 10);
    }
  });

  it('reads a moving finger the same however far the cell has turned', () => {
    // The same movement of the same finger is the same stir, said in whatever
    // frame the cell happens to be in — so its size cannot depend on the turn,
    // and its direction has to turn with the cell exactly.
    const from = { x: 620, y: 470 };
    const to = { x: 660, y: 470 };
    const speeds: number[] = [];

    for (const cell of [0, 1, 2.5, -0.7]) {
      const tracker = { last: null as { x: number; y: number } | null };

      trackStir(tracker, heldPoint(from, view({ cell })), cell, 1 / 60);

      const sample = trackStir(tracker, heldPoint(to, view({ cell })), cell, 1 / 60);

      expect(sample).not.toBeNull();
      speeds.push(Math.hypot(sample!.vx, sample!.vy));
    }

    for (const speed of speeds) {
      expect(speed).toBeCloseTo(speeds[0]!, 10);
    }
  });
});
