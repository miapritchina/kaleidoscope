import { describe, expect, it } from 'vitest';

import { asContext, createFakeContext, type FakeContext } from '../test/fakeCanvas';
import { KaleidoscopeRenderer } from './renderer';
import { createScene } from './scene';
import { DEFAULT_SETTINGS } from './settings';

interface Harness {
  renderer: KaleidoscopeRenderer;
  main: FakeContext;
  /** The surface the mirrors sample, where the trail accumulates. */
  wedge: FakeContext;
  /** Where the six mirrored triangles are assembled into one stamp. */
  hexagon: FakeContext;
  /** Where the source is painted, one frame at a time. */
  source: FakeContext;
  canvas: { width: number; height: number };
  /** Backing store of the hexagon stamp, which the triangle's side sets. */
  hexagonCanvas: { width: number; height: number };
}

function createRenderer(): Harness {
  const main = createFakeContext();
  const offscreen = [createFakeContext(), createFakeContext(), createFakeContext()];
  const canvases: { width: number; height: number }[] = [];

  const canvas = {
    width: 0,
    height: 0,
    getContext: () => asContext(main),
    toDataURL: () => 'data:image/png;base64,stub',
  };

  const createOffscreen = () => {
    const context = offscreen[canvases.length] ?? createFakeContext();
    const surface = {
      width: 0,
      height: 0,
      getContext: () => asContext(context),
    };

    canvases.push(surface);

    return surface as unknown as HTMLCanvasElement;
  };

  const renderer = new KaleidoscopeRenderer(
    canvas as unknown as HTMLCanvasElement,
    createOffscreen,
  );

  return {
    renderer,
    main,
    wedge: offscreen[0]!,
    hexagon: offscreen[1]!,
    source: offscreen[2]!,
    canvas,
    hexagonCanvas: canvases[1]!,
  };
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

  // Six triangles meet at every corner to make the hexagon, alternately
  // mirrored so neighbours always meet mirror to mirror.
  it('assembles the hexagon from six triangles, every other one reflected', () => {
    const { renderer, hexagon } = createRenderer();

    renderer.resize(200, 200, 1);
    renderer.render(createScene('seed', 6), DEFAULT_SETTINGS);

    expect(hexagon.countOf('clip')).toBe(6);
    expect(hexagon.countOf('drawImage')).toBe(6);
    expect(hexagon.argsOf('scale')).toEqual([
      [1, -1],
      [1, -1],
      [1, -1],
    ]);
  });

  // The point of building the hexagon once: the field costs one blit per
  // hexagon, not six clipped draws, however many are on screen.
  it('tiles the field with that one hexagon', () => {
    const { renderer, main } = createRenderer();

    renderer.resize(200, 200, 1);
    renderer.render(createScene('seed', 6), DEFAULT_SETTINGS);

    // Enough to fill the view several times over, and each is a plain blit.
    expect(main.countOf('drawImage')).toBeGreaterThan(6);
    expect(main.countOf('clip')).toBe(0);
  });

  it('stamps more hexagons as the zoom shrinks them', () => {
    const wide = createRenderer();
    const close = createRenderer();

    wide.renderer.resize(200, 200, 1);
    wide.renderer.render(createScene('seed', 6), { ...DEFAULT_SETTINGS, zoom: 0.5 });

    close.renderer.resize(200, 200, 1);
    close.renderer.render(createScene('seed', 6), { ...DEFAULT_SETTINGS, zoom: 3 });

    expect(wide.main.countOf('drawImage')).toBeGreaterThan(close.main.countOf('drawImage'));
  });

  // A real tube's mirrors span the round chamber at the end of it. Hung off the
  // corner the six triangles are assembled around instead, most of the chamber
  // sits outside the view and turning sweeps the pile clean out of it.
  it('inscribes the mirror triangle in the object cell', () => {
    const { renderer, source, hexagonCanvas } = createRenderer();

    renderer.resize(240, 240, 1);
    renderer.render(createScene('seed', 4), DEFAULT_SETTINGS);

    // The hexagon stamp spans the triangle's side either way of its centre,
    // plus the seam bleed, which is what gives the side back.
    const side = hexagonCanvas.width / 2 - 2;
    // First the margin, then the cell. Anything after that is per-chip.
    const [, cell] = source.argsOf('translate') as [unknown, [number, number]];

    // The centroid lies along the triangle's 30-degree bisector, one
    // circumradius out — so the cell reaches all three corners and no further.
    // Within a pixel, since the two surfaces round their own sizes up.
    expect(Math.atan2(cell[1], cell[0])).toBeCloseTo(Math.PI / 6, 6);
    expect(Math.abs(Math.hypot(cell[0], cell[1]) - side / Math.sqrt(3))).toBeLessThan(1);
  });

  // Turning the tube revolves the whole assembly. The chamber is bolted inside
  // it, so it does not counter-rotate — the glass moves because gravity tips
  // it, not because the chamber is turned against the mirrors.
  it('rotates the assembly by the tube angle and leaves the chamber fixed in it', () => {
    const { renderer, main, source } = createRenderer();
    const scene = createScene('seed', 6);
    scene.tube = 0.77;
    scene.contents = 0.77;

    renderer.resize(200, 200, 1);
    renderer.render(scene, DEFAULT_SETTINGS);

    expect(main.argsOf('rotate')).toContainEqual([0.77]);
    expect(source.argsOf('rotate')).toContainEqual([0]);
    expect(source.argsOf('rotate')).not.toContainEqual([0.77]);
  });

  // Three mirrors meeting in a tube have edges, and you can see them. Every
  // triangle boundary lies on one of three families of parallel lines, sixty
  // degrees apart; outlining the triangles instead would stroke every edge
  // twice, once from each side, and leave the joins twice as dark as the rest.
  it('draws the mirror joins as three families of parallel lines', () => {
    const { renderer, main } = createRenderer();

    renderer.resize(240, 240, 1);
    renderer.render(createScene('seed', 6), DEFAULT_SETTINGS);

    // One batched path, so no edge is painted over itself.
    expect(main.countOf('stroke')).toBe(1);

    const starts = main.argsOf('moveTo') as [number, number][];
    const ends = main.argsOf('lineTo') as [number, number][];
    expect(starts).toHaveLength(ends.length);
    expect(starts.length).toBeGreaterThan(3);

    // Directions, folded onto a half turn: a line has no arrowhead.
    const directions = starts.map(([x, y], line) => {
      const [toX, toY] = ends[line]!;
      const angle = Math.atan2(toY - y, toX - x);

      return Math.round((((angle % Math.PI) + Math.PI) % Math.PI) * (180 / Math.PI));
    });

    expect([...new Set(directions)].sort((a, b) => a - b)).toEqual([0, 60, 120]);
  });

  // The mirrors dim the light on its way through; the barrel is in front of
  // them. Two separate things, and they composite differently.
  it('multiplies the view by the mirror falloff, then lays the barrel over it', () => {
    const { renderer, main } = createRenderer();

    renderer.resize(240, 240, 1);
    renderer.render(createScene('seed', 6), DEFAULT_SETTINGS);

    const fills = main.stylesOf('fillRect');
    // The backdrop, the falloff, the barrel.
    expect(fills).toHaveLength(3);
    expect(fills[0]!.globalCompositeOperation).toBe('source-over');
    expect(fills[1]!.globalCompositeOperation).toBe('multiply');
    expect(fills[2]!.globalCompositeOperation).toBe('source-over');
  });

  it('balances every save with a restore', () => {
    const { renderer, main, hexagon } = createRenderer();

    renderer.resize(200, 200, 1);
    renderer.render(createScene('seed', 6), DEFAULT_SETTINGS);

    expect(main.countOf('save')).toBe(main.countOf('restore'));
    expect(hexagon.countOf('save')).toBe(hexagon.countOf('restore'));
  });

  // The glass is stamped subtractively, and `multiply` is not idempotent: a
  // still pile painted over its own remains every frame converges on something
  // far darker than one pass of it. So the trail is a blend of whole frames
  // rather than a fade of the surface they are painted on.
  it('keeps a share of the previous frames when trails are on', () => {
    const smeared = createRenderer();
    const crisp = createRenderer();

    smeared.renderer.resize(200, 200, 1);
    smeared.renderer.render(createScene('seed', 6), { ...DEFAULT_SETTINGS, trails: 0.6 });
    // The second frame: the first goes on opaque, having nothing to blend with.
    smeared.renderer.render(createScene('seed', 6), { ...DEFAULT_SETTINGS, trails: 0.6 });

    crisp.renderer.resize(200, 200, 1);
    crisp.renderer.render(createScene('seed', 6), { ...DEFAULT_SETTINGS, trails: 0 });
    crisp.renderer.render(createScene('seed', 6), { ...DEFAULT_SETTINGS, trails: 0 });

    expect(smeared.wedge.globalAlpha).toBeCloseTo(0.4, 6);
    expect(crisp.wedge.globalAlpha).toBe(1);
    // The source is repainted from scratch either way, never faded in place.
    expect(smeared.source.countOf('fillRect')).toBe(2);
  });

  it('lays the first frame down opaque, so nothing shows through it', () => {
    const { renderer, wedge } = createRenderer();

    renderer.resize(200, 200, 1);
    renderer.render(createScene('seed', 6), { ...DEFAULT_SETTINGS, trails: 0.9 });

    expect(wedge.globalAlpha).toBe(1);
  });

  it('exposes the frame as a data url', () => {
    const { renderer } = createRenderer();

    renderer.resize(50, 50, 1);

    expect(renderer.toDataUrl()).toMatch(/^data:image\/png/);
  });
});
