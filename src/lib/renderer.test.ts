import { describe, expect, it } from 'vitest';

import { asContext, createFakeContext, type FakeContext } from '../test/fakeCanvas';
import { KaleidoscopeRenderer, TILE } from './renderer';
import { createScene } from './scene';
import { DEFAULT_SETTINGS } from './settings';
import { latticePeriod } from './tiling';

interface Harness {
  renderer: KaleidoscopeRenderer;
  main: FakeContext;
  /** The surface the mirrors sample, which the source is painted onto. */
  wedge: FakeContext;
  /** Where the six mirrored triangles are assembled into one stamp. */
  hexagon: FakeContext;
  /** Where the exported tile is stamped. */
  tile: FakeContext;
  canvas: { width: number; height: number };
  /** Backing store of the wedge, sized for the largest triangle wanted. */
  wedgeCanvas: { width: number; height: number };
  /** Backing store of the hexagon stamp, which the triangle's side sets. */
  hexagonCanvas: { width: number; height: number };
  /** Backing store of the tile, made only once one is asked for. */
  tileCanvas: () => { width: number; height: number } | undefined;
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
      toBlob: (done: (blob: Blob | null) => void) => {
        done(new Blob([], { type: 'image/png' }));
      },
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
    canvas,
    wedgeCanvas: canvases[0]!,
    hexagonCanvas: canvases[1]!,
    /** The exported tile's surface, made the first time one is asked for. */
    tile: offscreen[2]!,
    tileCanvas: () => canvases[2],
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
    const { renderer, wedge, hexagonCanvas } = createRenderer();

    renderer.resize(240, 240, 1);
    renderer.render(createScene('seed', 4), DEFAULT_SETTINGS);

    // The hexagon stamp spans the triangle's side either way of its centre,
    // plus the seam bleed, which is what gives the side back.
    const side = hexagonCanvas.width / 2 - 2;
    // First the margin, then the cell. Anything after that is per-chip.
    const [, cell] = wedge.argsOf('translate') as [unknown, [number, number]];

    // The centroid lies along the triangle's 30-degree bisector, one
    // circumradius out — so the cell reaches all three corners and no further.
    // Within a pixel, since the two surfaces round their own sizes up.
    expect(Math.atan2(cell[1], cell[0])).toBeCloseTo(Math.PI / 6, 6);
    expect(Math.abs(Math.hypot(cell[0], cell[1]) - side / Math.sqrt(3))).toBeLessThan(1);
  });

  // The mirrors are fixed in the barrel and the cell of glass turns against
  // them, which is how plenty of real ones are built. Turning the whole
  // framework instead sweeps the figure around the screen, which reads as a
  // picture being spun rather than an instrument being worked.
  it('turns the cell and leaves the mirror framework where it is', () => {
    const { renderer, main, wedge } = createRenderer();
    const scene = createScene('seed', 6);
    scene.cell = 0.77;
    scene.contents = 0.77;

    renderer.resize(200, 200, 1);
    renderer.render(scene, DEFAULT_SETTINGS);

    expect(wedge.argsOf('rotate')).toContainEqual([0.77]);
    expect(main.argsOf('rotate')).not.toContainEqual([0.77]);
  });

  // The joins are part of the framework, so they hold still with it. Drawn
  // inside the turning cell they would sweep across the glass like a fan.
  it('holds the mirror joins still as the cell turns', () => {
    const still = createRenderer();
    const turned = createRenderer();
    const scene = createScene('seed', 6);
    const spun = createScene('seed', 6);
    spun.cell = 0.9;

    still.renderer.resize(240, 240, 1);
    still.renderer.render(scene, DEFAULT_SETTINGS);

    turned.renderer.resize(240, 240, 1);
    turned.renderer.render(spun, DEFAULT_SETTINGS);

    expect(turned.main.argsOf('moveTo')).toEqual(still.main.argsOf('moveTo'));
    expect(turned.main.argsOf('lineTo')).toEqual(still.main.argsOf('lineTo'));
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

  // The pieces composite with `multiply` and `lighter`, neither of which is
  // idempotent, so a still pile stamped over its own remains walks away from a
  // single pass of it. Every frame is painted from scratch.
  it('repaints the source rather than drawing over what is there', () => {
    const { renderer, wedge } = createRenderer();

    renderer.resize(200, 200, 1);
    renderer.render(createScene('seed', 6), DEFAULT_SETTINGS);
    renderer.render(createScene('seed', 6), DEFAULT_SETTINGS);

    // The ground laid down afresh each time, and never at part opacity.
    expect(wedge.countOf('fillRect')).toBe(2);
    expect(wedge.globalAlpha).toBe(1);
  });

  // Which way up the tube is being held. It stays put while the cell turns
  // under it, so it reads as the instrument's attitude and not as motion.
  it('turns the whole framework by the mirror angle', () => {
    const { renderer, main } = createRenderer();

    renderer.resize(240, 240, 1);
    renderer.render(createScene('seed', 6), { ...DEFAULT_SETTINGS, angle: 30 });

    expect(main.argsOf('rotate')).toContainEqual([Math.PI / 6]);
  });

  it('leaves it alone at zero, which is the default', () => {
    const { renderer, main } = createRenderer();

    renderer.resize(240, 240, 1);
    renderer.render(createScene('seed', 6), DEFAULT_SETTINGS);

    expect(main.argsOf('rotate')).toEqual([[0]]);
  });

  it('exposes the frame as a data url', () => {
    const { renderer } = createRenderer();

    renderer.resize(50, 50, 1);

    expect(renderer.toDataUrl()).toMatch(/^data:image\/png/);
  });
});

describe('the exported tile', () => {
  // The whole claim rests on this: the tile is a period of the field, so its
  // proportions have to be the lattice's own. Anything else and the copies do
  // not line up, however carefully the edges are treated.
  it('is one period of the lattice across and one down', () => {
    const period = latticePeriod(TILE.width / 3);

    expect(period.x).toBe(TILE.width);
    // Whole pixels cannot be sqrt(3) apart exactly. Two parts in ten million
    // is what 1351/780 costs, which over the whole width is invisible.
    expect(Math.abs(period.y - TILE.height)).toBeLessThan(0.001);
  });

  it('has nothing to cut before the first frame', async () => {
    const { renderer } = createRenderer();

    renderer.resize(200, 200, 1);

    await expect(renderer.toPatternBlob()).resolves.toBeNull();
  });

  // On screen every hexagon is laid down at a slightly different exposure, so
  // the field does not read as a printed pattern. Here a printed pattern is
  // exactly what is wanted, and that variation is the one thing standing
  // between the field and an exact repeat.
  it('stamps every hexagon at the same exposure, unlike the screen', async () => {
    const { renderer, main, tile } = createRenderer();

    renderer.resize(200, 200, 1);
    renderer.render(createScene('seed', 6), DEFAULT_SETTINGS);
    await renderer.toPatternBlob();

    const onTile = tile.stylesOf('drawImage').map((style) => style.globalAlpha);
    const onScreen = main.stylesOf('drawImage').map((style) => style.globalAlpha);

    expect(onTile.length).toBeGreaterThan(1);
    expect(onTile.every((alpha) => alpha === 1)).toBe(true);
    expect(onScreen.some((alpha) => alpha !== 1)).toBe(true);
  });

  // Radial, both of them: they describe looking down a tube rather than the
  // pattern, and baked in they would put a dark blot at every repeat.
  it('leaves the barrel and the mirror falloff off it', async () => {
    const { renderer, tile } = createRenderer();

    renderer.resize(200, 200, 1);
    renderer.render(createScene('seed', 6), DEFAULT_SETTINGS);
    await renderer.toPatternBlob();

    // The backdrop, and nothing laid over the top of the field.
    expect(tile.countOf('fillRect')).toBe(1);
    expect(tile.stylesOf('fillRect')[0]!.globalCompositeOperation).toBe('source-over');
  });

  // The tile is a fixed size and the triangle on screen is whatever the
  // viewport and the slider make it, so the source is painted again at the
  // tile's size rather than scaled up from the screen's.
  it('paints the source again at its own size, and puts the surface back', async () => {
    const { renderer, wedge, wedgeCanvas } = createRenderer();

    renderer.resize(200, 200, 1);
    renderer.render(createScene('seed', 6), DEFAULT_SETTINGS);

    const forScreen = wedgeCanvas.width;
    const painted = wedge.countOf('fillRect');

    await renderer.toPatternBlob();

    // Painted a second time, on a surface big enough for a tile-sized triangle.
    expect(wedge.countOf('fillRect')).toBe(painted + 1);
    expect(wedgeCanvas.width).toBe(forScreen);
  });

  // The period is a rectangle of the lattice's own, and a rotated one does not
  // line up with the sides of a picture. How you are holding the tube is not a
  // property of the pattern.
  it('is stamped upright however the instrument is being held', async () => {
    const { renderer, tile } = createRenderer();

    renderer.resize(240, 240, 1);
    renderer.render(createScene('seed', 6), { ...DEFAULT_SETTINGS, angle: 30 });
    await renderer.toPatternBlob();

    expect(tile.argsOf('rotate')).toEqual([[0]]);
  });

  it('sizes the tile to the period, whatever the viewport is', async () => {
    const { renderer, tileCanvas } = createRenderer();

    renderer.resize(90, 320, 1);
    renderer.render(createScene('seed', 6), DEFAULT_SETTINGS);
    await renderer.toPatternBlob();

    expect(tileCanvas()).toMatchObject({ width: TILE.width, height: TILE.height });
  });
});
