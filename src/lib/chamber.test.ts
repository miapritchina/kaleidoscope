import { describe, expect, it } from 'vitest';

import { CHAMBER_RADIUS, settleChamber, updateChamber } from './chamber';
import { createScene, type Shard } from './scene';

function chips(count: number, radius = 0.1): Shard[] {
  return Array.from({ length: count }, (_, index) => ({
    kind: 'disc' as const,
    x: -0.6 + (index % 5) * 0.3,
    y: -0.6 + Math.floor(index / 5) * 0.3,
    vx: 0,
    vy: 0,
    radius,
    rotation: 0,
    spin: 0,
    colorStop: 0.5,
    alpha: 1,
  }));
}

const centre = (shards: Shard[]) => shards.reduce((sum, shard) => sum + shard.y, 0) / shards.length;

describe('updateChamber', () => {
  it('does nothing without time or chips', () => {
    const glass = chips(3);
    const before = glass.map((shard) => ({ ...shard }));

    updateChamber(glass, { dt: 0, tube: 0 });
    updateChamber([], { dt: 1, tube: 0 });

    expect(glass).toEqual(before);
  });

  it('drops the glass', () => {
    const glass = chips(1);
    const start = glass[0]!.y;

    updateChamber(glass, { dt: 0.1, tube: 0 });

    expect(glass[0]!.y).toBeGreaterThan(start);
  });

  it('keeps every chip inside the wall', () => {
    const glass = chips(20);

    for (let i = 0; i < 400; i += 1) {
      updateChamber(glass, { dt: 1 / 60, tube: i * 0.05 });
    }

    for (const shard of glass) {
      expect(Math.hypot(shard.x, shard.y)).toBeLessThanOrEqual(CHAMBER_RADIUS + 1e-9);
    }
  });

  it('stacks the chips rather than letting them interpenetrate', () => {
    const glass = chips(16, 0.12);

    settleChamber(glass);

    for (let i = 0; i < glass.length; i += 1) {
      for (let j = i + 1; j < glass.length; j += 1) {
        const a = glass[i]!;
        const b = glass[j]!;
        const gap = Math.hypot(b.x - a.x, b.y - a.y) - (a.radius + b.radius);

        // A little tolerance: the solver is iterative, not exact.
        expect(gap).toBeGreaterThan(-0.03);
      }
    }
  });

  // A pile resolved with impulses creeps forever, because gravity keeps feeding
  // in velocity the contacts never quite take out.
  it('comes to rest and stays there', () => {
    const glass = chips(16);

    settleChamber(glass);
    const settled = glass.map((shard) => ({ x: shard.x, y: shard.y }));

    for (let i = 0; i < 120; i += 1) {
      updateChamber(glass, { dt: 1 / 60, tube: 0 });
    }

    for (const [index, shard] of glass.entries()) {
      expect(Math.hypot(shard.x - settled[index]!.x, shard.y - settled[index]!.y)).toBeLessThan(
        0.01,
      );
    }
  });

  it('piles towards whichever way is down', () => {
    const upright = chips(16);
    const inverted = chips(16);

    settleChamber(upright, 0);
    settleChamber(inverted, Math.PI);

    expect(centre(upright)).toBeGreaterThan(0);
    expect(centre(inverted)).toBeLessThan(0);
  });

  it('piles sideways when the tube is a quarter turn over', () => {
    const glass = chips(16);

    settleChamber(glass, Math.PI / 2);

    const centreX = glass.reduce((sum, shard) => sum + shard.x, 0) / glass.length;
    expect(Math.abs(centreX)).toBeGreaterThan(Math.abs(centre(glass)));
  });

  // Turning tips the pile and it avalanches: the mechanism behind the pattern
  // changing at all.
  it('avalanches when the tube turns', () => {
    const glass = chips(20);

    settleChamber(glass);
    const settled = glass.map((shard) => ({ x: shard.x, y: shard.y }));

    let tube = 0;
    for (let i = 0; i < 120; i += 1) {
      tube += (Math.PI / 2) * (1 / 60);
      updateChamber(glass, { dt: 1 / 60, tube });
    }

    const moved = glass.filter(
      (shard, index) => Math.hypot(shard.x - settled[index]!.x, shard.y - settled[index]!.y) > 0.1,
    );

    expect(moved.length).toBeGreaterThan(glass.length / 3);
  });

  it('turns the glass as it slides', () => {
    const glass = chips(12);

    settleChamber(glass, Math.PI / 3);

    expect(glass.some((shard) => shard.rotation !== 0)).toBe(true);
  });

  it('copes with a chip larger than the chamber', () => {
    const glass = chips(1, CHAMBER_RADIUS * 2);

    updateChamber(glass, { dt: 0.1, tube: 0 });

    expect(Number.isFinite(glass[0]!.x)).toBe(true);
    expect(Number.isFinite(glass[0]!.y)).toBe(true);
  });
});

describe('settleChamber', () => {
  // A chamber still mid-avalanche on the first frame visibly rains down on load.
  it('leaves a generated scene at rest', () => {
    const scene = createScene('load', 24);

    expect(scene.shards.every((shard) => Math.hypot(shard.vx, shard.vy) < 0.25)).toBe(true);
  });

  it('returns as soon as the pile is at rest, rather than running the full cap', () => {
    const glass = chips(6);
    const started = performance.now();

    settleChamber(glass, 0, 600);

    // Six chips settle in well under a second of simulated time; if this waited
    // out the cap it would take far longer than a blink of real time.
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it('gives up rather than hanging on a chamber too full to settle', () => {
    // Packed past what the solver can resolve; it must still return.
    const glass = chips(25, 0.4);

    expect(() => {
      settleChamber(glass, 0, 1);
    }).not.toThrow();
  });
});
