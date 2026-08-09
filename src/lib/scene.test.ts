import { describe, expect, it } from 'vitest';

import { asContext, createFakeContext } from '../test/fakeCanvas';
import { createChipSprites } from './chips';
import { getPalette } from './palettes';
import { createScene, drawCell, SHARD_KINDS, updateScene } from './scene';

// jsdom has no canvas backend, so chip sprites are rendered onto recorders
// instead. They still come back as drawable images, which is all drawCell needs
// in order to exercise its tiling and culling.
const sprites = createChipSprites(getPalette('aurora'), {
  createCanvas: () =>
    ({
      width: 0,
      height: 0,
      getContext: () => asContext(createFakeContext()),
    }) as unknown as HTMLCanvasElement,
});

const BASE = { rotation: 0, pan: { x: 0, y: 0 }, sprites, glow: false };

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

  it('produces shards inside the unit cell with known kinds', () => {
    for (const shard of createScene('spread', 40).shards) {
      expect(shard.x).toBeGreaterThanOrEqual(0);
      expect(shard.x).toBeLessThan(1);
      expect(shard.y).toBeGreaterThanOrEqual(0);
      expect(shard.y).toBeLessThan(1);
      expect(SHARD_KINDS).toContain(shard.kind);
    }
  });

  it('always includes one large shard', () => {
    const largest = Math.max(...createScene('big', 20).shards.map((shard) => shard.radius));

    expect(largest).toBeGreaterThan(0.17);
  });
});

describe('updateScene', () => {
  const drag = { x: 0, y: 0 };

  it('keeps shard positions wrapped into the unit cell', () => {
    const scene = createScene('wrap', 20);

    for (let i = 0; i < 400; i += 1) {
      updateScene(scene, { dt: 0.05, turn: 0.2, drag });
    }

    for (const shard of scene.shards) {
      expect(shard.x).toBeGreaterThanOrEqual(0);
      expect(shard.x).toBeLessThan(1);
      expect(shard.colorStop).toBeGreaterThanOrEqual(0);
      expect(shard.colorStop).toBeLessThan(1);
    }
  });

  it('turns the tube at the given rate', () => {
    const scene = createScene('spin', 4);

    updateScene(scene, { dt: 0.05, turn: Math.PI * 2, drag });

    expect(scene.tube).toBeCloseTo(Math.PI * 2 * 0.05, 6);
  });

  it('turns the other way for a negative rate', () => {
    const scene = createScene('spin', 4);

    updateScene(scene, { dt: 0.05, turn: -Math.PI * 2, drag });

    expect(scene.tube).toBeLessThan(0);
  });

  // The chips are loose, so they trail the barrel and then settle. That lag is
  // what makes the figure evolve rather than only revolve.
  it('lets the contents lag the tube while it turns', () => {
    const scene = createScene('lag', 4);

    updateScene(scene, { dt: 0.05, turn: Math.PI * 2, drag });

    expect(scene.contents).toBeLessThan(scene.tube);
    expect(scene.contents).toBeGreaterThan(0);
  });

  it('lets the contents settle once the turn stops', () => {
    const scene = createScene('settle', 4);

    updateScene(scene, { dt: 0.05, turn: Math.PI * 2, drag });
    const lagWhileTurning = scene.tube - scene.contents;

    for (let i = 0; i < 60; i += 1) {
      updateScene(scene, { dt: 0.05, turn: 0, drag });
    }

    expect(scene.tube - scene.contents).toBeLessThan(lagWhileTurning);
    expect(scene.contents).toBeCloseTo(scene.tube, 3);
  });

  // Left uncapped, a brisk swipe leaves the chips so far behind that they go on
  // unwinding for seconds after the finger lifts, which reads as still turning.
  it('caps how far the contents can trail, however fast the turn', () => {
    const scene = createScene('cap', 4);

    for (let i = 0; i < 40; i += 1) {
      updateScene(scene, { dt: 0.05, turn: Math.PI * 4, drag });
    }

    expect(Math.abs(scene.tube - scene.contents)).toBeLessThanOrEqual(0.3 + 1e-9);
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
    expect(Math.abs(scene.tube - scene.contents)).toBeLessThan(0.05);
  });

  it('never overshoots the tube on a long frame', () => {
    const scene = createScene('overshoot', 4);

    updateScene(scene, { dt: 5, turn: Math.PI * 2, drag });

    expect(scene.contents).toBeLessThanOrEqual(scene.tube);
  });

  it('clamps an oversized frame so a backgrounded tab cannot jump', () => {
    const scene = createScene('clamp', 4);

    updateScene(scene, { dt: 30, turn: Math.PI * 2, drag });

    // Fully agitated at this rate, so elapsed advances by the whole clamped step.
    expect(scene.elapsed).toBeCloseTo(1 / 20, 6);
  });

  // A kaleidoscope on a table does not simmer away on its own.
  it('holds the chips still while the tube is at rest', () => {
    const scene = createScene('still', 12);
    const before = scene.shards.map((shard) => ({ ...shard }));

    for (let i = 0; i < 20; i += 1) {
      updateScene(scene, { dt: 0.05, turn: 0, drag });
    }

    expect(scene.shards).toEqual(before);
    expect(scene.elapsed).toBe(0);
    expect(scene.pan.x).toBe(0);
  });

  it('jostles the chips while the tube turns', () => {
    const scene = createScene('jostle', 12);
    const before = scene.shards.map((shard) => ({ ...shard }));

    updateScene(scene, { dt: 0.05, turn: Math.PI * 2, drag });

    expect(scene.shards).not.toEqual(before);
  });

  it('jostles them more the faster it is turned', () => {
    const gentle = createScene('rate', 6);
    const brisk = createScene('rate', 6);
    // Shards start at a random angle, so compare how far each one moved.
    const start = gentle.shards[0]!.rotation;

    updateScene(gentle, { dt: 0.05, turn: Math.PI * 0.1, drag });
    updateScene(brisk, { dt: 0.05, turn: Math.PI, drag });

    expect(Math.abs(brisk.shards[0]!.rotation - start)).toBeGreaterThan(
      Math.abs(gentle.shards[0]!.rotation - start),
    );
  });

  it('ignores negative time steps', () => {
    const scene = createScene('negative', 4);

    updateScene(scene, { dt: -5, turn: Math.PI * 2, drag });

    expect(scene.elapsed).toBe(0);
    expect(scene.tube).toBe(0);
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

describe('drawCell', () => {
  it('tiles the cell to cover the region', () => {
    const scene = createScene('tiles', 3);

    const zoomedOut = createFakeContext();
    drawCell(asContext(zoomedOut), scene, { ...BASE, size: 400, cellSize: 200 });

    const zoomedIn = createFakeContext();
    drawCell(asContext(zoomedIn), scene, { ...BASE, size: 400, cellSize: 400 });

    // A smaller cell needs more tiles, so more shards get drawn.
    expect(zoomedOut.countOf('translate')).toBeGreaterThan(zoomedIn.countOf('translate'));
  });

  it('draws nothing for a degenerate region', () => {
    const scene = createScene('empty', 5);
    const context = createFakeContext();

    drawCell(asContext(context), scene, { ...BASE, size: 0, cellSize: 100 });
    drawCell(asContext(context), scene, { ...BASE, size: 100, cellSize: 0 });

    expect(context.calls).toHaveLength(0);
  });

  it('switches to additive blending when glow is on', () => {
    const scene = createScene('glow', 2);
    const context = createFakeContext();

    drawCell(asContext(context), scene, { ...BASE, size: 100, cellSize: 100, glow: true });

    expect(context.globalCompositeOperation).toBe('lighter');
  });

  it('balances every save with a restore', () => {
    const scene = createScene('balance', 6);
    const context = createFakeContext();

    drawCell(asContext(context), scene, { ...BASE, size: 200, cellSize: 150 });

    expect(context.countOf('save')).toBe(context.countOf('restore'));
  });
});

describe('drawCell pan framing', () => {
  // The viewer drags in screen space; the field must not set off at whatever
  // angle the spin happened to have reached.
  it('expresses a screen-space pan in the rotated field frame', () => {
    const scene = createScene('pan-frame', 4);
    const upright = createFakeContext();
    const turned = createFakeContext();

    drawCell(asContext(upright), scene, {
      ...BASE,
      size: 200,
      cellSize: 100,
      pan: { x: 0.25, y: 0 },
    });
    drawCell(asContext(turned), scene, {
      ...BASE,
      size: 200,
      cellSize: 100,
      rotation: Math.PI / 2,
      pan: { x: 0.25, y: 0 },
    });

    // A quarter turn sends a rightward screen drag along the field's -y axis,
    // so the two runs must not place their tiles identically.
    expect(turned.argsOf('translate')).not.toEqual(upright.argsOf('translate'));
    expect(turned.argsOf('rotate')[0]).toEqual([Math.PI / 2]);
  });
});
