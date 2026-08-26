import { describe, expect, it } from 'vitest';

import { asContext, createFakeContext } from '../test/fakeCanvas';
import { createChipSprites } from './chips';
import { CHAMBER_RADIUS } from './chamber';
import { settleChamber } from './physics';
import {
  createScene,
  DEPTH_OVERLAP,
  drawChamber,
  pieceRadius,
  type Scene,
  SHARD_KINDS,
  updateScene,
} from './scene';
import { DEFAULT_SETTINGS, SUBSTANCES, type SubstanceId } from './settings';

// jsdom has no canvas backend, so chip sprites are rendered onto recorders
// instead. They still come back as drawable images, which is all drawCell needs
// in order to exercise its tiling and culling.
const sprites = createChipSprites({
  createCanvas: () =>
    ({
      width: 0,
      height: 0,
      getContext: () => asContext(createFakeContext()),
    }) as unknown as HTMLCanvasElement,
});

const BASE = { rotation: 0, pan: { x: 0, y: 0 }, sprites };

describe('createScene', () => {
  it('is deterministic for a given seed', () => {
    expect(createScene('abc', 12).shards).toEqual(createScene('abc', 12).shards);
  });

  it('differs between seeds', () => {
    expect(createScene('abc', 12).shards).not.toEqual(createScene('abd', 12).shards);
  });

  it('honours the shard count and clamps to at least one', () => {
    expect(createScene('abc', 30).shards).toHaveLength(30);
    expect(createScene('abc', 0).shards).toHaveLength(1);
    expect(createScene('abc', -5).shards).toHaveLength(1);
  });

  it('produces shards inside the chamber with known kinds', () => {
    for (const shard of createScene('spread', 40).shards) {
      expect(Math.hypot(shard.x, shard.y)).toBeLessThanOrEqual(CHAMBER_RADIUS);
      expect(SHARD_KINDS).toContain(shard.kind);
    }
  });

  it('opens on a settled pile rather than glass in mid-air', () => {
    // Well short of a full chamber, so the pile has somewhere to fall to. Pack
    // it and the glass has nowhere to go, and where its centre of mass lands
    // says nothing about whether it settled.
    const scene = createScene('settled', 14);

    // Everything has come to rest, and gravity is down, so the pile has
    // gathered in the lower half rather than staying where it was scattered.
    expect(scene.shards.every((shard) => Math.hypot(shard.vx, shard.vy) < 0.2)).toBe(true);

    const centreOfMass =
      scene.shards.reduce((sum, shard) => sum + shard.y, 0) / scene.shards.length;
    expect(centreOfMass).toBeGreaterThan(0);
  });

  // The test that looks at the picture. The round cell exists to fix a bare
  // strip along whichever wall the heap had fallen away from, and the same
  // mistake has been made twice in this repo by trusting a number measured on
  // an under-filled chamber — so this asks the only question that matters:
  // settled at the default piece count, does the glass keep the mirror
  // triangle covered whichever way the cell has been turned?
  it('keeps the mirror triangle covered at the default piece count', () => {
    // The triangle the renderer inscribes in the cell: corners at 90, 210 and
    // 330 degrees on the wall, so every point of it lies within half the
    // radius of the middle along each of the three wall normals.
    const wall = CHAMBER_RADIUS / 2;
    const normals = [Math.PI / 6, (5 * Math.PI) / 6, (3 * Math.PI) / 2].map((facing) => ({
      x: Math.cos(facing),
      y: Math.sin(facing),
    }));

    const scene = createScene('coverage', DEFAULT_SETTINGS.shards);

    for (const turn of [0, Math.PI / 3, Math.PI]) {
      settleChamber(scene.shards, turn);

      let inside = 0;
      let covered = 0;
      // The thinnest cover along any one wall, sampled in a band beside it —
      // where the bare strip opened. Coverage of the whole triangle would
      // average it away.
      const bandInside = [0, 0, 0];
      const bandCovered = [0, 0, 0];

      for (let x = -1.2; x <= 1.2; x += 0.03) {
        for (let y = -1.2; y <= 1.2; y += 0.03) {
          const depths = normals.map((normal) => wall - (x * normal.x + y * normal.y));

          if (depths.some((depth) => depth < 0)) {
            continue;
          }

          inside += 1;
          const hit = scene.shards.some(
            (shard) =>
              (shard.x - x) ** 2 + (shard.y - y) ** 2 <= (shard.radius * DEPTH_OVERLAP) ** 2,
          );

          if (hit) {
            covered += 1;
          }

          depths.forEach((depth, side) => {
            if (depth < 0.08) {
              bandInside[side]! += 1;

              if (hit) {
                bandCovered[side]! += 1;
              }
            }
          });
        }
      }

      // Floors against regression rather than aspirations. The default fill
      // measures about 97% covered with the worst wall band in the low
      // eighties — chinks of ground near the far corners, the last of which
      // only a fill past the mechanism's own ceiling closes (see LIMITS in
      // lib/settings.ts). The old default was 43% covered with a wall at zero:
      // a strip of bare ground, which is the defect these floors keep out.
      const at = `cell turned to ${(turn / Math.PI).toFixed(2)} pi`;
      expect(covered / inside, at).toBeGreaterThan(0.93);

      for (const [side, total] of bandInside.entries()) {
        expect(bandCovered[side]! / total, `${at}, wall ${String(side)}`).toBeGreaterThan(0.7);
      }
    }
  }, 60000);
});

describe('the variety of the glass', () => {
  /** The whole spread, sampled evenly, rather than one chamber's worth of it. */
  const spread = (variety: number, samples = 2000) =>
    Array.from({ length: samples }, (_, index) => pieceRadius(index / (samples - 1), variety));

  it('cuts every piece the same size at nought', () => {
    const cut = spread(0);

    expect(Math.min(...cut)).toBeCloseTo(Math.max(...cut), 9);
  });

  it('spreads them further the further it is opened', () => {
    const ratio = (variety: number) => {
      const cut = spread(variety);

      return Math.max(...cut) / Math.min(...cut);
    };

    expect(ratio(0.25)).toBeGreaterThan(1.2);
    expect(ratio(0.6)).toBeGreaterThan(ratio(0.25));
    expect(ratio(1)).toBeGreaterThan(ratio(0.6));
    // Everything from a speck to a bead at the widest.
    expect(ratio(1)).toBeGreaterThan(6);
  });

  // The point of the slider: it changes the variety and nothing else. A piece
  // three times across is nine times the glass, so left alone a wider mix would
  // fill the chamber as well as mix it and there would be no way to ask for one
  // without the other.
  it('holds the average area of glass constant across the whole range', () => {
    const area = (variety: number) =>
      spread(variety).reduce((sum, radius) => sum + radius * radius, 0);
    const middle = area(0);

    for (const variety of [0.25, 0.5, 0.75, 1]) {
      expect(area(variety) / middle).toBeCloseTo(1, 2);
    }
  });

  it('is what the chamber is actually cut to', () => {
    const one = createScene('variety', 30, { variety: 0 }).shards.map((shard) => shard.radius);
    const many = createScene('variety', 30, { variety: 1 }).shards.map((shard) => shard.radius);

    expect(Math.max(...one) / Math.min(...one)).toBeCloseTo(1, 6);
    expect(Math.max(...many) / Math.min(...many)).toBeGreaterThan(3);
  });
});

describe('a cell of substance', () => {
  // The whole point of it: a chamber holds a substance *instead* of pieces, so
  // there is no glass in it at all and nothing to settle.
  it('holds no glass whatsoever', () => {
    const scene = createScene('lamp', 150, { holds: 'substance', substance: 'lava' });

    expect(scene.shards).toHaveLength(0);
    expect(scene.substance).toBe('lava');
  });

  // One of them and only one, whichever it is: switching what the cell holds
  // costs a rebuild of the one being switched to and nothing else.
  it('builds only the substance it was asked for', () => {
    const held: Record<SubstanceId, (scene: Scene) => unknown> = {
      lava: (scene) => scene.lava,
      drops: (scene) => scene.drops,
      smoke: (scene) => scene.smoke,
      ink: (scene) => scene.ink,
      glitter: (scene) => scene.flakes,
      film: (scene) => scene.film,
    };

    for (const substance of SUBSTANCES) {
      const scene = createScene('one', 40, { holds: 'substance', substance });

      expect(held[substance](scene), substance).not.toBeNull();
      expect(
        SUBSTANCES.filter((other) => held[other](scene) !== null),
        substance,
      ).toEqual([substance]);
    }
  });

  it('leaves a cell of glass with no substance in it', () => {
    const scene = createScene('glass', 12);

    expect(scene.substance).toBeNull();
    expect(scene.lava).toBeNull();
    expect(scene.drops).toBeNull();
    expect(scene.smoke).toBeNull();
    expect(scene.ink).toBeNull();
    expect(scene.flakes).toBeNull();
    expect(scene.film).toBeNull();
    expect(scene.shards.length).toBeGreaterThan(0);
  });

  it('advances whatever is in it', () => {
    const scene = createScene('moving', 40, { holds: 'substance', substance: 'lava' });
    const before = scene.lava!.drops.map((drop) => ({ x: drop.x, y: drop.y }));

    for (let frame = 0; frame < 60; frame += 1) {
      updateScene(scene, { dt: 1 / 60, turn: 0, gravity: 0 });
    }

    expect(
      scene.lava!.drops.some(
        (drop, index) =>
          before[index] && Math.hypot(drop.x - before[index].x, drop.y - before[index].y) > 0.01,
      ),
    ).toBe(true);
  });
});

describe('updateScene', () => {
  it('keeps every chip inside the chamber wall', () => {
    const scene = createScene('wall', 30);

    for (let i = 0; i < 200; i += 1) {
      updateScene(scene, { dt: 0.05, turn: Math.PI, gravity: 0 });
    }

    for (const shard of scene.shards) {
      expect(Math.hypot(shard.x, shard.y)).toBeLessThanOrEqual(CHAMBER_RADIUS + 1e-6);
    }
  });

  it('clamps an oversized frame so a backgrounded tab cannot jump', () => {
    const scene = createScene('clamp', 4);

    updateScene(scene, { dt: 30, turn: Math.PI * 2, gravity: 0 });

    // Fully agitated at this rate, so elapsed advances by the whole clamped step.
    expect(scene.elapsed).toBeCloseTo(1 / 20, 6);
  });

  // A kaleidoscope on a table does not simmer away on its own.
  it('holds the chips still while the cell is at rest', () => {
    const scene = createScene('still', 12);

    // Left alone for a few seconds first: a pile that is still relaxing has not
    // finished settling yet, which is a different thing from simmering.
    for (let i = 0; i < 120; i += 1) {
      updateScene(scene, { dt: 0.05, turn: 0, gravity: 0 });
    }

    const before = scene.shards.map((shard) => ({ x: shard.x, y: shard.y }));

    for (let i = 0; i < 30; i += 1) {
      updateScene(scene, { dt: 0.05, turn: 0, gravity: 0 });
    }

    for (const [index, shard] of scene.shards.entries()) {
      expect(Math.hypot(shard.x - before[index]!.x, shard.y - before[index]!.y)).toBeLessThan(0.01);
    }
  });

  // Turning tips the pile, and it avalanches. That is the whole mechanism, and
  // in the cell's own frame it is gravity sweeping round — which is exactly
  // what the body hands over when the chamber is turned.
  it('avalanches the pile when gravity sweeps round it', () => {
    const scene = createScene('avalanche', 24);

    for (let i = 0; i < 40; i += 1) {
      updateScene(scene, { dt: 0.05, turn: 0, gravity: 0 });
    }
    const settled = scene.shards.map((shard) => ({ x: shard.x, y: shard.y }));

    // Half a turn puts the pile where the ceiling used to be.
    let gravity = 0;

    for (let i = 0; i < 40; i += 1) {
      gravity += (Math.PI / 2) * 0.05;
      updateScene(scene, { dt: 0.05, turn: Math.PI / 2, gravity });
    }

    const moved = scene.shards.filter(
      (shard, index) => Math.hypot(shard.x - settled[index]!.x, shard.y - settled[index]!.y) > 0.1,
    );

    expect(moved.length).toBeGreaterThan(scene.shards.length / 3);
  });

  it('gathers the pile on whichever side is down', () => {
    const upright = createScene('down', 24);
    const inverted = createScene('down', 24);

    for (let i = 0; i < 120; i += 1) {
      updateScene(upright, { dt: 0.05, turn: 0, gravity: 0 });
    }

    // Held upside down, gravity in the cell's frame reverses. Which way that
    // is worked out is the body's business; the cell only ever sees the angle.
    for (let i = 0; i < 120; i += 1) {
      updateScene(inverted, { dt: 0.05, turn: 0, gravity: Math.PI });
    }

    const centre = (scene: typeof upright) =>
      scene.shards.reduce((sum, shard) => sum + shard.y, 0) / scene.shards.length;

    expect(centre(upright)).toBeGreaterThan(0);
    expect(centre(inverted)).toBeLessThan(0);
  });

  it('ignores negative time steps', () => {
    const scene = createScene('negative', 4);

    updateScene(scene, { dt: -5, turn: Math.PI * 2, gravity: 0 });

    expect(scene.elapsed).toBe(0);
  });
});

describe('drawChamber', () => {
  // There is no drawn piece to fall back to any more. Without a picture to cut
  // them out of, a chamber of nothing is a truer answer than one full of shapes
  // nobody chose.
  it('draws nothing without a picture to cut the pieces from', () => {
    const context = createFakeContext();

    drawChamber(asContext(context), createScene('draw', 7), { ...BASE, scale: 100 });

    expect(context.countOf('drawImage')).toBe(0);
  });

  it('stamps one piece per chip once it has a picture', () => {
    const context = createFakeContext();
    const skin = { width: 400, height: 300 } as unknown as CanvasImageSource;

    drawChamber(asContext(context), createScene('draw', 7), { ...BASE, scale: 100, skin });

    expect(context.countOf('clip')).toBe(7);
  });

  // A pinch has to be seen while it is happening: the glass is only recut
  // once the size rests, so until then the sprites run ahead of the cut.
  it('magnifies the sprites past their cut size when asked', () => {
    const skin = { width: 400, height: 300 } as unknown as CanvasImageSource;
    const drawnWidth = (magnify: number) => {
      const context = createFakeContext();

      drawChamber(asContext(context), createScene('draw', 3), {
        ...BASE,
        scale: 100,
        magnify,
        skin,
      });

      const stamp = context.argsOf('drawImage').find((args) => args.length === 9);
      return stamp?.[7] as number;
    };

    expect(drawnWidth(2)).toBeCloseTo(drawnWidth(1) * 2, 6);
  });

  it('remembers the scale it was cut at, floored like the cut itself', () => {
    expect(createScene('scale', 4, { scale: 2 }).chipScale).toBe(2);
    expect(createScene('scale', 4, { scale: 0 }).chipScale).toBe(0.05);
    expect(createScene('scale', 4).chipScale).toBe(1);
  });

  it('draws nothing at a degenerate scale', () => {
    const context = createFakeContext();

    drawChamber(asContext(context), createScene('empty', 5), { ...BASE, scale: 0 });

    expect(context.calls).toHaveLength(0);
  });

  // The pieces are solid, so each one covers what is behind it.
  it('composites the pieces opaquely', () => {
    const context = createFakeContext();

    drawChamber(asContext(context), createScene('blend', 2), { ...BASE, scale: 50 });

    expect(context.globalCompositeOperation).toBe('source-over');
  });

  // With no objects to cut out — a landscape, a live camera — the photograph
  // becomes the surface of generated shapes instead: each piece clipped to its
  // own outline, filled from its own patch, and lit as the solid it is.
  it('falls back to patches of the photograph when it has no objects in it', () => {
    const context = createFakeContext();
    const skin = { width: 400, height: 300 } as unknown as CanvasImageSource;

    drawChamber(asContext(context), createScene('skin', 5), { ...BASE, scale: 60, skin });

    expect(context.countOf('clip')).toBe(5);
    // The patch, the shading and the blaze, for each piece.
    expect(context.countOf('drawImage')).toBe(15);

    const patches = context.argsOf('drawImage').filter((args) => args.length === 9);
    const corners = patches.map((args) => `${String(args[1])},${String(args[2])}`);
    expect(new Set(corners).size).toBeGreaterThan(1);
  });

  // When the picture is a few things on a plain backdrop, the pieces *are*
  // those things: one draw each, clipped to the object's own silhouette, with
  // no lighting over the top — the photograph came with its own.
  it('cuts the pieces to the objects in the picture when it has any', () => {
    const context = createFakeContext();
    const skin = { width: 400, height: 300 } as unknown as CanvasImageSource;
    const cut = {
      outline: [
        { x: -0.9, y: -0.4 },
        { x: 0.9, y: -0.4 },
        { x: 0.9, y: 0.4 },
        { x: -0.9, y: 0.4 },
      ],
      source: { x: 20, y: 30, width: 90, height: 40 },
      extent: { x: 1, y: 0.44 },
      area: Math.PI * 0.44,
    };
    const patches = { pick: (draw: { x: number; y: number }) => draw, cuts: [cut], cut: () => cut };

    drawChamber(asContext(context), createScene('cut', 5), {
      ...BASE,
      scale: 60,
      skin,
      patches,
    });

    expect(context.countOf('clip')).toBe(5);
    // One draw per piece: the object itself, and nothing laid over it.
    expect(context.countOf('drawImage')).toBe(5);

    for (const args of context.argsOf('drawImage')) {
      // Drawn from the object's own rectangle in the picture...
      expect(args.slice(1, 5)).toEqual([20, 30, 90, 40]);
      // ...into a box of the object's own proportions, not a square.
      expect(args[7]).not.toBe(args[8]);
    }

    // No `multiply` or `lighter`: the photograph is not relit.
    expect(
      context.stylesOf('drawImage').every((at) => at.globalCompositeOperation === 'source-over'),
    ).toBe(true);
  });

  // The chamber can be loaded with several sets at once, and then the pieces
  // are shared out across them: a pile of gems and beads together, not one or
  // the other. Each piece is drawn from its own set's picture.
  it('shares the pieces across every set it is loaded with', () => {
    const context = createFakeContext();
    const first = { width: 400, height: 300 } as unknown as CanvasImageSource;
    const second = { width: 400, height: 300 } as unknown as CanvasImageSource;
    // A cut apiece, so every piece is one draw from its own set's picture — the
    // object path, with nothing laid over it.
    const cut = {
      outline: [
        { x: -0.9, y: -0.4 },
        { x: 0.9, y: -0.4 },
        { x: 0.9, y: 0.4 },
        { x: -0.9, y: 0.4 },
      ],
      source: { x: 20, y: 30, width: 90, height: 40 },
      extent: { x: 1, y: 0.44 },
      area: Math.PI * 0.44,
    };
    const patches = { pick: (draw: { x: number; y: number }) => draw, cuts: [cut], cut: () => cut };

    drawChamber(asContext(context), createScene('mix', 40), {
      ...BASE,
      scale: 60,
      glasses: [
        { skin: first, patches },
        { skin: second, patches },
      ],
    });

    // Every one of the forty pieces was drawn from one of the two pictures...
    const used = context.argsOf('drawImage').map((args) => args[0]);
    expect(used).toHaveLength(40);
    // ...and both pictures were actually reached, so the mix is a mix.
    expect(used).toContain(first);
    expect(used).toContain(second);
  });

  // Chip size is geometry, not a scale applied at draw time: a bigger piece
  // displaces its neighbours and piles differently. Scaling only the sprite
  // leaves every arrangement identical and just draws it smaller.
  it('gives bigger pieces a bigger footprint, not just a bigger picture', () => {
    const small = createScene('scale', 12, { scale: 1 });
    const large = createScene('scale', 12, { scale: 2 });

    for (const [index, shard] of large.shards.entries()) {
      expect(shard.radius).toBeCloseTo(small.shards[index]!.radius * 2, 6);
    }

    // And they have been settled at that size, so the pile is a different pile.
    const moved = large.shards.filter(
      (shard, index) =>
        Math.hypot(shard.x - small.shards[index]!.x, shard.y - small.shards[index]!.y) > 0.05,
    );

    expect(moved.length).toBeGreaterThan(large.shards.length / 3);
  });

  it('balances every save with a restore', () => {
    const context = createFakeContext();

    drawChamber(asContext(context), createScene('balance', 6), { ...BASE, scale: 80 });

    expect(context.countOf('save')).toBe(context.countOf('restore'));
  });
});
