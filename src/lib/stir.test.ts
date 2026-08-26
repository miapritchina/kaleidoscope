import { describe, expect, it } from 'vitest';

import { CHAMBER_RADIUS } from './chamber';
import { triangleSideFor } from './renderer';
import { stirPoint, trackStir, type StirView } from './stir';

const view = (over: Partial<StirView> = {}): StirView => ({
  width: 1000,
  height: 1000,
  zoom: 1,
  angleDegrees: 0,
  cell: 0,
  drag: { x: 0, y: 0 },
  ...over,
});

describe('stirPoint', () => {
  it('maps the middle of the stage to the middle of the cell', () => {
    const at = stirPoint({ x: 500, y: 500 }, view());

    expect(Math.hypot(at.x, at.y)).toBeLessThan(0.01);
  });

  // Zero on the mirror-angle slider carries a sixty-degree upright turn (see
  // frameworkRadians), so these hold the framework at a true zero to test the
  // scale and the cell turn on their own.
  it('maps an offset to cell units through the triangle scale', () => {
    const side = triangleSideFor(1000, 1000, 1);
    const cellScale = side / Math.sqrt(3) / CHAMBER_RADIUS;
    const at = stirPoint({ x: 500 + cellScale * 0.5, y: 500 }, view({ angleDegrees: -60 }));

    expect(at.x).toBeCloseTo(0.5, 1);
    expect(at.y).toBeCloseTo(0, 1);
  });

  it('turns with the cell, so the stir lands where the fluid is', () => {
    const side = triangleSideFor(1000, 1000, 1);
    const cellScale = side / Math.sqrt(3) / CHAMBER_RADIUS;
    const at = stirPoint(
      { x: 500 + cellScale * 0.5, y: 500 },
      view({ angleDegrees: -60, cell: Math.PI / 2 }),
    );

    expect(at.x).toBeCloseTo(0, 1);
    expect(at.y).toBeCloseTo(-0.5, 1);
  });

  it('folds a finger far out on the field back into the cell', () => {
    // Anywhere on the stage: the point is over some reflection of the cell,
    // and the fold carries it home. Never outside the wall.
    for (const point of [
      { x: 30, y: 40 },
      { x: 950, y: 100 },
      { x: 80, y: 900 },
      { x: 990, y: 990 },
    ]) {
      const at = stirPoint(point, view());

      expect(Math.hypot(at.x, at.y)).toBeLessThanOrEqual(CHAMBER_RADIUS + 1e-6);
    }
  });
});

describe('trackStir', () => {
  it('has a position and no velocity on the first frame of a touch', () => {
    const tracker = { last: null };

    expect(trackStir(tracker, { x: 0.1, y: 0 }, 1 / 60)).toBeNull();

    const sample = trackStir(tracker, { x: 0.2, y: 0 }, 1 / 60);

    expect(sample).not.toBeNull();
    expect(sample!.vx).toBeGreaterThan(0);
    expect(sample!.vy).toBe(0);
  });

  it('treats a seam crossing as a fresh touch rather than a thunderclap', () => {
    const tracker = { last: null };

    trackStir(tracker, { x: -0.5, y: 0 }, 1 / 60);

    // The fold is discontinuous at a mirror: the point lands far away in one
    // frame. On screen that was continuous; as a velocity it would be huge.
    expect(trackStir(tracker, { x: 0.5, y: 0 }, 1 / 60)).toBeNull();
  });

  it('caps the speed a flick can claim', () => {
    const tracker = { last: null };

    trackStir(tracker, { x: 0, y: 0 }, 1 / 60);

    const sample = trackStir(tracker, { x: 0.3, y: 0 }, 1 / 60);

    expect(sample).not.toBeNull();
    expect(Math.hypot(sample!.vx, sample!.vy)).toBeLessThanOrEqual(5 + 1e-9);
  });
});
