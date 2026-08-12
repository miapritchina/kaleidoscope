import { describe, expect, it } from 'vitest';

import { CHAMBER_RADIUS, settleChamber, updateChamber } from './chamber';
import { createScene, type Shard } from './scene';

function chips(count: number, radius = 0.1): Shard[] {
  return Array.from({ length: count }, (_, index) => ({
    kind: 'bead' as const,
    variant: 0,
    x: -0.6 + (index % 5) * 0.3,
    y: -0.6 + Math.floor(index / 5) * 0.3,
    vx: 0,
    vy: 0,
    radius,
    rotation: 0,
    spin: 0,
    colorStop: 0.5,
    skin: { x: 0.5, y: 0.5 },
  }));
}

const centre = (shards: Shard[]) => shards.reduce((sum, shard) => sum + shard.y, 0) / shards.length;

describe('updateChamber', () => {
  it('does nothing without time or chips', () => {
    const glass = chips(3);
    const before = glass.map((shard) => ({ ...shard }));

    updateChamber(glass, { dt: 0, angle: 0 });
    updateChamber([], { dt: 1, angle: 0 });

    expect(glass).toEqual(before);
  });

  it('drops the glass', () => {
    const glass = chips(1);
    const start = glass[0]!.y;

    updateChamber(glass, { dt: 0.1, angle: 0 });

    expect(glass[0]!.y).toBeGreaterThan(start);
  });

  it('keeps every chip inside the wall', () => {
    const glass = chips(20);

    for (let i = 0; i < 400; i += 1) {
      updateChamber(glass, { dt: 1 / 60, angle: i * 0.05 });
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
      updateChamber(glass, { dt: 1 / 60, angle: 0 });
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

  it('piles sideways when the cell is a quarter turn over', () => {
    const glass = chips(16);

    settleChamber(glass, Math.PI / 2);

    const centreX = glass.reduce((sum, shard) => sum + shard.x, 0) / glass.length;
    expect(Math.abs(centreX)).toBeGreaterThan(Math.abs(centre(glass)));
  });

  // The one that matters, and the one a test of the chamber alone cannot see:
  // the renderer draws the cell rotated by its own angle, so "down" in the cell
  // has to come out down on the screen whatever that angle is.
  // Signed the other way it sweeps round at twice the turn rate — a quarter
  // turn puts the pile at the top of the screen — and the whole mechanism reads
  // as no gravity at all.
  it('leaves the pile at the bottom of the screen however far the cell is turned', () => {
    for (let step = 0; step < 12; step += 1) {
      const angle = (step / 12) * Math.PI * 2;
      const glass = chips(16);

      settleChamber(glass, angle);

      const x = glass.reduce((sum, shard) => sum + shard.x, 0) / glass.length;
      const y = centre(glass);
      // Into screen space: the same rotation the renderer applies to the field.
      const screenY = x * Math.sin(angle) + y * Math.cos(angle);
      const screenX = x * Math.cos(angle) - y * Math.sin(angle);

      expect(
        screenY,
        `cell at ${String(Math.round((angle * 180) / Math.PI))} degrees`,
      ).toBeGreaterThan(Math.abs(screenX));
    }
  });

  // Turning tips the pile and it avalanches: the mechanism behind the pattern
  // changing at all.
  it('avalanches when the cell turns', () => {
    const glass = chips(20);

    settleChamber(glass);
    const settled = glass.map((shard) => ({ x: shard.x, y: shard.y }));

    let angle = 0;
    for (let i = 0; i < 120; i += 1) {
      angle += (Math.PI / 2) * (1 / 60);
      updateChamber(glass, { dt: 1 / 60, angle: angle });
    }

    const moved = glass.filter(
      (shard, index) => Math.hypot(shard.x - settled[index]!.x, shard.y - settled[index]!.y) > 0.1,
    );

    expect(moved.length).toBeGreaterThan(glass.length / 3);
  });

  // A chip sliding along the wall rolls, the way a wheel does: travelling one
  // way turns it one way. Sliding flat instead is what gave the old pile its
  // lifeless look.
  it('sets a chip sliding along the wall rolling the way it travels', () => {
    const rightwards = chips(1);
    const leftwards = chips(1);

    for (const [glass, direction] of [
      [rightwards, 1],
      [leftwards, -1],
    ] as const) {
      const chip = glass[0]!;
      chip.x = 0;
      // Resting on the floor of the chamber, moving along it.
      chip.y = CHAMBER_RADIUS - chip.radius;
      chip.vx = direction;

      for (let i = 0; i < 10; i += 1) {
        updateChamber(glass, { dt: 1 / 60, angle: 0 });
      }
    }

    expect(rightwards[0]!.spin).toBeGreaterThan(1);
    expect(leftwards[0]!.spin).toBeLessThan(-1);
  });

  // Both the same way, not opposite ways: one chip dragged across another is a
  // conveyor, not a pair of meshed gears.
  it('spins both pieces when one slides across the other', () => {
    const glass = chips(2);
    const [a, b] = glass as [Shard, Shard];

    a.x = 0;
    a.y = 0;
    b.x = 0;
    b.y = a.radius + b.radius;
    b.vx = 1;

    updateChamber(glass, { dt: 1 / 60, angle: 0 });

    expect(a.spin).toBeLessThan(0);
    expect(b.spin).toBeLessThan(0);
  });

  it('drags the piece underneath along rather than sliding over it', () => {
    const glass = chips(2);
    const [a, b] = glass as [Shard, Shard];

    a.x = 0;
    a.y = 0;
    b.x = 0;
    b.y = a.radius + b.radius;
    b.vx = 1;

    updateChamber(glass, { dt: 1 / 60, angle: 0 });

    expect(a.vx).toBeGreaterThan(0);
    expect(b.vx).toBeLessThan(1);
  });

  it('tumbles the glass as the pile avalanches', () => {
    const glass = chips(20);

    settleChamber(glass);
    const before = glass.map((shard) => shard.rotation);

    let angle = 0;
    for (let i = 0; i < 120; i += 1) {
      angle += Math.PI / 2 / 60;
      updateChamber(glass, { dt: 1 / 60, angle: angle });
    }

    const turned = glass.filter((shard, index) => Math.abs(shard.rotation - before[index]!) > 0.2);

    expect(turned.length).toBeGreaterThan(glass.length / 2);
  });

  it('damps a chip spinning on its own, so nothing twirls forever', () => {
    const glass = chips(1);
    const chip = glass[0]!;

    // In the air, clear of the wall, so only the damping acts on it.
    chip.x = 0;
    chip.y = -0.5;
    chip.spin = 8;

    for (let i = 0; i < 30; i += 1) {
      updateChamber(glass, { dt: 1 / 60, angle: 0 });
    }

    expect(chip.spin).toBeGreaterThan(0);
    expect(chip.spin).toBeLessThan(3);
  });

  it('stops the glass turning once the pile has settled', () => {
    const glass = chips(16);

    settleChamber(glass);

    for (const shard of glass) {
      expect(shard.spin).toBe(0);
    }
  });

  it('copes with a chip larger than the chamber', () => {
    const glass = chips(1, CHAMBER_RADIUS * 2);

    updateChamber(glass, { dt: 0.1, angle: 0 });

    expect(Number.isFinite(glass[0]!.x)).toBe(true);
    expect(Number.isFinite(glass[0]!.y)).toBe(true);
  });
});

describe('weight', () => {
  // A splinter that lands on a bead is the one that moves. Splitting the push
  // evenly shoves the bead just as far, and a chamber of mixed sizes behaves as
  // though every piece weighed the same — which is what reads most plainly as
  // "not glass". Mass goes with area, so twice across is four times as hard to
  // shift.
  it('gives the push to the lighter piece', () => {
    const big: Shard = { ...chips(1, 0.3)[0]!, x: 0, y: 0 };
    const small: Shard = { ...chips(1, 0.1)[0]!, x: 0.32, y: 0 };

    updateChamber([big, small], { dt: 1 / 60, angle: 0 });

    const bigMoved = Math.abs(big.x);
    const smallMoved = Math.abs(small.x - 0.32);

    expect(smallMoved).toBeGreaterThan(0);
    // Nine times, for a piece three times across. Loosely, since a substep of
    // gravity moves both of them as well.
    expect(smallMoved / bigMoved).toBeGreaterThan(5);
  });

  // Pushing two pieces apart is something they do to each other, so it cannot
  // move the pair as a whole. Weighting it by anything other than mass is what
  // breaks that: the pieces would drift off in the direction of whichever
  // happened to be favoured, one contact at a time.
  it('moves the two apart without moving the pair', () => {
    const big: Shard = { ...chips(1, 0.3)[0]!, x: -0.05, y: 0 };
    const small: Shard = { ...chips(1, 0.1)[0]!, x: 0.3, y: 0 };
    const weigh = () =>
      (big.x * big.radius ** 2 + small.x * small.radius ** 2) /
      (big.radius ** 2 + small.radius ** 2);
    const before = weigh();

    // Gravity is along y at this angle, so anything that moves the pair
    // sideways came from the contact.
    updateChamber([big, small], { dt: 1 / 60, angle: 0 });

    expect(weigh()).toBeCloseTo(before, 6);
  });
});

describe('friction', () => {
  /** How far the pile has moved from where it started, per piece. */
  const travelled = (before: Shard[], after: Shard[]) =>
    after.reduce(
      (sum, shard, index) =>
        sum + Math.hypot(shard.x - before[index]!.x, shard.y - before[index]!.y),
      0,
    ) / after.length;

  // The point of holding a contact against sliding: a heap stands at a slope.
  // Resolving only the overlap leaves the glass free to slide across whatever
  // it rests on, so a pile spreads until it is flat and the least tip sets the
  // whole thing flowing — a chamber of liquid rather than one of glass.
  it('holds a pile through a small tip and lets it go past a steep one', () => {
    const settled = chips(16, 0.12);
    settleChamber(settled, 0, 20);

    const nudged = settled.map((shard) => ({ ...shard }));
    const tipped = settled.map((shard) => ({ ...shard }));

    for (let frame = 0; frame < 120; frame += 1) {
      updateChamber(nudged, { dt: 1 / 60, angle: (5 * Math.PI) / 180 });
      updateChamber(tipped, { dt: 1 / 60, angle: (50 * Math.PI) / 180 });
    }

    const held = travelled(settled, nudged);
    const slid = travelled(settled, tipped);

    expect(held).toBeLessThan(0.05);
    expect(slid).toBeGreaterThan(held * 4);
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
