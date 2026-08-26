import { describe, expect, it } from 'vitest';

import { CHAMBER_RADIUS } from './chamber';
import {
  advanceFlow,
  AIR,
  FRESH_LIQUID,
  liquidCell,
  settleChamber,
  updateChamber,
  type Medium,
} from './physics';
import { createScene, type Shard } from './scene';
import { ROUND, shapeOf } from './shape';

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
      // Resting at the bottom of the wall, moving along it.
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

    // In the middle, clear of every wall, so only the damping acts on it.
    chip.x = 0;
    chip.y = 0;
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

describe('shape', () => {
  /** A splinter: five or six times as long as it is wide. */
  const sliver = shapeOf({ x: 1, y: 0.18 }, Math.PI * 0.18);

  /** Mean gap between neighbouring pieces, as a share of a piece's own width. */
  const airBetween = (glass: Shard[]) => {
    const gaps: number[] = [];

    for (let i = 0; i < glass.length; i += 1) {
      const a = glass[i]!;
      let nearest = Infinity;

      for (let j = 0; j < glass.length; j += 1) {
        if (i !== j) {
          const b = glass[j]!;
          nearest = Math.min(nearest, Math.hypot(b.x - a.x, b.y - a.y));
        }
      }

      gaps.push(nearest / (a.radius * 2));
    }

    return gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
  };

  // A sliver cut out of a photograph fills a fraction of the circle it was cut
  // to. Collide with the circle and it holds everything a sliver's length away
  // in every direction: the pile settles full of air, and pieces come to rest
  // on nothing at all.
  it('packs cut-out slivers close instead of leaving air around them', () => {
    const asCircles = chips(18, 0.16);
    const asGlass = chips(18, 0.16).map((shard) => ({ ...shard, shape: sliver }));

    settleChamber(asCircles, 0, 20);
    settleChamber(asGlass, 0, 20);

    expect(airBetween(asGlass)).toBeLessThan(airBetween(asCircles) * 0.7);
  });

  // The whole point of a chain rather than one circle: a sliver on its end and
  // a sliver lying flat are different obstacles. One circle is the same in
  // every direction and cannot tell the two apart.
  it('knows the difference between a piece end-on and side-on', () => {
    const along = pairAcross(0);
    const across = pairAcross(Math.PI / 2);

    // Set beside the splinter's length the two touch and push apart; set beside
    // its width, at the same distance, they are nowhere near each other.
    expect(Math.abs(along[1]!.x - along[0]!.x)).toBeGreaterThan(0.33);
    expect(Math.abs(across[1]!.x - across[0]!.x)).toBeCloseTo(0.32, 3);
  });

  /** A splinter and a bead set 0.32 apart, with the splinter turned. */
  function pairAcross(turn: number): Shard[] {
    const splinter: Shard = { ...chips(1, 0.25)[0]!, shape: sliver, x: 0, y: 0, rotation: turn };
    const bead: Shard = { ...chips(1, 0.12)[0]!, x: 0.32, y: 0 };
    const glass = [splinter, bead];

    for (let frame = 0; frame < 10; frame += 1) {
      // Weightless, so the only thing that can move them is each other.
      updateChamber(glass, { dt: 1 / 240, angle: 0 });
    }

    return glass;
  }

  // A long piece has its mass out at the ends, so a contact away from its
  // middle turns it. Standing one on end and letting go should lay it down;
  // with one circle per piece there is no such thing as an end.
  it('lays a splinter down instead of leaving it standing on end', () => {
    const upright: Shard = {
      ...chips(1, 0.3)[0]!,
      shape: sliver,
      x: 0,
      y: 0,
      // A hair off vertical, since a rod balanced exactly upright has no reason
      // to fall either way.
      rotation: Math.PI / 2 - 0.25,
    };

    settleChamber([upright], 0, 20);

    // Its long axis runs along `rotation`; flat means that is across the floor.
    expect(Math.abs(Math.sin(upright.rotation))).toBeLessThan(0.5);
  });

  it('still keeps them inside the wall, and out of each other', () => {
    const glass = chips(18, 0.16).map((shard) => ({ ...shard, shape: sliver }));

    settleChamber(glass, 0, 20);

    for (const shard of glass) {
      expect(Math.hypot(shard.x, shard.y)).toBeLessThanOrEqual(CHAMBER_RADIUS + 1e-6);
    }
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

describe('the liquid cell', () => {
  const OIL = liquidCell(0.35);

  /** How long a lone piece takes to fall from the top of the cell to the floor. */
  function fall(medium: Medium): number {
    const glass = chips(1);
    const [piece] = glass as [Shard];

    piece.x = 0;
    piece.y = -0.9;

    for (let frame = 0; frame < 60 * 60; frame += 1) {
      updateChamber(glass, { dt: 1 / 60, angle: 0, medium });

      if (piece.y > 0.8) {
        return frame / 60;
      }
    }

    return Number.POSITIVE_INFINITY;
  }

  // The whole of what an oil cell is: the same fall, taking long enough to
  // watch. Measured rather than asserted as a number, because the number is a
  // taste and the ordering is the physics.
  it('sinks the glass rather than dropping it', () => {
    const dry = fall(AIR);
    const wet = fall(OIL);

    expect(dry).toBeLessThan(2);
    expect(wet).toBeGreaterThan(dry * 3);
  });

  // Gravity is an acceleration, so it moves a boulder and a grain at the same
  // rate — which is why a dry cell falls as one. In a fluid the resistance goes
  // with the surface and the weight with the bulk, so the big ones win.
  it('sinks a big piece faster than a small one', () => {
    const drop = (radius: number, medium: Medium) => {
      const glass = chips(1, radius);
      const [piece] = glass as [Shard];

      piece.x = 0;
      piece.y = -0.6;

      for (let frame = 0; frame < 60; frame += 1) {
        updateChamber(glass, { dt: 1 / 60, angle: 0, medium });
      }

      return piece.y + 0.6;
    };

    const small = drop(0.04, OIL);
    const large = drop(0.12, OIL);

    expect(large).toBeGreaterThan(small * 1.5);

    // And in air they fall together, to within what a second of solving costs.
    expect(drop(0.12, AIR)).toBeCloseTo(drop(0.04, AIR), 2);
  });

  it('all but suspends it in a gel', () => {
    const glass = chips(1);
    const [piece] = glass as [Shard];

    piece.x = 0;
    piece.y = 0;

    for (let frame = 0; frame < 60; frame += 1) {
      updateChamber(glass, { dt: 1 / 60, angle: 0, medium: liquidCell(1) });
    }

    // A twentieth of the cell in a second: moving, and only just.
    expect(piece.y).toBeGreaterThan(0);
    expect(piece.y).toBeLessThan(0.1);
  });

  // The thresholds that stop a dry pile jittering would stop a slow sink dead,
  // and a liquid cell that freezes is not a liquid cell.
  it('never puts a piece to sleep', () => {
    const glass = chips(12);

    settleChamber(glass, 0, 20, OIL);

    expect(glass.some((shard) => Math.hypot(shard.vx, shard.vy) > 0)).toBe(true);
  });

  it('is the dry cell when it is filled with air', () => {
    const stated = chips(9);
    const assumed = chips(9);

    for (let frame = 0; frame < 120; frame += 1) {
      updateChamber(stated, { dt: 1 / 60, angle: frame * 0.02, medium: AIR, swirl: 3 });
      updateChamber(assumed, { dt: 1 / 60, angle: frame * 0.02 });
    }

    // Swirl included, and ignored: a cell with nothing in it to turn has none,
    // whatever it is handed.
    expect(stated).toEqual(assumed);
  });

  describe('the fluid it holds', () => {
    it('has none to speak of in a dry cell, so nothing ever lags', () => {
      expect(advanceFlow(0, 1 / 60, 4, AIR)).toBe(4);
    });

    it('catches the turning wall, and then outlives it', () => {
      let flow = 0;

      for (let frame = 0; frame < 60; frame += 1) {
        flow = advanceFlow(flow, 1 / 60, 2, OIL);
      }

      // Dragged most of the way up to the wall, but not all of it.
      expect(flow).toBeGreaterThan(1);
      expect(flow).toBeLessThan(2);

      const released = advanceFlow(flow, 1 / 60, 0, OIL);

      expect(released).toBeGreaterThan(0);
      expect(released).toBeLessThan(flow);
    });

    it('keeps what it had while the cell is paused', () => {
      expect(advanceFlow(1.5, 0, 0, OIL)).toBe(1.5);
    });
  });

  /** Where a piece sits around the cell, in radians. */
  const bearing = (shard: Shard) => Math.atan2(shard.y, shard.x);

  it('holds the glass back as a turn begins, and sweeps it on after it ends', () => {
    // Level with the middle, so gravity moves it down the screen rather than
    // around the cell, and what is measured is the fluid's doing.
    const glass = chips(1);
    const [piece] = glass as [Shard];

    piece.x = 0.8;
    piece.y = 0;

    let flow = 0;
    const started = bearing(piece);

    for (let frame = 0; frame < 30; frame += 1) {
      flow = advanceFlow(flow, 1 / 60, 2, OIL);
      updateChamber(glass, { dt: 1 / 60, angle: 0, medium: OIL, swirl: flow - 2 });
    }

    // The cell has turned under it and the fluid has not caught up, so within
    // the cell the piece has gone backwards.
    const trailed = bearing(piece);

    expect(trailed).toBeLessThan(started);

    for (let frame = 0; frame < 30; frame += 1) {
      flow = advanceFlow(flow, 1 / 60, 0, OIL);
      updateChamber(glass, { dt: 1 / 60, angle: 0, medium: OIL, swirl: flow });
    }

    // The tube has stopped and the fluid has not, so now it is carried on.
    expect(bearing(piece)).toBeGreaterThan(trailed + 0.2);
  });

  it('leaves the glass where it was scattered rather than piling it up', () => {
    const dry = createScene('drift', 40);
    const wet = createScene('drift', 40, { medium: FRESH_LIQUID });
    const depth = (shards: Shard[]) => centre(shards);

    // Down is +y, so a heap that has formed sits below a field that has not.
    expect(depth(wet.shards)).toBeLessThan(depth(dry.shards));
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
