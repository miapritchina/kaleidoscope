import { beforeAll, describe, expect, it } from 'vitest';

import { CHAMBER_RADIUS } from './chamber';
import { liquidCell, updateChamber } from './physics';
import { dropWorld, initRapier, updateChamberRapier } from './physicsRapier';
import type { Shard } from './scene';
import { ROUND, shapeOf } from './shape';
import { adoptRapierChamber, chamberOverride, dropChamberOverride } from './solver';

/**
 * The Rapier spike, held to the same behaviour the classic solver is tested
 * for: glass falls, stays inside the wall, stacks rather than
 * interpenetrating, and a pile holds through a small tip and avalanches past
 * a steep one. The numbers the two solvers are *measured* against each other
 * on live in RESEARCH.md; these tests only say the spike is a chamber at all.
 */

function chips(count: number, radius = 0.1): Shard[] {
  return Array.from({ length: count }, (_, index) => ({
    kind: 'bead' as const,
    variant: 0,
    x: -0.6 + (index % 5) * 0.3,
    y: -0.6 + Math.floor(index / 5) * 0.3,
    vx: 0,
    vy: 0,
    radius,
    shape: ROUND,
    rotation: 0,
    spin: 0,
    skin: { x: 0.5, y: 0.5 },
  }));
}

function settle(glass: Shard[], seconds = 8, angle = 0): void {
  for (let frame = 0; frame < seconds * 60; frame += 1) {
    updateChamberRapier(glass, { dt: 1 / 60, angle });
  }
}

beforeAll(async () => {
  await initRapier();
});

describe('updateChamberRapier', () => {
  it('does nothing without time or chips', () => {
    const glass = chips(3);
    const before = glass.map((shard) => ({ ...shard }));

    updateChamberRapier(glass, { dt: 0, angle: 0 });
    updateChamberRapier([], { dt: 1, angle: 0 });

    expect(glass).toEqual(before);
  });

  it('drops the glass', () => {
    const glass = chips(1);
    const start = glass[0]!.y;

    updateChamberRapier(glass, { dt: 0.1, angle: 0 });

    expect(glass[0]!.y).toBeGreaterThan(start);
  });

  it('keeps every chip inside the wall while the cell turns', () => {
    const glass = chips(20);

    for (let i = 0; i < 400; i += 1) {
      updateChamberRapier(glass, { dt: 1 / 60, angle: i * 0.05 });
    }

    for (const shard of glass) {
      expect(Math.hypot(shard.x, shard.y)).toBeLessThanOrEqual(CHAMBER_RADIUS + 0.01);
    }
  });

  it('stacks the chips rather than letting them interpenetrate', () => {
    const glass = chips(16, 0.12);

    settle(glass);

    for (let i = 0; i < glass.length; i += 1) {
      for (let j = i + 1; j < glass.length; j += 1) {
        const a = glass[i]!;
        const b = glass[j]!;
        const gap = Math.hypot(b.x - a.x, b.y - a.y) - (a.radius + b.radius);

        expect(gap).toBeGreaterThan(-0.03);
      }
    }
  });

  it('settles the pile at the bottom of the cell', () => {
    const glass = chips(12);

    settle(glass);

    const centre = glass.reduce((sum, shard) => sum + shard.y, 0) / glass.length;

    // Down at angle 0 is +y. The pile's centre ends in the lower half.
    expect(centre).toBeGreaterThan(0.1);
  });

  it('holds a pile through a small tip and lets it go past a steep one', () => {
    const settled = chips(16, 0.12);

    settle(settled, 12);

    const travelled = (before: Shard[], after: Shard[]) =>
      after.reduce(
        (sum, shard, index) =>
          sum + Math.hypot(shard.x - before[index]!.x, shard.y - before[index]!.y),
        0,
      ) / after.length;

    const nudged = settled.map((shard) => ({ ...shard }));
    const tipped = settled.map((shard) => ({ ...shard }));

    for (let frame = 0; frame < 120; frame += 1) {
      updateChamberRapier(nudged, { dt: 1 / 60, angle: (5 * Math.PI) / 180 });
    }

    for (let frame = 0; frame < 120; frame += 1) {
      updateChamberRapier(tipped, { dt: 1 / 60, angle: (50 * Math.PI) / 180 });
    }

    const held = travelled(settled, nudged);
    const slid = travelled(settled, tipped);

    expect(held).toBeLessThan(0.08);
    expect(slid).toBeGreaterThan(held * 3);
  });

  it('collides a traced sliver as its hull', () => {
    // A four-to-one splinter with its own outline: the hull is carried on the
    // shape, and a chamber of them still settles inside the wall without the
    // pieces crossing through each other end to end.
    const outline = [
      { x: -1, y: -0.22 },
      { x: 0, y: -0.26 },
      { x: 1, y: -0.2 },
      { x: 1, y: 0.22 },
      { x: 0, y: 0.27 },
      { x: -1, y: 0.24 },
    ];
    const sliver = shapeOf({ x: 1, y: 0.25 }, 0.9, outline);

    expect(sliver.hull).toBeDefined();
    expect(sliver.hull!.length).toBeGreaterThanOrEqual(4);

    const glass = chips(10, 0.16).map((shard) => ({ ...shard, shape: sliver }));

    settle(glass, 10);

    for (const shard of glass) {
      expect(Math.hypot(shard.x, shard.y)).toBeLessThanOrEqual(CHAMBER_RADIUS + 0.01);
    }

    // Two slivers lying across each other would put their middles nearer than
    // a sliver's own thickness; a hull that collides keeps them apart.
    for (let i = 0; i < glass.length; i += 1) {
      for (let j = i + 1; j < glass.length; j += 1) {
        const a = glass[i]!;
        const b = glass[j]!;

        expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThan(a.radius * 0.2);
      }
    }
  });

  it('suspends the glass in a liquid rather than dropping it', () => {
    const oil = liquidCell(0.35);
    const dry = chips(1);
    const wet = chips(1);

    dry[0]!.x = wet[0]!.x = 0;
    dry[0]!.y = wet[0]!.y = -0.9;

    const sink = (glass: Shard[], medium: ReturnType<typeof liquidCell> | null): number => {
      for (let frame = 0; frame < 60 * 30; frame += 1) {
        updateChamberRapier(
          glass,
          medium ? { dt: 1 / 60, angle: 0, medium } : { dt: 1 / 60, angle: 0 },
        );

        if (glass[0]!.y > 0.8) {
          return frame / 60;
        }
      }

      return Infinity;
    };

    const fell = sink(dry, null);
    const sank = sink(wet, oil);

    expect(fell).toBeLessThan(3);
    expect(sank).toBeGreaterThan(fell * 2);
  });
});

describe('the solver seam', () => {
  it('installs the spike as the chamber override, and lets it go again', async () => {
    expect(chamberOverride()).toBeNull();

    const adopted = await adoptRapierChamber();

    expect(adopted).toBe(true);
    expect(chamberOverride()).toBe(updateChamberRapier);

    dropChamberOverride();
    expect(chamberOverride()).toBeNull();
  });
});

describe('measured against the classic solver', () => {
  // Not a benchmark that can fail the suite on a slow machine — the numbers
  // worth keeping are measured deliberately and recorded in RESEARCH.md. This
  // only reports, and holds the spike to an obviously-broken ceiling.
  it('advances a full cell at a survivable cost', () => {
    const count = 150;
    const frames = 240;

    const classicGlass = chips(count, 0.07);
    const rapierGlass = chips(count, 0.07);

    let start = performance.now();

    for (let frame = 0; frame < frames; frame += 1) {
      updateChamber(classicGlass, { dt: 1 / 60, angle: frame * 0.01 });
    }

    const classicMs = (performance.now() - start) / frames;

    start = performance.now();

    for (let frame = 0; frame < frames; frame += 1) {
      updateChamberRapier(rapierGlass, { dt: 1 / 60, angle: frame * 0.01 });
    }

    const rapierMs = (performance.now() - start) / frames;

    console.info(
      `chamber at ${count} pieces: classic ${classicMs.toFixed(3)} ms/frame, ` +
        `rapier ${rapierMs.toFixed(3)} ms/frame`,
    );

    expect(rapierMs).toBeLessThan(25);

    dropWorld();
  });
});
