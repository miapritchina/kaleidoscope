import { describe, expect, it } from 'vitest';

import { CHAMBER_RADIUS } from './chamber';
import { chordFor, createDrops, paintDrops, surfacesOf, updateDrops, type Drops } from './drops';

const still = { dt: 1 / 60, thickness: 0.35, swirl: 0, angle: 0 };

/** How much liquid the tube holds altogether. */
const FULL = Math.PI * CHAMBER_RADIUS * CHAMBER_RADIUS;

function run(drops: Drops, seconds: number, over = still) {
  for (let frame = 0; frame < seconds * 60; frame += 1) {
    updateDrops(drops, over);
  }
}

/** How much of each liquid there is, wherever in the column it happens to be. */
function held(drops: Drops): number[] {
  const each = [0, 0, 0];

  for (const band of drops.bands) {
    each[band.liquid] = each[band.liquid]! + band.area;
  }

  return each;
}

/** Whether the column is layered heaviest-first, which is what it settles to. */
const sorted = (drops: Drops) =>
  drops.bands.every((band, at) => at === 0 || drops.bands[at - 1]!.liquid > band.liquid);

/** Where every surface is, top of the cell first. */
function edgesOf(drops: Drops): number[] {
  const edges: number[] = [];

  surfacesOf(drops, edges);

  return edges;
}

describe('createDrops', () => {
  it('is the same cell for the same seed', () => {
    expect(createDrops(4, 0.5)).toEqual(createDrops(4, 0.5));
    expect(createDrops(4, 0.5)).not.toEqual(createDrops(5, 0.5));
  });

  // mulberry32's opening draws sit close together for seeds that sit close
  // together, so a cell that chose its liquids off the first one came out the
  // same colours for a run of seeds. Nothing else in the cell would have shown
  // it: every other number is drawn later.
  it('does not fill a run of nearby seeds with the same liquids', () => {
    const sets = new Set([1, 2, 3, 4, 5, 6].map((seed) => createDrops(seed, 0.5).tints[1]![0]));

    expect(sets.size).toBeGreaterThan(1);
  });

  it('holds three liquids and fills the tube exactly', () => {
    for (const amount of [0, 0.35, 0.55, 1]) {
      const drops = createDrops(2, amount);

      expect(drops.tints).toHaveLength(3);
      expect(drops.bands).toHaveLength(3);
      expect(held(drops).reduce((sum, one) => sum + one, 0)).toBeCloseTo(FULL, 9);

      for (const one of held(drops)) {
        expect(one).toBeGreaterThan(0);
      }
    }
  });

  // A sealed tube is always full, so Amount cannot ask for more liquid. What it
  // asks for is a deeper layer of one of them against the other two.
  it('lays the layers more unevenly when more is asked for', () => {
    const evenness = (amount: number) => {
      const each = held(createDrops(1, amount));

      return Math.max(...each) - Math.min(...each);
    };

    expect(evenness(0)).toBeCloseTo(0, 6);
    expect(evenness(1)).toBeGreaterThan(FULL * 0.1);

    // And never so uneven that a layer stops reaching into what the mirrors
    // fold. See SPREAD.
    for (const amount of [0, 0.5, 1]) {
      for (const one of held(createDrops(1, amount))) {
        expect(one).toBeGreaterThan(FULL * 0.26);
      }
    }
  });

  // Which is how the toy is handed to you, and there is nothing to catch this
  // one mid-motion: the motion *is* the run, and it starts at the start.
  it('opens upside down, with every layer in the wrong place', () => {
    const drops = createDrops(2, 0.6);

    expect(drops.bands.map((band) => band.liquid)).toEqual([0, 1, 2]);
    expect(sorted(drops)).toBe(false);
  });
});

describe('the run down', () => {
  it('sorts itself into layers, heaviest lowest, and then stops', () => {
    const drops = createDrops(3, 0.55);

    run(drops, 400);

    expect(drops.bands.map((band) => band.liquid)).toEqual([2, 1, 0]);
    expect(drops.swap).toBeNull();
    expect(drops.beads).toHaveLength(0);
  });

  // The one thing a bookkeeping model of a liquid has to get right. Every band
  // is somebody's liquid and the tube is sealed, so the three totals are the
  // three it was filled with, on every frame of the whole run.
  it('never has more or less of any of them than it started with', () => {
    const drops = createDrops(9, 0.7);
    const poured = held(drops);

    for (let frame = 0; frame < 60 * 200; frame += 1) {
      updateDrops(drops, still);

      const now = held(drops);

      expect(now[0]).toBeCloseTo(poured[0]!, 9);
      expect(now[1]).toBeCloseTo(poured[1]!, 9);
      expect(now[2]).toBeCloseTo(poured[2]!, 9);
      expect(now[0]! + now[1]! + now[2]!).toBeCloseTo(FULL, 9);
    }
  });

  // Not a fudge for the sake of a slow ending: a drip runs on the head of
  // liquid above it, which is why the real ones are still letting the odd bead
  // go minutes after the bulk of it has gone across.
  it('takes longer over the second half of an exchange than the first', () => {
    const drops = createDrops(5, 0.55);
    let half = 0;
    let most = 0;

    // Measured to nine tenths rather than to the end: the frame an exchange
    // finishes on is the frame the next one starts on, so a run that watched
    // for a progress of one would never see it.
    for (let frame = 0; frame < 60 * 200 && !most; frame += 1) {
      updateDrops(drops, still);

      const progress = drops.swap?.progress ?? 0;

      if (!half && progress >= 0.45) {
        half = frame;
      }

      if (half && progress >= 0.9) {
        most = frame;
      }
    }

    expect(half).toBeGreaterThan(0);
    expect(most - half).toBeGreaterThan(half);
  });

  it('runs slower through a gel than through a thin oil', () => {
    const gone = (thickness: number) => {
      const drops = createDrops(6, 0.55);

      run(drops, 40, { ...still, thickness });

      return drops.swap?.progress ?? 1;
    };

    expect(gone(0)).toBeGreaterThan(gone(1) * 2);
  });

  // Sampled at a run of instants, a surface that is flat between beads is flat
  // in nearly every one of them — so the wait is spent gathering the next pair
  // rather than waiting for it, and the exchange surface is never bare for more
  // than the single frame it takes to start the next.
  it('always has a bead gathering while an exchange is running', () => {
    const drops = createDrops(8, 0.55);
    let bare = 0;
    let longest = 0;

    for (let frame = 0; frame < 60 * 120; frame += 1) {
      updateDrops(drops, still);

      if (!drops.swap) {
        continue;
      }

      bare = drops.beads.some((bead) => bead.filling > 0) ? 0 : bare + 1;
      longest = Math.max(longest, bare);
    }

    expect(longest).toBeLessThanOrEqual(1);
  });

  // The thing three liquids can do that two could not, and the reason the
  // substance was rebuilt: the heavy one cannot get down past the light one
  // unless the light one comes up past it at the same moment, because there is
  // nowhere else in a sealed tube for either of them to go.
  it('sends a bead down and a bubble up out of the same surface at once', () => {
    const drops = createDrops(12, 0.55);
    let together = 0;

    for (let frame = 0; frame < 60 * 60; frame += 1) {
      updateDrops(drops, still);

      const going = drops.beads.filter((bead) => bead.filling <= 0 && !bead.landing);
      const down = going.find((bead) => !bead.rising);
      const up = going.find((bead) => bead.rising);

      if (down && up) {
        // And they are made of different liquids, or it is not an exchange.
        expect(down.liquid).not.toBe(up.liquid);
        together += 1;
      }
    }

    expect(together).toBeGreaterThan(60 * 10);
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
    for (const share of [0.05, 0.25, 0.5, 0.75, 0.95]) {
      expect(beyond(chordFor(FULL * share))).toBeCloseTo(FULL * share, 6);
    }
  });

  it('has nowhere for an empty layer and everywhere for a full one', () => {
    expect(chordFor(0)).toBe(1);
    expect(chordFor(FULL)).toBe(-1);
  });

  it('runs from the floor of the cell to its ceiling, in order', () => {
    const drops = createDrops(19, 0.55);

    run(drops, 25);

    const edges = edgesOf(drops);

    expect(edges).toHaveLength(drops.bands.length + 1);
    expect(edges[0]).toBeCloseTo(CHAMBER_RADIUS, 6);
    expect(edges[edges.length - 1]).toBeCloseTo(-CHAMBER_RADIUS, 6);

    for (let at = 1; at < edges.length; at += 1) {
      expect(edges[at]).toBeLessThanOrEqual(edges[at - 1]!);
    }
  });

  /**
   * How much of the mirror triangle a surface here would have below it.
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
  // enough in was three corners of it. Two surfaces rather than one is a
  // stronger answer than moving one was: with three layers of comparable
  // depth, neither of them can be at the rim.
  it('rests with both its surfaces where the mirrors can see them', () => {
    for (const amount of [0, 0.55, 1]) {
      const drops = createDrops(31, amount);

      run(drops, 400);

      expect(sorted(drops)).toBe(true);

      const [, lower, upper] = edgesOf(drops);

      for (const surface of [lower!, upper!]) {
        expect(Math.abs(surface)).toBeLessThan(CHAMBER_RADIUS * 0.5);
        // Neither of them cuts off less than a sixth of what is folded, which
        // is what "the mirrors can see it" means. At the rim it measured 0.11.
        expect(folded(surface)).toBeGreaterThan(0.15);
        expect(folded(surface)).toBeLessThan(0.85);
      }
    }
  });

  it('lies across whichever way is down', () => {
    const drops = createDrops(12, 0.55);

    run(drops, 300, { ...still, angle: Math.PI / 2 });

    // Down the screen is +y at an angle of nought; a quarter turn puts it at +x.
    expect(drops.downX).toBeCloseTo(1, 6);
    expect(drops.downY).toBeCloseTo(0, 6);
  });
});

describe('turning it over', () => {
  const settled = (seed: number) => {
    const drops = createDrops(seed, 0.55);

    run(drops, 400);

    return drops;
  };

  it('turns the whole column upside down when it is turned over briskly', () => {
    const drops = settled(13);
    const poured = held(drops);

    // Half a turn in half a second, which is what a hand does to one of these.
    for (let frame = 0; frame < 30; frame += 1) {
      updateDrops(drops, { ...still, angle: (frame / 30) * Math.PI });
    }

    expect(sorted(drops)).toBe(false);
    expect(held(drops)[0]).toBeCloseTo(poured[0]!, 9);
    expect(held(drops)[2]).toBeCloseTo(poured[2]!, 9);
  });

  // Because the liquid can follow. Tipping a real one gently on its side runs
  // it to the low side and leaves it there; it does not set it off.
  it('is not set off by a slow turn', () => {
    const drops = settled(14);

    for (let frame = 0; frame < 60 * 8; frame += 1) {
      updateDrops(drops, { ...still, angle: (frame / (60 * 8)) * Math.PI });
    }

    expect(sorted(drops)).toBe(true);
    expect(drops.swap).toBeNull();
  });

  it('runs again once it has been turned, and sorts itself out again', () => {
    const drops = settled(15);

    for (let frame = 0; frame < 30; frame += 1) {
      updateDrops(drops, { ...still, angle: (frame / 30) * Math.PI });
    }

    run(drops, 30, { ...still, angle: Math.PI });
    expect(drops.swap).not.toBeNull();

    run(drops, 400, { ...still, angle: Math.PI });
    expect(sorted(drops)).toBe(true);
  });
});

describe('a finger in the cell', () => {
  const drifting = (drops: Drops) =>
    drops.beads.find((bead) => bead.filling <= 0 && !bead.landing && !bead.rising);

  it('carries a bead along with it', () => {
    const drops = createDrops(21, 0.55);

    for (let frame = 0; frame < 60 * 60 && !drifting(drops); frame += 1) {
      updateDrops(drops, still);
    }

    const bead = drifting(drops);

    expect(bead).toBeDefined();

    const across = bead!.vx;

    updateDrops(drops, { ...still, stir: { x: bead!.x, y: bead!.y, vx: 1.5, vy: 0 } });

    expect(bead!.vx).toBeGreaterThan(across + 0.5);
  });

  it('leaves a bead the other side of the cell alone', () => {
    const drops = createDrops(21, 0.55);

    for (let frame = 0; frame < 60 * 60 && !drifting(drops); frame += 1) {
      updateDrops(drops, still);
    }

    const bead = drifting(drops);
    const across = bead!.vx;

    updateDrops(drops, {
      ...still,
      stir: { x: bead!.x + CHAMBER_RADIUS, y: bead!.y, vx: 1.5, vy: 0 },
    });

    expect(bead!.vx).toBeLessThan(across + 0.05);
  });

  // The one thing in this instrument a finger can push on that pushes back
  // where you are not touching.
  it('tips the whole column when it is swept along a surface', () => {
    const drops = createDrops(22, 0.55);

    run(drops, 400);

    expect(drops.lean).toBeCloseTo(0, 3);

    for (let frame = 0; frame < 20; frame += 1) {
      updateDrops(drops, { ...still, stir: { x: 0, y: 0.6, vx: 1.2, vy: 0 } });
    }

    expect(Math.abs(drops.lean)).toBeGreaterThan(0.03);
  });
});

describe('the slosh', () => {
  it('tips the surfaces when the tube is turned and levels them when it stops', () => {
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
 * Which liquid is in the way at each point, as a number: the layers summed the
 * way `paintDrops` sums them, with the beads over them. So this is the picture
 * and not the state, which is the only thing the test below can be asked about.
 */
function picture(drops: Drops, n = 48): Float32Array {
  const out = new Float32Array(n * n);
  const width = (2 * CHAMBER_RADIUS) / n;
  const edges = edgesOf(drops);
  const ease = (at: number) => (at <= 0 ? 0 : at >= 1 ? 1 : at * at * (3 - 2 * at));

  for (let j = 0; j < n; j += 1) {
    const y = -CHAMBER_RADIUS + (j + 0.5) * width;

    for (let i = 0; i < n; i += 1) {
      const x = -CHAMBER_RADIUS + (i + 0.5) * width;

      if (Math.hypot(x, y) >= CHAMBER_RADIUS) {
        continue;
      }

      const along = x * drops.downX + y * drops.downY;
      const layers = [0, 0, 0];

      for (let band = 0; band < drops.bands.length; band += 1) {
        const liquid = drops.bands[band]!.liquid;

        layers[liquid] =
          layers[liquid]! +
          (ease((along - edges[band + 1]!) / 0.055 + 0.5) -
            ease((along - edges[band]!) / 0.055 + 0.5));
      }

      const beads = [0, 0, 0];
      let total = 0;

      for (const bead of drops.beads) {
        const span = bead.reach * bead.reach;
        const away = span > 0 ? ((x - bead.x) ** 2 + (y - bead.y) ** 2) / span : 2;
        const sum = away < 1 ? (1 - away) * (1 - away) : 0;
        const much = ease((sum - 0.5) / 0.24 + 0.5);

        beads[bead.liquid] = beads[bead.liquid]! + much;
        total += much;
      }

      const rest = total > 1 ? 0 : 1 - total;
      const scale = total > 1 ? 1 / total : 1;
      let value = 0;

      for (let liquid = 0; liquid < 3; liquid += 1) {
        value += liquid * (beads[liquid]! * scale + layers[liquid]! * rest);
      }

      out[i + j * n] = value;
    }
  }

  return out;
}

// The lesson the lava lamp taught this repo, applied to the substance next to
// it. Every other measurement in this file passed the whole time the lava was
// flipping between two pictures sixty times a second, and the only thing that
// would have caught it is looking at what is drawn from one frame to the next.
//
// Two things in here are discontinuous by nature — a bead lets go of a surface,
// and a pair of layers stops exchanging — and both are deliberately spread over
// time rather than done on a frame. This is what says so.
describe('the picture from one frame to the next', () => {
  it('has no frame that throws it about', () => {
    for (const seed of [2, 17, 40]) {
      const drops = createDrops(seed, 0.55);
      const changes: number[] = [];
      let previous = picture(drops);

      for (let frame = 0; frame < 60 * 120; frame += 1) {
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

      // A bead letting go is the busiest thing that happens, and it is worth a
      // few dozen ordinary frames rather than a few hundred.
      expect(changes[changes.length - 1]! / median, `seed ${String(seed)}`).toBeLessThan(60);
    }
  }, 60000);
});

describe('paintDrops', () => {
  // jsdom has no canvas backend, so there is nothing to paint on; the caller is
  // expected to cope with that rather than the drawing being skipped upstream.
  it('hands back nothing rather than throwing where there is no canvas', () => {
    expect(paintDrops(createDrops(7, 0.5))).toBeNull();
  });
});
