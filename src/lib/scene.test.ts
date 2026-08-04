import { describe, expect, it } from 'vitest';

import { asContext, createFakeContext } from '../test/fakeCanvas';
import { createColorRamp } from './colorRamp';
import { getPalette } from './palettes';
import { createScene, drawCell, SHARD_KINDS, updateScene } from './scene';

const ramp = createColorRamp(getPalette('aurora'));

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
  const pointer = { x: 0, y: 0 };

  it('keeps shard positions wrapped into the unit cell', () => {
    const scene = createScene('wrap', 20);

    for (let i = 0; i < 400; i += 1) {
      updateScene(scene, { dt: 0.05, speed: 0.2, pointer });
    }

    for (const shard of scene.shards) {
      expect(shard.x).toBeGreaterThanOrEqual(0);
      expect(shard.x).toBeLessThan(1);
      expect(shard.colorStop).toBeGreaterThanOrEqual(0);
      expect(shard.colorStop).toBeLessThan(1);
    }
  });

  it('rotates by speed x 2pi per second', () => {
    const scene = createScene('spin', 4);

    updateScene(scene, { dt: 0.05, speed: 1, pointer });

    expect(scene.rotation).toBeCloseTo(Math.PI * 2 * 0.05, 6);
  });

  it('spins backwards for a negative speed', () => {
    const scene = createScene('spin', 4);

    updateScene(scene, { dt: 0.05, speed: -1, pointer });

    expect(scene.rotation).toBeLessThan(0);
  });

  it('clamps an oversized frame so a backgrounded tab cannot jump', () => {
    const scene = createScene('clamp', 4);

    updateScene(scene, { dt: 30, speed: 1, pointer });

    expect(scene.elapsed).toBeCloseTo(1 / 20, 6);
  });

  it('ignores negative time steps', () => {
    const scene = createScene('negative', 4);

    updateScene(scene, { dt: -5, speed: 1, pointer });

    expect(scene.elapsed).toBe(0);
    expect(scene.rotation).toBe(0);
  });

  it('lets the pointer steer the pan', () => {
    const left = createScene('pan', 4);
    const right = createScene('pan', 4);

    updateScene(left, { dt: 0.1, speed: 0, pointer: { x: -1, y: 0 } });
    updateScene(right, { dt: 0.1, speed: 0, pointer: { x: 1, y: 0 } });

    expect(right.pan.x).toBeGreaterThan(left.pan.x);
  });
});

describe('drawCell', () => {
  it('tiles the cell to cover the region', () => {
    const scene = createScene('tiles', 3);

    const zoomedOut = createFakeContext();
    drawCell(asContext(zoomedOut), scene, { size: 400, cellSize: 200, ramp, glow: false });

    const zoomedIn = createFakeContext();
    drawCell(asContext(zoomedIn), scene, { size: 400, cellSize: 400, ramp, glow: false });

    // A smaller cell needs more tiles, so more shards get drawn.
    expect(zoomedOut.countOf('translate')).toBeGreaterThan(zoomedIn.countOf('translate'));
  });

  it('draws nothing for a degenerate region', () => {
    const scene = createScene('empty', 5);
    const context = createFakeContext();

    drawCell(asContext(context), scene, { size: 0, cellSize: 100, ramp, glow: false });
    drawCell(asContext(context), scene, { size: 100, cellSize: 0, ramp, glow: false });

    expect(context.calls).toHaveLength(0);
  });

  it('switches to additive blending when glow is on', () => {
    const scene = createScene('glow', 2);
    const context = createFakeContext();

    drawCell(asContext(context), scene, { size: 100, cellSize: 100, ramp, glow: true });

    expect(context.globalCompositeOperation).toBe('lighter');
  });

  it('balances every save with a restore', () => {
    const scene = createScene('balance', 6);
    const context = createFakeContext();

    drawCell(asContext(context), scene, { size: 200, cellSize: 150, ramp, glow: false });

    expect(context.countOf('save')).toBe(context.countOf('restore'));
  });
});
