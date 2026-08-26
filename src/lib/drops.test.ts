import { describe, expect, it } from 'vitest';

import { CHAMBER_RADIUS } from './chamber';
import { chordFor, createDrops, paintDrops, updateDrops, type Drops } from './drops';

const still = { dt: 1 / 60, thickness: 0.35, swirl: 0, angle: 0 };

function run(drops: Drops, seconds: number, over = still) {
  for (let frame = 0; frame < seconds * 60; frame += 1) {
    updateDrops(drops, over);
  }
}

/** How much heavy liquid there is, wherever it happens to be. */
const liquid = (drops: Drops) =>
  drops.overhead +
  drops.floor +
  drops.beads.reduce((sum, bead) => sum + (bead.rising ? 0 : bead.area), 0);

describe('createDrops', () => {
  it('is the same cell for the same seed', () => {
    expect(createDrops(4, 0.5)).toEqual(createDrops(4, 0.5));
    expect(createDrops(4, 0.5)).not.toEqual(createDrops(5, 0.5));
  });

  // mulberry32's opening draws sit close together for seeds that sit close
  // together, so a cell that chose its liquids off the first one came out the
  // same colour for a run of seeds. Nothing else in the cell would have shown
  // it: every other number is drawn later.
  it('does not fill a run of nearby seeds with the same pair of liquids', () => {
    const pairs = new Set([1, 2, 3, 4, 5, 6].map((seed) => createDrops(seed, 0.5).tints[1][0]));

    expect(pairs.size).toBeGreaterThan(1);
  });

  it('pours more in when more is asked for', () => {
    expect(createDrops(1, 1).heavy).toBeGreaterThan(createDrops(1, 0).heavy * 1.5);
  });

  // Which is how the toy is handed to you, and there is nothing to catch this
  // one mid-motion: the motion *is* the run, and it starts at the start.
  it('opens turned over, with all of it overhead', () => {
    const drops = createDrops(2, 0.6);

    expect(drops.overhead).toBe(drops.heavy);
    expect(drops.floor).toBe(0);
  });
});

describe('the run down', () => {
  it('carries every last bit of it from one end to the other', () => {
    const drops = createDrops(3, 0.55);

    run(drops, 200);

    expect(drops.overhead).toBe(0);
    expect(drops.beads).toHaveLength(0);
    expect(drops.floor).toBeCloseTo(drops.heavy, 9);
  });

  // The one thing a bookkeeping model of a liquid has to get right, and the one
  // thing it is easy to get wrong: the bump a bead starts as was liquid that
  // had to come out of the pool, and the first version of this conjured it.
  it('never has more or less of it than it started with', () => {
    const drops = createDrops(9, 0.7);

    for (let frame = 0; frame < 60 * 90; frame += 1) {
      updateDrops(drops, still);
      expect(liquid(drops)).toBeCloseTo(drops.heavy, 9);
    }
  });

  // Not a fudge for the sake of a slow ending: a drip runs on the head of
  // liquid above it, which is why the real ones are still letting the odd bead
  // go minutes after the bulk of it has gone down.
  it('takes longer over the second half than the first', () => {
    const drops = createDrops(5, 0.55);
    let half = 0;
    let all = 0;

    for (let frame = 0; frame < 60 * 300; frame += 1) {
      updateDrops(drops, still);

      if (!half && drops.overhead <= drops.heavy / 2) {
        half = frame;
      }

      if (!all && drops.overhead === 0) {
        all = frame;
      }
    }

    expect(half).toBeGreaterThan(0);
    expect(all - half).toBeGreaterThan(half);
  });

  it('runs slower through a gel than through a thin oil', () => {
    const spent = (thickness: number) => {
      const drops = createDrops(6, 0.55);
      let frames = 0;

      while (drops.overhead > 0 && frames < 60 * 600) {
        updateDrops(drops, { ...still, thickness });
        frames += 1;
      }

      return frames;
    };

    expect(spent(1)).toBeGreaterThan(spent(0) * 2);
  });

  // Sampled at a run of instants, a surface that is flat between beads is flat
  // in nearly every one of them — so the wait is spent gathering the next one
  // rather than waiting for it, and the underside of the pool is never bare for
  // more than the single frame it takes to start the next.
  it('always has a bead gathering while there is anything left to gather', () => {
    const drops = createDrops(8, 0.55);
    let bare = 0;
    let longest = 0;

    while (drops.overhead > 0) {
      updateDrops(drops, still);
      bare = drops.beads.some((bead) => bead.filling > 0) ? 0 : bare + 1;
      longest = Math.max(longest, bare);
    }

    expect(longest).toBeLessThanOrEqual(1);
  });

  it('keeps every bead inside the wall', () => {
    const drops = createDrops(11, 0.8);

    run(drops, 60, { ...still, swirl: 3, angle: 1 });

    for (const bead of drops.beads) {
      expect(Math.hypot(bead.x, bead.y)).toBeLessThanOrEqual(CHAMBER_RADIUS + 1e-9);
    }
  });
});

describe('where the surfaces lie', () => {
  const beyond = (chord: number) =>
    CHAMBER_RADIUS * CHAMBER_RADIUS * (Math.acos(chord) - chord * Math.sqrt(1 - chord * chord));

  it('puts a surface where that much liquid would put it', () => {
    const full = Math.PI * CHAMBER_RADIUS * CHAMBER_RADIUS;

    for (const share of [0.05, 0.25, 0.5, 0.75, 0.95]) {
      expect(beyond(chordFor(full * share))).toBeCloseTo(full * share, 6);
    }
  });

  it('has nowhere for an empty pool and everywhere for a full one', () => {
    expect(chordFor(0)).toBe(1);
    expect(chordFor(Math.PI * CHAMBER_RADIUS * CHAMBER_RADIUS)).toBe(-1);
  });

  /**
   * How much of the mirror triangle a pool with its surface here would cover.
   *
   * The cell is the disc the triangle is inscribed in, so the triangle's edges
   * lie at half the radius: the fold never sees the outer half of the cell.
   */
  function folded(surface: number, angle = Math.PI / 3, n = 300): number {
    const R = CHAMBER_RADIUS;
    let inside = 0;
    let wet = 0;

    for (let j = 0; j < n; j += 1) {
      for (let i = 0; i < n; i += 1) {
        const x = -R + ((i + 0.5) * 2 * R) / n;
        const y = -R + ((j + 0.5) * 2 * R) / n;
        let corner = false;

        for (let k = 0; k < 3; k += 1) {
          const a = (k * 2 * Math.PI) / 3 + Math.PI / 2;

          corner ||= x * Math.cos(a) + y * Math.sin(a) > R / 2;
        }

        if (corner) {
          continue;
        }

        inside += 1;

        if (x * Math.sin(angle) + y * Math.cos(angle) >= surface) {
          wet += 1;
        }
      }
    }

    return wet / inside;
  }

  // The bug this replaced, and nothing about the liquid was wrong when it
  // happened: the cell drained to a flat pool exactly as it should, every
  // number checked out, and the figure came out as a lattice of little
  // rosettes. The rosettes *were* the pool — a settled pool is a cap at the
  // rim, the fold only samples the middle of the cell, and what reached far
  // enough in was three corners of it.
  it('rests with its surface where the mirrors can see it', () => {
    const drops = createDrops(31, 0.55);

    run(drops, 250);

    expect(drops.overhead).toBe(0);
    // Within a twentieth of the middle of the cell, and better than a third of
    // what is folded. At the rim it measured 0.11.
    expect(Math.abs(drops.floorAt)).toBeLessThan(CHAMBER_RADIUS * 0.06);
    expect(folded(drops.floorAt)).toBeGreaterThan(0.33);
  });

  it('lies across whichever way is down', () => {
    const drops = createDrops(12, 0.55);

    run(drops, 200, { ...still, angle: Math.PI / 2 });

    // Down the screen is +y at an angle of nought; a quarter turn puts it at +x.
    expect(drops.downX).toBeCloseTo(1, 6);
    expect(drops.downY).toBeCloseTo(0, 6);
  });
});

describe('turning it over', () => {
  const drained = (seed: number) => {
    const drops = createDrops(seed, 0.55);

    run(drops, 200);

    return drops;
  };

  it('sets the whole thing going again when it is turned over briskly', () => {
    const drops = drained(13);
    const settled = drops.floor;

    // Half a turn in half a second, which is what a hand does to one of these.
    for (let frame = 0; frame < 30; frame += 1) {
      updateDrops(drops, { ...still, angle: (frame / 30) * Math.PI });
    }

    // All of it, less whatever the bead that started gathering on the way has
    // already taken out of the pool.
    expect(drops.overhead).toBeGreaterThan(settled * 0.95);
    expect(liquid(drops)).toBeCloseTo(settled, 9);
    expect(drops.floor).toBe(0);
  });

  // Because the liquid can follow. Tipping a real one gently on its side runs
  // it to the low side and leaves it there; it does not set it off.
  it('is not set off by a slow turn', () => {
    const drops = drained(14);
    const settled = drops.floor;

    for (let frame = 0; frame < 60 * 8; frame += 1) {
      updateDrops(drops, { ...still, angle: (frame / (60 * 8)) * Math.PI });
    }

    expect(drops.floor).toBeCloseTo(settled, 6);
    expect(drops.overhead).toBe(0);
  });

  it('runs again once it has been turned', () => {
    const drops = drained(15);

    for (let frame = 0; frame < 30; frame += 1) {
      updateDrops(drops, { ...still, angle: (frame / 30) * Math.PI });
    }

    run(drops, 30, { ...still, angle: Math.PI });

    expect(drops.floor).toBeGreaterThan(0);
    expect(drops.overhead).toBeGreaterThan(0);
  });
});

describe('a finger in the cell', () => {
  it('carries a bead along with it', () => {
    const drops = createDrops(21, 0.55);

    run(drops, 12);

    const bead = drops.beads.find((one) => !one.rising && one.filling === 0);

    expect(bead).toBeDefined();

    const across = bead!.vx;

    updateDrops(drops, {
      ...still,
      stir: { x: bead!.x, y: bead!.y, vx: 1.5, vy: 0 },
    });

    expect(bead!.vx).toBeGreaterThan(across + 0.5);
  });

  it('leaves a bead the other side of the cell alone', () => {
    const drops = createDrops(21, 0.55);

    run(drops, 12);

    const bead = drops.beads.find((one) => !one.rising && one.filling === 0);
    const across = bead!.vx;

    updateDrops(drops, {
      ...still,
      stir: { x: bead!.x + CHAMBER_RADIUS, y: bead!.y, vx: 1.5, vy: 0 },
    });

    expect(bead!.vx).toBeLessThan(across + 0.05);
  });

  // The one thing in this instrument a finger can push on that pushes back
  // where you are not touching.
  it('tips the whole surface when it is swept along one', () => {
    const drops = createDrops(22, 0.55);

    run(drops, 200);

    expect(drops.lean).toBeCloseTo(0, 3);

    for (let frame = 0; frame < 20; frame += 1) {
      updateDrops(drops, { ...still, stir: { x: 0, y: 0.6, vx: 1.2, vy: 0 } });
    }

    expect(Math.abs(drops.lean)).toBeGreaterThan(0.03);
  });
});

describe('the slosh', () => {
  it('tips the surface when the tube is turned and levels it when it stops', () => {
    const drops = createDrops(16, 0.55);

    run(drops, 3);

    for (let frame = 0; frame < 30; frame += 1) {
      updateDrops(drops, { ...still, swirl: 4, angle: frame * 0.05 });
    }

    expect(Math.abs(drops.lean)).toBeGreaterThan(0.05);

    run(drops, 5, { ...still, angle: 1.5 });

    expect(Math.abs(drops.lean)).toBeLessThan(0.005);
  });
});

/**
 * What is drawn, on a coarse grid, without needing a canvas.
 *
 * The pools and the beads summed the way `paintDrops` sums them, and then
 * thresholded — so this is the picture and not the state, which is the only
 * thing the test below can be asked about.
 */
function picture(drops: Drops, n = 48): Float32Array {
  const out = new Float32Array(n * n);
  const width = (2 * CHAMBER_RADIUS) / n;
  const ceiling = drops.overhead > 0 ? drops.overheadAt - 0.041 : -Infinity;
  const bed = drops.floor > 0 ? drops.floorAt + 0.041 : Infinity;
  const pool = (past: number) => (past >= 0 ? 1 : past <= -0.14 ? 0 : (1 + past / 0.14) ** 2);

  for (let j = 0; j < n; j += 1) {
    const y = -CHAMBER_RADIUS + (j + 0.5) * width;

    for (let i = 0; i < n; i += 1) {
      const x = -CHAMBER_RADIUS + (i + 0.5) * width;

      if (Math.hypot(x, y) >= CHAMBER_RADIUS) {
        continue;
      }

      const along = x * drops.downX + y * drops.downY;
      let total = Math.max(pool(ceiling - along), pool(along - bed));

      for (const bead of drops.beads) {
        const away = ((x - bead.x) ** 2 + (y - bead.y) ** 2) / (bead.reach * bead.reach);

        if (away < 1) {
          total += (bead.rising ? -1 : 1) * (1 - away) * (1 - away);
        }
      }

      const at = (total - 0.38) / 0.24;

      out[i + j * n] = at <= 0 ? 0 : at >= 1 ? 1 : at * at * (3 - 2 * at);
    }
  }

  return out;
}

// The lesson the lava lamp taught this repo, applied to the substance next to
// it. Every other measurement in this file passed the whole time the lava was
// flipping between two pictures sixty times a second, and the only thing that
// would have caught it is looking at what is drawn from one frame to the next.
//
// Two things in here are discontinuous by nature — a bead lets go of one pool
// and is taken into another — and both are deliberately spread over time rather
// than done on a frame. This is what says so.
describe('the picture from one frame to the next', () => {
  it('has no frame that throws it about', () => {
    for (const seed of [2, 17, 40]) {
      const drops = createDrops(seed, 0.55);
      const changes: number[] = [];
      let previous = picture(drops);

      for (let frame = 0; frame < 60 * 60; frame += 1) {
        updateDrops(drops, still);

        const now = picture(drops);
        let moved = 0;

        for (let k = 0; k < now.length; k += 1) {
          moved += Math.abs(now[k]! - previous[k]!);
        }

        changes.push(moved);
        previous = now;
      }

      changes.sort((a, b) => a - b);

      const median = changes[Math.floor(changes.length / 2)]!;

      // A bead being poured into the pool is the busiest thing that happens,
      // and it is worth a few dozen ordinary frames rather than a few hundred.
      expect(changes[changes.length - 1]! / median, `seed ${String(seed)}`).toBeLessThan(60);
    }
  });
});

describe('paintDrops', () => {
  // jsdom has no canvas backend, so there is nothing to paint on; the caller is
  // expected to cope with that rather than the drawing being skipped upstream.
  it('hands back nothing rather than throwing where there is no canvas', () => {
    expect(paintDrops(createDrops(7, 0.5))).toBeNull();
  });
});
