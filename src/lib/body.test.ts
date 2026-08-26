import { describe, expect, it } from 'vitest';

import { asContext, createFakeContext, type FakeContext } from '../test/fakeCanvas';
import { KaleidoscopeBody, triangleSideFor, TILE, type BodyOptics } from './body';
import { CHAMBER_DRAG, CHAMBER_RADIUS, type Chamber, type ChamberStep } from './chamber';
import { createGlassChamber } from './glassChamber';
import { frameworkRadians, latticePeriod } from './tiling';

interface Harness {
  body: KaleidoscopeBody;
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

/** A chamber of glass, which is what most of these are looking through. */
function glass(count = 6, seed = 'seed') {
  return createGlassChamber({ seed, count });
}

/**
 * A chamber that records what it is told and paints a square.
 *
 * Everything about the fitting can be checked through one of these, and none
 * of it needs a pile of glass: what the body promises a chamber is the same
 * promise whatever the chamber turns out to be.
 */
function stub(over: Partial<Chamber> = {}) {
  const steps: ChamberStep[] = [];
  const views: { scale: number; rotation: number; pan: { x: number; y: number } }[] = [];

  const chamber: Chamber = {
    ground: '#123456',
    open: false,
    update(step) {
      steps.push({ ...step });
    },
    paint(ctx, view) {
      views.push({ scale: view.scale, rotation: view.rotation, pan: { ...view.pan } });
      ctx.fillRect(-view.scale, -view.scale, view.scale * 2, view.scale * 2);
    },
    ...over,
  };

  return { chamber, steps, views };
}

/** The optics, which is all of the settings a body actually reads. */
const OPTICS: BodyOptics = { zoom: 1, angle: 0, bead: 0 };

function createBody(): Harness {
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

  const body = new KaleidoscopeBody(canvas as unknown as HTMLCanvasElement, createOffscreen);

  return {
    body,
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

describe('KaleidoscopeBody', () => {
  it('throws when a 2D context is unavailable', () => {
    const canvas = { getContext: () => null } as unknown as HTMLCanvasElement;

    expect(() => new KaleidoscopeBody(canvas)).toThrow(/Canvas 2D context/);
  });

  it('sizes the backing store by the device pixel ratio', () => {
    const { body, canvas } = createBody();

    body.resize(300, 200, 2);

    expect(canvas.width).toBe(600);
    expect(canvas.height).toBe(400);
    expect(body.size).toEqual({ width: 600, height: 400 });
  });

  it('clamps the device pixel ratio to keep the fill cost bounded', () => {
    const { body } = createBody();

    body.resize(100, 100, 4);

    expect(body.size).toEqual({ width: 200, height: 200 });
  });

  it('treats a ratio below 1 as 1', () => {
    const { body } = createBody();

    body.resize(100, 100, 0.5);

    expect(body.size).toEqual({ width: 100, height: 100 });
  });

  it('does nothing when rendering before a resize', () => {
    const { body, main } = createBody();

    body.render(glass(4), OPTICS);

    expect(main.calls).toHaveLength(0);
  });

  // Six triangles meet at every corner to make the hexagon, alternately
  // mirrored so neighbours always meet mirror to mirror.
  it('assembles the hexagon from six triangles, every other one reflected', () => {
    const { body, hexagon } = createBody();

    body.resize(200, 200, 1);
    body.render(glass(6), OPTICS);

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
    const { body, main } = createBody();

    body.resize(200, 200, 1);
    body.render(glass(6), OPTICS);

    // Enough to fill the view several times over, and each is a plain blit.
    expect(main.countOf('drawImage')).toBeGreaterThan(6);
    expect(main.countOf('clip')).toBe(0);
  });

  it('stamps more hexagons as the zoom shrinks them', () => {
    const wide = createBody();
    const close = createBody();

    wide.body.resize(200, 200, 1);
    wide.body.render(glass(6), { ...OPTICS, zoom: 0.5 });

    close.body.resize(200, 200, 1);
    close.body.render(glass(6), { ...OPTICS, zoom: 3 });

    expect(wide.main.countOf('drawImage')).toBeGreaterThan(close.main.countOf('drawImage'));
  });

  // A real tube's mirrors span the round chamber at the end of it. Hung off the
  // corner the six triangles are assembled around instead, most of the chamber
  // sits outside the view and turning sweeps the pile clean out of it.
  it('inscribes the mirror triangle in the object cell', () => {
    const { body, wedge, hexagonCanvas } = createBody();

    body.resize(240, 240, 1);
    body.render(glass(4), OPTICS);

    // The hexagon stamp spans the triangle's side either way of its centre,
    // plus the seam bleed, which is what gives the side back.
    const side = hexagonCanvas.width / 2 - 2;
    // One move: to the triangle's apex, and the triangle's own centre past it.
    // Anything after that is the chamber's own doing.
    const [placed] = wedge.argsOf('translate') as [[number, number]];
    const apex = { x: 2, y: 2 + Math.ceil(side / (2 * Math.sqrt(3))) };
    const cell = [placed[0] - apex.x, placed[1] - apex.y] as const;

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
    const { body, main, wedge } = createBody();
    const chamber = glass(6);

    body.resize(200, 200, 1);
    body.step(chamber, { dt: 1 / 20, turn: 0.77 * 20, drag: { x: 0, y: 0 }, tilt: 0, angle: 0 });
    body.render(chamber, OPTICS);

    expect(body.bearing).toBeCloseTo(0.77, 12);
    expect(wedge.argsOf('rotate')).toContainEqual([0.77]);
    expect(main.argsOf('rotate')).not.toContainEqual([0.77]);
  });

  // The joins are part of the framework, so they hold still with it. Drawn
  // inside the turning cell they would sweep across the glass like a fan.
  it('holds the mirror joins still as the cell turns', () => {
    const still = createBody();
    const turned = createBody();
    const scene = glass(6);
    const spun = glass(6);

    still.body.resize(240, 240, 1);
    still.body.render(scene, OPTICS);

    turned.body.resize(240, 240, 1);
    turned.body.step(spun, {
      dt: 1 / 20,
      turn: 0.9 * 20,
      drag: { x: 0, y: 0 },
      tilt: 0,
      angle: 0,
    });
    turned.body.render(spun, OPTICS);

    expect(turned.main.argsOf('moveTo')).toEqual(still.main.argsOf('moveTo'));
    expect(turned.main.argsOf('lineTo')).toEqual(still.main.argsOf('lineTo'));
  });

  // Three mirrors meeting in a tube have edges, and you can see them. Every
  // triangle boundary lies on one of three families of parallel lines, sixty
  // degrees apart; outlining the triangles instead would stroke every edge
  // twice, once from each side, and leave the joins twice as dark as the rest.
  it('draws the mirror joins as three families of parallel lines', () => {
    const { body, main } = createBody();

    body.resize(240, 240, 1);
    body.render(glass(6), OPTICS);

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

  // Every hexagon differs from its neighbours, or the field reads as a printed
  // pattern. The middle one included: it is stamped at the lattice origin, and
  // a hash with a fixed point there leaves it at full brightness while all its
  // neighbours are dimmed — a hole punched through the middle of the figure,
  // and one only the 2D path can show, since the shader shades per pixel. The
  // body takes `cellNoise` from `lib/fold.ts` rather than keeping a copy, so
  // there is only one of these to get right.
  it('dims every hexagon it stamps, the one in the middle included', () => {
    const { body, main } = createBody();

    body.resize(240, 240, 1);
    body.render(glass(6), OPTICS);

    const stamps = main.stylesOf('drawImage');

    expect(stamps.length).toBeGreaterThan(6);

    for (const stamp of stamps) {
      expect(stamp.globalAlpha).toBeLessThan(1);
      expect(stamp.globalAlpha).toBeGreaterThan(0.9);
    }
  });

  // The mirrors dim the light on its way through; the barrel is in front of
  // them. Two separate things, and they composite differently.
  it('multiplies the view by the mirror falloff, then lays the barrel over it', () => {
    const { body, main } = createBody();

    body.resize(240, 240, 1);
    body.render(glass(6), OPTICS);

    const fills = main.stylesOf('fillRect');
    // The backdrop, the falloff, the barrel.
    expect(fills).toHaveLength(3);
    expect(fills[0]!.globalCompositeOperation).toBe('source-over');
    expect(fills[1]!.globalCompositeOperation).toBe('multiply');
    expect(fills[2]!.globalCompositeOperation).toBe('source-over');
  });

  it('balances every save with a restore', () => {
    const { body, main, hexagon } = createBody();

    body.resize(200, 200, 1);
    body.render(glass(6), OPTICS);

    expect(main.countOf('save')).toBe(main.countOf('restore'));
    expect(hexagon.countOf('save')).toBe(hexagon.countOf('restore'));
  });

  // The pieces composite with `multiply` and `lighter`, neither of which is
  // idempotent, so a still pile stamped over its own remains walks away from a
  // single pass of it. Every frame is painted from scratch.
  it('repaints the source rather than drawing over what is there', () => {
    const { body, wedge } = createBody();

    body.resize(200, 200, 1);
    body.render(glass(6), OPTICS);
    body.render(glass(6), OPTICS);

    // The ground laid down afresh each time, and never at part opacity.
    expect(wedge.countOf('fillRect')).toBe(2);
    expect(wedge.globalAlpha).toBe(1);
  });

  // Which way up the tube is being held. It stays put while the cell turns
  // under it, so it reads as the instrument's attitude and not as motion.
  it('turns the whole framework by the mirror angle', () => {
    const { body, main } = createBody();

    body.resize(240, 240, 1);
    body.render(glass(6), { ...OPTICS, angle: 30 });

    expect(main.argsOf('rotate')).toContainEqual([frameworkRadians(30)]);
  });

  // Zero is not an unrotated field: it is the turn that stands the source
  // triangle on its base, which is what zero degrees means on the slider.
  it('stands the triangle on its base at zero, which is the default', () => {
    const { body, main } = createBody();

    body.resize(240, 240, 1);
    body.render(glass(6), OPTICS);

    expect(main.argsOf('rotate')).toEqual([[frameworkRadians(0)]]);
  });

  it('exposes the frame as a data url', () => {
    const { body } = createBody();

    body.resize(50, 50, 1);

    expect(body.toDataUrl()).toMatch(/^data:image\/png/);
  });
});

/**
 * The fitting itself: what the body promises whatever is in the chamber.
 *
 * These are the tests that keep the two parts apart. Every one of them is run
 * against a chamber that is not the app's — if any of them can only be made to
 * pass by the body knowing what is inside, the separation has gone.
 */
describe('the body and its chamber', () => {
  // The whole of what the instrument does to what is inside it, and the one
  // piece of arithmetic the body does on the chamber's behalf.
  it('composes gravity out of the bearing, the framework and the tilt', () => {
    const { body } = createBody();
    const { chamber, steps } = stub();

    body.resize(200, 200, 1);
    body.step(chamber, {
      dt: 1 / 20,
      turn: 8,
      drag: { x: 0, y: 0 },
      tilt: 0.25,
      angle: 30,
    });

    expect(steps).toHaveLength(1);
    // A fifth of a radian of bearing, plus the framework, plus the tilt.
    expect(body.bearing).toBeCloseTo(0.4, 12);
    expect(steps[0]!.gravity).toBeCloseTo(0.4 + frameworkRadians(30) + 0.25, 12);
  });

  // Turning the body turns the mirrors and the chamber together, so the
  // chamber's own bearing is untouched by it — but gravity is not, because the
  // chamber is drawn inside the framework.
  it('leaves the bearing alone when only the framework is turned', () => {
    const { body } = createBody();
    const { chamber, steps } = stub();

    body.resize(200, 200, 1);
    body.step(chamber, { dt: 1, turn: 0, drag: { x: 0, y: 0 }, tilt: 0, angle: 90 });

    expect(body.bearing).toBe(0);
    expect(steps[0]!.gravity).toBeCloseTo(frameworkRadians(90), 12);
  });

  // Turning the chamber turns only the chamber. The mirrors do not move, and
  // the figure's framework does not either.
  it('turns the chamber alone when the chamber is turned', () => {
    const { body } = createBody();
    const { chamber, views } = stub();

    body.resize(200, 200, 1);
    body.step(chamber, { dt: 1 / 20, turn: 20, drag: { x: 0, y: 0 }, tilt: 0, angle: 0 });
    body.render(chamber, OPTICS);

    expect(body.bearing).toBeCloseTo(1, 12);
    expect(views[0]!.rotation).toBeCloseTo(1, 12);
  });

  /**
   * The claim the whole instrument rests on, stated as arithmetic.
   *
   * Gravity keeps pointing at the floor whatever is turned. A direction `g` in
   * the chamber's frame is drawn on screen at `g` less the two rotations the
   * figure passes through — the chamber's bearing and the mirrors' framework —
   * because a direction here is measured from straight down, and turning the
   * frame it is measured in turns it backwards. So whatever is turned, the
   * floor comes out at the tilt, and at nothing else.
   */
  it('leaves the floor where the room puts it, whatever is turned', () => {
    for (const [turn, angle, tilt] of [
      [0, 0, 0],
      [6, 0, 0],
      [0, 47, 0],
      [-4, -73, 0],
      [6, 47, 0.3],
      [-2, 180, -1.1],
    ] as const) {
      const { body } = createBody();
      const { chamber, steps } = stub();

      body.resize(200, 200, 1);
      body.step(chamber, { dt: 1 / 20, turn, drag: { x: 0, y: 0 }, tilt, angle });

      const onScreen = steps[0]!.gravity - body.bearing - frameworkRadians(angle);

      expect(onScreen, `turn ${String(turn)} angle ${String(angle)}`).toBeCloseTo(tilt, 12);
    }
  });

  // A tab left in the background comes back with a minute's worth of frame in
  // hand. Handed on at face value, a chamber would teleport its contents.
  it('clamps a long frame before any chamber sees it', () => {
    const { body } = createBody();
    const { chamber, steps } = stub();

    body.resize(200, 200, 1);
    body.step(chamber, { dt: 30, turn: 0, drag: { x: 0, y: 0 }, tilt: 0, angle: 0 });
    body.step(chamber, { dt: -5, turn: 0, drag: { x: 0, y: 0 }, tilt: 0, angle: 0 });

    expect(steps[0]!.dt).toBeCloseTo(1 / 20, 12);
    expect(steps[1]!.dt).toBe(0);
  });

  // The cell reaches all three corners of the triangle and no further, so
  // everything a chamber simulates has a chance of being seen and nothing is
  // simulated that never could be.
  it('scales the chamber so its wall touches the triangle corners', () => {
    const { body } = createBody();
    const { chamber, views } = stub();

    body.resize(240, 240, 1);
    body.render(chamber, OPTICS);

    const side = triangleSideFor(240, 240, 1);

    expect(views[0]!.scale * CHAMBER_RADIUS).toBeCloseTo(side / Math.sqrt(3), 6);
  });

  it("hands a cell its drag at a cell's worth of travel", () => {
    const { body } = createBody();
    const { chamber, views } = stub();

    body.resize(240, 240, 1);
    body.step(chamber, { dt: 0, turn: 0, drag: { x: 1, y: -0.5 }, tilt: 0, angle: 0 });
    body.render(chamber, OPTICS);

    expect(views[0]!.pan).toEqual({ x: CHAMBER_DRAG, y: -CHAMBER_DRAG / 2 });
  });

  // The chamber says what it is lit against, and the body covers the whole
  // surface with it — not just the triangle. The optics sample outside the
  // triangle's own reach, and unpainted pixels came back as holes.
  it('covers the whole surface with the ground the chamber asks for', () => {
    const { body, wedge } = createBody();
    const { chamber } = stub({ ground: 'rgb(1 2 3)' });

    body.resize(200, 200, 1);
    body.render(chamber, OPTICS);

    const [ground] = wedge.stylesOf('fillRect');

    expect(ground?.fillStyle).toBe('rgb(1 2 3)');
  });

  // A chamber may leave the context in any state it likes. That is the body's
  // problem, not the next frame's.
  it('puts the context back after a chamber that wrecks it', () => {
    const { body, wedge } = createBody();
    const { chamber } = stub({
      paint(ctx) {
        ctx.save();
        ctx.globalAlpha = 0.2;
        ctx.globalCompositeOperation = 'lighter';
        ctx.rotate(1);
      },
    });

    body.resize(200, 200, 1);
    body.render(chamber, OPTICS);

    expect(wedge.globalAlpha).toBe(1);
    expect(wedge.globalCompositeOperation).toBe('source-over');
  });

  it('survives a chamber that throws, and still composites the frame', () => {
    const { body, main } = createBody();
    const { chamber } = stub({
      paint() {
        throw new Error('this chamber is broken');
      },
    });

    body.resize(200, 200, 1);

    expect(() => {
      body.render(chamber, OPTICS);
    }).toThrow(/broken/);

    // And the surface is not left mid-transform for the next frame.
    body.render(stub().chamber, OPTICS);
    expect(main.countOf('save')).toBe(main.countOf('restore'));
  });

  // A bead is a marble over the objective, and a cell that caps the tube has no
  // objective to put one over. The chamber answers for itself.
  it('puts the bead over an open chamber and never over a closed one', () => {
    const closed = createBody();
    const open = createBody();

    closed.body.resize(200, 200, 1);
    closed.body.render(stub({ open: false }).chamber, { ...OPTICS, bead: 1 });

    open.body.resize(200, 200, 1);
    open.body.render(stub({ open: true }).chamber, { ...OPTICS, bead: 1 });

    // Without a shader there is nothing to read the bead off but the fact that
    // neither path fell over; the shader carries it as a uniform. What can be
    // checked here is that `open` is the only thing that decides.
    expect(closed.main.countOf('drawImage')).toBeGreaterThan(0);
    expect(open.main.countOf('drawImage')).toBeGreaterThan(0);
  });
});

/**
 * Folding a finger on the figure back into the chamber.
 *
 * The screen shows one triangle of chamber and a field of its reflections, so
 * a finger is almost never over the chamber itself.
 */
describe('probe', () => {
  const upright: BodyOptics = { zoom: 1, angle: 0, bead: 0 };
  // Zero on the mirror-angle slider carries a sixty-degree upright turn (see
  // frameworkRadians), so these hold the framework at a true zero to test the
  // scale and the bearing on their own.
  const flat: BodyOptics = { zoom: 1, angle: -60, bead: 0 };

  function sized() {
    const harness = createBody();

    harness.body.resize(1000, 1000, 1);

    return harness.body;
  }

  it('maps the middle of the stage to the middle of the chamber', () => {
    const at = sized().probe({ x: 500, y: 500 }, upright);

    expect(Math.hypot(at.x, at.y)).toBeLessThan(0.01);
  });

  it('maps an offset to cell units through the triangle scale', () => {
    const side = triangleSideFor(1000, 1000, 1);
    const scale = side / Math.sqrt(3) / CHAMBER_RADIUS;
    const at = sized().probe({ x: 500 + scale * 0.5, y: 500 }, flat);

    expect(at.x).toBeCloseTo(0.5, 1);
    expect(at.y).toBeCloseTo(0, 1);
  });

  /**
   * The claim the stir reading rests on, and the reason `probe` stops where it
   * does. A finger resting on the glass of a tube being turned under it has
   * not moved, and the point it reads back must not move either — differenced
   * after the bearing had been divided out, a still finger reported more stir
   * than the wax can manage on its own, pointed against the turn, everywhere
   * at once, for as long as it was held. Carrying the reading the rest of the
   * way is `trackStir`'s, once the differencing is done.
   */
  it('does not move a still finger when the chamber turns under it', () => {
    const body = sized();
    const at = { x: 620, y: 470 };
    const before = body.probe(at, flat);

    // Turned both ways, and never back to where it started.
    for (const turn of [2, -6, 5]) {
      body.step(stub().chamber, {
        dt: 1 / 20,
        turn,
        drag: { x: 0, y: 0 },
        tilt: 0,
        angle: -60,
      });

      const after = body.probe(at, flat);

      expect(body.bearing).not.toBe(0);
      expect(after.x).toBeCloseTo(before.x, 12);
      expect(after.y).toBeCloseTo(before.y, 12);
    }
  });

  it('folds a finger far out on the field back into the chamber', () => {
    // Anywhere on the stage: the point is over some reflection of the chamber,
    // and the fold carries it home. Never outside the wall.
    const body = sized();

    for (const point of [
      { x: 30, y: 40 },
      { x: 950, y: 100 },
      { x: 80, y: 900 },
      { x: 990, y: 990 },
    ]) {
      const at = body.probe(point, upright);

      expect(Math.hypot(at.x, at.y)).toBeLessThanOrEqual(CHAMBER_RADIUS + 1e-6);
    }
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
    const { body } = createBody();

    body.resize(200, 200, 1);

    await expect(body.toPatternBlob()).resolves.toBeNull();
  });

  // On screen every hexagon is laid down at a slightly different exposure, so
  // the field does not read as a printed pattern. Here a printed pattern is
  // exactly what is wanted, and that variation is the one thing standing
  // between the field and an exact repeat.
  it('stamps every hexagon at the same exposure, unlike the screen', async () => {
    const { body, main, tile } = createBody();

    body.resize(200, 200, 1);
    body.render(glass(6), OPTICS);
    await body.toPatternBlob();

    const onTile = tile.stylesOf('drawImage').map((style) => style.globalAlpha);
    const onScreen = main.stylesOf('drawImage').map((style) => style.globalAlpha);

    expect(onTile.length).toBeGreaterThan(1);
    expect(onTile.every((alpha) => alpha === 1)).toBe(true);
    expect(onScreen.some((alpha) => alpha !== 1)).toBe(true);
  });

  // Radial, both of them: they describe looking down a tube rather than the
  // pattern, and baked in they would put a dark blot at every repeat.
  it('leaves the barrel and the mirror falloff off it', async () => {
    const { body, tile } = createBody();

    body.resize(200, 200, 1);
    body.render(glass(6), OPTICS);
    await body.toPatternBlob();

    // The backdrop, and nothing laid over the top of the field.
    expect(tile.countOf('fillRect')).toBe(1);
    expect(tile.stylesOf('fillRect')[0]!.globalCompositeOperation).toBe('source-over');
  });

  // The tile is a fixed size and the triangle on screen is whatever the
  // viewport and the slider make it, so the source is painted again at the
  // tile's size rather than scaled up from the screen's.
  it('paints the source again at its own size, and puts the surface back', async () => {
    const { body, wedge, wedgeCanvas } = createBody();

    body.resize(200, 200, 1);
    body.render(glass(6), OPTICS);

    const forScreen = wedgeCanvas.width;
    const painted = wedge.countOf('fillRect');

    await body.toPatternBlob();

    // Painted a second time, on a surface big enough for a tile-sized triangle.
    expect(wedge.countOf('fillRect')).toBe(painted + 1);
    expect(wedgeCanvas.width).toBe(forScreen);
  });

  // The period is a rectangle of the lattice's own, and a rotated one does not
  // line up with the sides of a picture. How you are holding the tube is not a
  // property of the pattern.
  it('is stamped upright however the instrument is being held', async () => {
    const { body, tile } = createBody();

    body.resize(240, 240, 1);
    body.render(glass(6), { ...OPTICS, angle: 30 });
    await body.toPatternBlob();

    expect(tile.argsOf('rotate')).toEqual([[0]]);
  });

  it('sizes the tile to the period, whatever the viewport is', async () => {
    const { body, tileCanvas } = createBody();

    body.resize(90, 320, 1);
    body.render(glass(6), OPTICS);
    await body.toPatternBlob();

    expect(tileCanvas()).toMatchObject({ width: TILE.width, height: TILE.height });
  });
});
