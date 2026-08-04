import { describe, expect, it } from 'vitest';

import { asContext, createFakeContext, type FakeContext } from '../test/fakeCanvas';
import { KaleidoscopeRenderer } from './renderer';
import { createScene } from './scene';
import { DEFAULT_SETTINGS } from './settings';

interface Harness {
  renderer: KaleidoscopeRenderer;
  main: FakeContext;
  wedge: FakeContext;
  canvas: { width: number; height: number };
}

function createRenderer(): Harness {
  const main = createFakeContext();
  const wedge = createFakeContext();

  const canvas = {
    width: 0,
    height: 0,
    getContext: () => asContext(main),
    toDataURL: () => 'data:image/png;base64,stub',
  };

  const wedgeCanvas = {
    width: 0,
    height: 0,
    getContext: () => asContext(wedge),
  };

  const renderer = new KaleidoscopeRenderer(
    canvas as unknown as HTMLCanvasElement,
    () => wedgeCanvas as unknown as HTMLCanvasElement,
  );

  return { renderer, main, wedge, canvas };
}

describe('KaleidoscopeRenderer', () => {
  it('throws when a 2D context is unavailable', () => {
    const canvas = { getContext: () => null } as unknown as HTMLCanvasElement;

    expect(() => new KaleidoscopeRenderer(canvas)).toThrow(/Canvas 2D context/);
  });

  it('sizes the backing store by the device pixel ratio', () => {
    const { renderer, canvas } = createRenderer();

    renderer.resize(300, 200, 2);

    expect(canvas.width).toBe(600);
    expect(canvas.height).toBe(400);
    expect(renderer.size).toEqual({ width: 600, height: 400 });
  });

  it('clamps the device pixel ratio to keep the fill cost bounded', () => {
    const { renderer } = createRenderer();

    renderer.resize(100, 100, 4);

    expect(renderer.size).toEqual({ width: 200, height: 200 });
  });

  it('treats a ratio below 1 as 1', () => {
    const { renderer } = createRenderer();

    renderer.resize(100, 100, 0.5);

    expect(renderer.size).toEqual({ width: 100, height: 100 });
  });

  it('does nothing when rendering before a resize', () => {
    const { renderer, main } = createRenderer();

    renderer.render(createScene('seed', 4), DEFAULT_SETTINGS);

    expect(main.calls).toHaveLength(0);
  });

  it('blits one wedge per segment', () => {
    const { renderer, main } = createRenderer();

    renderer.resize(200, 200, 1);
    renderer.render(createScene('seed', 6), { ...DEFAULT_SETTINGS, segments: 8 });

    expect(main.countOf('drawImage')).toBe(8);
    expect(main.countOf('clip')).toBe(8);
  });

  it('rounds an odd segment count up to an even one, so mirrors pair off', () => {
    const { renderer, main } = createRenderer();

    renderer.resize(200, 200, 1);
    renderer.render(createScene('seed', 6), { ...DEFAULT_SETTINGS, segments: 7 });

    expect(main.countOf('drawImage')).toBe(8);
  });

  it('mirrors alternate wedges', () => {
    const { renderer, main } = createRenderer();

    renderer.resize(200, 200, 1);
    renderer.render(createScene('seed', 6), { ...DEFAULT_SETTINGS, segments: 8 });

    // Half of the wedges are reflected copies of the other half.
    expect(main.countOf('scale')).toBe(4);
  });

  it('balances every save with a restore', () => {
    const { renderer, main } = createRenderer();

    renderer.resize(200, 200, 1);
    renderer.render(createScene('seed', 6), DEFAULT_SETTINGS);

    expect(main.countOf('save')).toBe(main.countOf('restore'));
  });

  it('fades rather than clears the wedge when trails are on', () => {
    const { renderer, wedge } = createRenderer();

    renderer.resize(200, 200, 1);
    renderer.render(createScene('seed', 6), { ...DEFAULT_SETTINGS, trails: 0.6 });

    expect(wedge.countOf('fillRect')).toBeGreaterThan(0);
  });

  it('exposes the frame as a data url', () => {
    const { renderer } = createRenderer();

    renderer.resize(50, 50, 1);

    expect(renderer.toDataUrl()).toMatch(/^data:image\/png/);
  });
});
