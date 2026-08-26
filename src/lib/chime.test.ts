import { describe, expect, it } from 'vitest';

import { createChime, pitchOf, readImpacts, type Impact } from './chime';
import type { Shard } from './scene';
import { ROUND } from './shape';

function piece(radius: number, vx = 0, vy = 0): Shard {
  return {
    kind: 'bead',
    variant: 0,
    x: 0,
    y: 0,
    vx,
    vy,
    radius,
    shape: ROUND,
    rotation: 0,
    spin: 0,
    skin: { x: 0.5, y: 0.5 },
  };
}

describe('pitchOf', () => {
  it('rings small glass high and big glass low, within hearing', () => {
    expect(pitchOf(0.03)).toBeGreaterThan(pitchOf(0.08));
    expect(pitchOf(0.08)).toBeGreaterThan(pitchOf(0.2));
    expect(pitchOf(0.005)).toBeLessThanOrEqual(3800);
    expect(pitchOf(2)).toBeGreaterThanOrEqual(500);
  });
});

describe('createChime', () => {
  it('answers null where there is no audio to be had', () => {
    // jsdom has no AudioContext, which is exactly the case being tested.
    expect(createChime()).toBeNull();
  });
});

describe('readImpacts', () => {
  it('says nothing on the first frame, having nothing to compare against', () => {
    const glass = [piece(0.1, 1, 0)];
    const heard = { velocities: new Float32Array(0) };
    const impacts: Impact[] = [];

    readImpacts(glass, heard, impacts);

    expect(impacts).toHaveLength(0);
  });

  it('hears a sudden stop, and ignores a steady drift', () => {
    const hit = piece(0.1, 1.2, 0);
    const drifting = piece(0.1, 0.3, 0);
    const glass = [hit, drifting];
    const heard = { velocities: new Float32Array(0) };
    const impacts: Impact[] = [];

    readImpacts(glass, heard, impacts);

    // The hit piece stops dead; the drifting one barely changes.
    hit.vx = 0;
    drifting.vx = 0.299;

    readImpacts(glass, heard, impacts);

    expect(impacts).toHaveLength(1);
    expect(impacts[0]!.size).toBe(0.1);
    expect(impacts[0]!.strength).toBeGreaterThan(0);
  });

  it('reports the loudest first, and only as many as asked', () => {
    const glass = [piece(0.06, 0.5, 0), piece(0.12, 0.5, 0), piece(0.09, 0.5, 0)];
    const heard = { velocities: new Float32Array(0) };
    const impacts: Impact[] = [];

    readImpacts(glass, heard, impacts);

    for (const shard of glass) {
      shard.vx = 0;
    }

    readImpacts(glass, heard, impacts, 2);

    // Same jolt, so the biggest piece carries the most impulse.
    expect(impacts).toHaveLength(2);
    expect(impacts[0]!.size).toBe(0.12);
    expect(impacts[0]!.strength).toBeGreaterThanOrEqual(impacts[1]!.strength);
  });

  it('starts afresh when the glass is recut', () => {
    const heard = { velocities: new Float32Array(0) };
    const impacts: Impact[] = [];

    readImpacts([piece(0.1, 1, 0)], heard, impacts);

    // A different chamber: more pieces. No phantom clinks from comparing
    // against the old one's velocities.
    readImpacts([piece(0.1, 2, 0), piece(0.1, 2, 0)], heard, impacts);

    expect(impacts).toHaveLength(0);
  });
});
