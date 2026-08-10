import { describe, expect, it } from 'vitest';

import { asContext, createFakeContext } from '../test/fakeCanvas';
import { createChipSprites } from './chips';
import { getPalette } from './palettes';
import { CHAMBER_RADIUS } from './chamber';
import { createScene, drawChamber, SHARD_KINDS, updateScene } from './scene';

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

const BASE = { rotation: 0, pan: { x: 0, y: 0 }, sprites, light: false };

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
  it('stamps one sprite per chip', () => {
    const scene = createScene('draw', 7);
    const context = createFakeContext();

    drawChamber(asContext(context), scene, { ...BASE, scale: 100 });

    expect(context.countOf('drawImage')).toBe(7);
  });

  it('draws nothing at a degenerate scale', () => {
    const context = createFakeContext();

    drawChamber(asContext(context), createScene('empty', 5), { ...BASE, scale: 0 });

    expect(context.calls).toHaveLength(0);
  });

  // Glass takes colour out of the light behind it rather than adding its own.
  it('composites the glass subtractively, whatever the light', () => {
    for (const light of [false, true]) {
      const context = createFakeContext();

      drawChamber(asContext(context), createScene('blend', 2), { ...BASE, scale: 50, light });

      expect(context.globalCompositeOperation).toBe('multiply');
    }
  });

  it('thins the glass under a strong light, so more of it comes through', () => {
    const soft = createFakeContext();
    const bright = createFakeContext();

    drawChamber(asContext(soft), createScene('thin', 6), { ...BASE, scale: 60 });
    drawChamber(asContext(bright), createScene('thin', 6), { ...BASE, scale: 60, light: true });

    expect(bright.globalAlpha as number).toBeLessThan(soft.globalAlpha as number);
  });

  it('scales the glass without moving it', () => {
    const scene = createScene('scale', 4);
    const small = createFakeContext();
    const large = createFakeContext();

    drawChamber(asContext(small), scene, { ...BASE, scale: 100, chipScale: 1 });
    drawChamber(asContext(large), scene, { ...BASE, scale: 100, chipScale: 2 });

    expect(large.argsOf('translate')).toEqual(small.argsOf('translate'));
    expect(large.argsOf('drawImage')[0]![3] as number).toBeCloseTo(
      (small.argsOf('drawImage')[0]![3] as number) * 2,
      6,
    );
  });

  it('balances every save with a restore', () => {
    const context = createFakeContext();

    drawChamber(asContext(context), createScene('balance', 6), { ...BASE, scale: 80 });

    expect(context.countOf('save')).toBe(context.countOf('restore'));
  });
});
