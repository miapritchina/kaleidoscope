import { describe, expect, it } from 'vitest';

import { asContext, createFakeContext } from '../test/fakeCanvas';
import { createChipSprites } from './chips';
import { CHAMBER_RADIUS } from './chamber';
import { createScene, drawChamber, SHARD_KINDS, updateScene } from './scene';

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
});

describe('updateScene', () => {
  const drag = { x: 0, y: 0 };

  it('keeps every chip inside the chamber wall', () => {
    const scene = createScene('wall', 30);

    for (let i = 0; i < 200; i += 1) {
      updateScene(scene, { dt: 0.05, turn: Math.PI, drag });
    }

    for (const shard of scene.shards) {
      expect(Math.hypot(shard.x, shard.y)).toBeLessThanOrEqual(CHAMBER_RADIUS + 1e-6);
    }
  });

  it('turns the cell at the given rate', () => {
    const scene = createScene('spin', 4);

    updateScene(scene, { dt: 0.05, turn: Math.PI * 2, drag });

    expect(scene.cell).toBeCloseTo(Math.PI * 2 * 0.05, 6);
  });

  it('turns the other way for a negative rate', () => {
    const scene = createScene('spin', 4);

    updateScene(scene, { dt: 0.05, turn: -Math.PI * 2, drag });

    expect(scene.cell).toBeLessThan(0);
  });

  // The chips are loose, so they trail the cell and then settle. That lag is
  // what makes the figure evolve rather than only revolve.
  it('lets the contents lag the cell while it turns', () => {
    const scene = createScene('lag', 4);

    updateScene(scene, { dt: 0.05, turn: Math.PI * 2, drag });

    expect(scene.contents).toBeLessThan(scene.cell);
    expect(scene.contents).toBeGreaterThan(0);
  });

  it('lets the contents settle once the turn stops', () => {
    const scene = createScene('settle', 4);

    updateScene(scene, { dt: 0.05, turn: Math.PI * 2, drag });
    const lagWhileTurning = scene.cell - scene.contents;

    for (let i = 0; i < 60; i += 1) {
      updateScene(scene, { dt: 0.05, turn: 0, drag });
    }

    expect(scene.cell - scene.contents).toBeLessThan(lagWhileTurning);
    expect(scene.contents).toBeCloseTo(scene.cell, 3);
  });

  // Left uncapped, a brisk swipe leaves the chips so far behind that they go on
  // unwinding for seconds after the finger lifts, which reads as still turning.
  it('caps how far the contents can trail, however fast the turn', () => {
    const scene = createScene('cap', 4);

    for (let i = 0; i < 40; i += 1) {
      updateScene(scene, { dt: 0.05, turn: Math.PI * 4, drag });
    }

    expect(Math.abs(scene.cell - scene.contents)).toBeLessThanOrEqual(0.3 + 1e-9);
  });

  it('settles quickly once the turn stops, even after a fast one', () => {
    const scene = createScene('quick', 4);

    for (let i = 0; i < 40; i += 1) {
      updateScene(scene, { dt: 0.05, turn: Math.PI * 4, drag });
    }
    for (let i = 0; i < 10; i += 1) {
      updateScene(scene, { dt: 0.05, turn: 0, drag });
    }

    // Half a second after release the contents are all but caught up.
    expect(Math.abs(scene.cell - scene.contents)).toBeLessThan(0.05);
  });

  it('never overshoots the cell on a long frame', () => {
    const scene = createScene('overshoot', 4);

    updateScene(scene, { dt: 5, turn: Math.PI * 2, drag });

    expect(scene.contents).toBeLessThanOrEqual(scene.cell);
  });

  it('clamps an oversized frame so a backgrounded tab cannot jump', () => {
    const scene = createScene('clamp', 4);

    updateScene(scene, { dt: 30, turn: Math.PI * 2, drag });

    // Fully agitated at this rate, so elapsed advances by the whole clamped step.
    expect(scene.elapsed).toBeCloseTo(1 / 20, 6);
  });

  // A kaleidoscope on a table does not simmer away on its own.
  it('holds the chips still while the cell is at rest', () => {
    const scene = createScene('still', 12);

    // Left alone for a few seconds first: a pile that is still relaxing has not
    // finished settling yet, which is a different thing from simmering.
    for (let i = 0; i < 120; i += 1) {
      updateScene(scene, { dt: 0.05, turn: 0, drag });
    }

    const before = scene.shards.map((shard) => ({ x: shard.x, y: shard.y }));

    for (let i = 0; i < 30; i += 1) {
      updateScene(scene, { dt: 0.05, turn: 0, drag });
    }

    for (const [index, shard] of scene.shards.entries()) {
      expect(Math.hypot(shard.x - before[index]!.x, shard.y - before[index]!.y)).toBeLessThan(0.01);
    }
  });

  // Turning tips the pile, and it avalanches. That is the whole mechanism.
  it('avalanches the pile when the cell is turned', () => {
    const scene = createScene('avalanche', 24);

    for (let i = 0; i < 40; i += 1) {
      updateScene(scene, { dt: 0.05, turn: 0, drag });
    }
    const settled = scene.shards.map((shard) => ({ x: shard.x, y: shard.y }));

    // Half a turn puts the pile where the ceiling used to be.
    for (let i = 0; i < 40; i += 1) {
      updateScene(scene, { dt: 0.05, turn: Math.PI / 2, drag });
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
      updateScene(upright, { dt: 0.05, turn: 0, drag });
    }

    // Held upside down, gravity in the cell's frame reverses.
    inverted.cell = Math.PI;
    for (let i = 0; i < 120; i += 1) {
      updateScene(inverted, { dt: 0.05, turn: 0, drag });
    }

    const centre = (scene: typeof upright) =>
      scene.shards.reduce((sum, shard) => sum + shard.y, 0) / scene.shards.length;

    expect(centre(upright)).toBeGreaterThan(0);
    expect(centre(inverted)).toBeLessThan(0);
  });

  // Tipping a real one in your hand does not turn the figure: the mirrors and
  // the chamber are both fixed in the tube. What changes is which way the
  // pieces fall.
  it('lets a tilt move gravity without turning anything', () => {
    const scene = createScene('tilt', 24);

    for (let i = 0; i < 160; i += 1) {
      updateScene(scene, { dt: 0.05, turn: 0, drag, tilt: Math.PI / 2 });
    }

    // A quarter turn of tilt puts the floor along one side of the cell, so the
    // pile gathers sideways rather than at the bottom.
    const centreX = scene.shards.reduce((sum, shard) => sum + shard.x, 0) / scene.shards.length;
    const centreY = scene.shards.reduce((sum, shard) => sum + shard.y, 0) / scene.shards.length;

    expect(Math.abs(centreX)).toBeGreaterThan(Math.abs(centreY));
    // And the figure has not moved: the cell is drawn at this angle, and it is
    // exactly where it started.
    expect(scene.cell).toBe(0);
    expect(scene.contents).toBe(0);
  });

  it('takes a tilt and a turn together', () => {
    const tilted = createScene('both', 20);
    const turned = createScene('both', 20);

    // A third of a turn of tilt is the same as a third of a turn of tube, as
    // far as the pieces are concerned — they compose into one direction for
    // gravity. A third and not a half, because the cell is the mirror triangle
    // and only a third of a turn brings its walls back onto themselves.
    for (let i = 0; i < 120; i += 1) {
      updateScene(tilted, { dt: 0.05, turn: 0, drag, tilt: (2 * Math.PI) / 3 });
      turned.cell = (2 * Math.PI) / 3;
      updateScene(turned, { dt: 0.05, turn: 0, drag });
    }

    for (const [index, shard] of tilted.shards.entries()) {
      expect(
        Math.hypot(shard.x - turned.shards[index]!.x, shard.y - turned.shards[index]!.y),
      ).toBeLessThan(0.2);
    }
  });

  // Holding the tube at an angle turns the figure and leaves the pieces where
  // the floor puts them. The cell is drawn inside the framework, so unless the
  // framework's angle comes off gravity's the pile leans with the instrument —
  // which no real one does.
  it('turns the framework without taking the pile with it', () => {
    for (const framework of [0, Math.PI / 3, -Math.PI / 4, Math.PI]) {
      const scene = createScene('framework', 24);

      for (let i = 0; i < 160; i += 1) {
        updateScene(scene, { dt: 0.05, turn: 0, drag, framework });
      }

      // Where the pile has gathered, put back through the rotation the renderer
      // will apply to it. However the instrument is being held, the glass ends
      // up at the bottom of the screen.
      const x = scene.shards.reduce((sum, shard) => sum + shard.x, 0) / scene.shards.length;
      const y = scene.shards.reduce((sum, shard) => sum + shard.y, 0) / scene.shards.length;
      const onScreen = {
        x: x * Math.cos(framework) - y * Math.sin(framework),
        y: x * Math.sin(framework) + y * Math.cos(framework),
      };

      // Below the middle, by a real pile's depth. Not centred sideways: the
      // contacts hold, so a heap keeps whatever lopsidedness it settled with
      // rather than levelling itself off like a liquid.
      expect(onScreen.y, `held at ${String(framework)}`).toBeGreaterThan(0.1);
      // And the figure's own angle is not something the framework touches.
      expect(scene.cell).toBe(0);
    }
  });

  it('ignores negative time steps', () => {
    const scene = createScene('negative', 4);

    updateScene(scene, { dt: -5, turn: Math.PI * 2, drag });

    expect(scene.elapsed).toBe(0);
    expect(scene.cell).toBe(0);
  });

  it('records the drag as a position, so the source stays where it is let go', () => {
    const scene = createScene('pan', 4);

    updateScene(scene, { dt: 0.1, turn: 0, drag: { x: 0.5, y: -0.25 } });
    expect(scene.drag).toEqual({ x: 0.5, y: -0.25 });

    // Holding still must not keep accumulating, the way a velocity would.
    updateScene(scene, { dt: 0.1, turn: 0, drag: { x: 0.5, y: -0.25 } });
    expect(scene.drag).toEqual({ x: 0.5, y: -0.25 });
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

  // Chip size is geometry, not a scale applied at draw time: a bigger piece
  // displaces its neighbours and piles differently. Scaling only the sprite
  // leaves every arrangement identical and just draws it smaller.
  it('gives bigger pieces a bigger footprint, not just a bigger picture', () => {
    const small = createScene('scale', 12, 1);
    const large = createScene('scale', 12, 2);

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
