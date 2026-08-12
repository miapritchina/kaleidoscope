import { describe, expect, it } from 'vitest';

import { createSkinPatches, measureSource } from './skin';

/**
 * A picture, as a canvas the module can read back.
 *
 * jsdom has no canvas backend, so `drawImage` and `getImageData` are stubbed
 * with a painter: the picture is described as a function of position and the
 * fake fills the sampled buffer from it.
 */
type Paint = (x: number, y: number) => [number, number, number] | [number, number, number, number];

function picture(width: number, height: number, paint: Paint) {
  const source = { width, height } as unknown as CanvasImageSource;

  const createCanvas = () => {
    let side = 0;

    return {
      set width(value: number) {
        side = value;
      },
      get width() {
        return side;
      },
      height: 0,
      getContext: () => ({
        drawImage: () => undefined,
        getImageData: (_x: number, _y: number, w: number, h: number) => {
          const data = new Uint8ClampedArray(w * h * 4);

          for (let y = 0; y < h; y += 1) {
            for (let x = 0; x < w; x += 1) {
              const [r, g, b, a] = paint(x / w, y / h);
              const i = (y * w + x) * 4;
              data[i] = r;
              data[i + 1] = g;
              data[i + 2] = b;
              data[i + 3] = a ?? 255;
            }
          }

          return { data, width: w, height: h };
        },
      }),
    } as unknown as HTMLCanvasElement;
  };

  return { source, createCanvas };
}

/** Five separate blobs of colour on white, the way a stock photograph is. */
function objects(x: number, y: number): [number, number, number] {
  const spots: [number, number, number][] = [
    [0.2, 0.2, 0.09],
    [0.55, 0.22, 0.07],
    [0.25, 0.62, 0.08],
    [0.72, 0.58, 0.1],
    [0.5, 0.85, 0.06],
  ];

  for (const [cx, cy, r] of spots) {
    if (Math.hypot(x - cx, y - cy) < r) {
      return [40, 20, 140];
    }
  }

  return [250, 250, 250];
}

/** Three long thin objects — enough of them to be worth cutting out. */
function splinters(x: number, y: number): [number, number, number] {
  const bars = [0.2, 0.5, 0.8];

  return x > 0.25 && x < 0.75 && bars.some((at) => Math.abs(y - at) < 0.035)
    ? [30, 30, 30]
    : [250, 250, 250];
}

/** White everywhere except a blob of colour in the lower-right quarter. */
const SUBJECT_ON_WHITE = (x: number, y: number): [number, number, number] =>
  x > 0.6 && y > 0.6 ? [40, 20, 140] : [250, 250, 250];

const NOISE = (x: number, y: number): [number, number, number] => [
  Math.round((Math.sin(x * 37) * 0.5 + 0.5) * 255),
  Math.round((Math.sin(y * 53) * 0.5 + 0.5) * 255),
  Math.round((Math.sin((x + y) * 71) * 0.5 + 0.5) * 255),
];

/**
 * The same five objects, but cut out: transparent everywhere else, and the
 * objects themselves near-black — which by colour alone reads as backdrop.
 */
function cutOutPng(x: number, y: number): [number, number, number, number] {
  const [red] = objects(x, y);

  // White in the photograph is the backdrop, and here it is nothing at all.
  return red === 250 ? [0, 0, 0, 0] : [8, 6, 14, 255];
}

/** Where a spread of pieces would be cut from, as fractions of the travel. */
function spread(paint: Paint, count = 60) {
  const { source, createCanvas } = picture(400, 400, paint);
  const patches = createSkinPatches(source, { patch: 0.26, createCanvas })!;

  return Array.from({ length: count }, (_, index) =>
    patches.pick({ x: (index + 0.5) / count, y: ((index * 0.618) % 1) + 0.001 }),
  );
}

describe('createSkinPatches', () => {
  // The whole reason this exists: a stock photograph is a subject on a plain
  // backdrop, and cutting at random gives a chamber of blank pieces.
  it('draws the pieces from the part of the picture that carries something', () => {
    const onSubject = spread(SUBJECT_ON_WHITE).filter((at) => at.x > 0.5 && at.y > 0.5);

    // Uniformly random, the subject's quarter would take about a quarter of
    // them. Weighted, it takes most.
    expect(onSubject.length / 60).toBeGreaterThan(0.7);
  });

  // Weighted, not collapsed: every piece cut from the single best spot would be
  // a chamber of identical crops, which is worse than the problem.
  it('still spreads them over that part rather than stacking them on one spot', () => {
    const places = new Set(
      spread(SUBJECT_ON_WHITE).map((at) => `${at.x.toFixed(2)},${at.y.toFixed(2)}`),
    );

    expect(places.size).toBeGreaterThan(10);
  });

  // A picture that is busy all over has no backdrop to avoid, and the scoring
  // must not invent one and crowd the pieces into a corner of it.
  it('leaves a picture with no plain backdrop spread out', () => {
    const places = spread(NOISE);
    const left = places.filter((at) => at.x < 0.5).length;

    expect(left).toBeGreaterThan(15);
    expect(left).toBeLessThan(45);
  });

  // A piece keeps its own scrap of picture while it tumbles, which is only true
  // if the same draw always lands in the same place.
  it('sends the same piece to the same patch every time', () => {
    const { source, createCanvas } = picture(400, 400, SUBJECT_ON_WHITE);
    const patches = createSkinPatches(source, { patch: 0.26, createCanvas })!;

    expect(patches.pick({ x: 0.31, y: 0.72 })).toEqual(patches.pick({ x: 0.31, y: 0.72 }));
  });

  it('keeps every patch inside the picture', () => {
    for (const at of spread(SUBJECT_ON_WHITE)) {
      expect(at.x).toBeGreaterThanOrEqual(0);
      expect(at.x).toBeLessThanOrEqual(1);
      expect(at.y).toBeGreaterThanOrEqual(0);
      expect(at.y).toBeLessThanOrEqual(1);
    }
  });

  it('gives up on a picture with no size, rather than dividing by it', () => {
    const { createCanvas } = picture(0, 0, SUBJECT_ON_WHITE);

    expect(
      createSkinPatches({ width: 0, height: 0 } as unknown as CanvasImageSource, {
        patch: 0.26,
        createCanvas,
      }),
    ).toBeNull();
  });

  it('gives up when the picture cannot be read back', () => {
    expect(
      createSkinPatches({ width: 100, height: 100 } as unknown as CanvasImageSource, {
        patch: 0.26,
        createCanvas: () => ({ getContext: () => null }) as unknown as HTMLCanvasElement,
      }),
    ).toBeNull();
  });

  // A cross-origin picture taints the canvas. Not a reason to refuse to draw
  // it, only a reason to cut it at random.
  it('gives up on a picture it is not allowed to read', () => {
    expect(
      createSkinPatches({ width: 100, height: 100 } as unknown as CanvasImageSource, {
        patch: 0.26,
        createCanvas: () =>
          ({
            getContext: () => ({
              drawImage: () => undefined,
              getImageData: () => {
                throw new DOMException('tainted', 'SecurityError');
              },
            }),
          }) as unknown as HTMLCanvasElement,
      }),
    ).toBeNull();
  });
});

describe('cutting objects out of a picture', () => {
  const cuts = (paint: Paint, width = 400, height = 400) => {
    const { source, createCanvas } = picture(width, height, paint);

    return createSkinPatches(source, { patch: 0.26, createCanvas })!.cuts;
  };

  // The point of the whole thing: the pieces are the picture's own objects
  // rather than generated polygons with a scrap of picture inside them.
  it('finds each separate object in the picture', () => {
    expect(cuts(objects)).toHaveLength(5);
  });

  it('traces each one as a closed outline reaching the unit circle', () => {
    for (const cut of cuts(objects)) {
      expect(cut.outline.length).toBeGreaterThan(8);

      // The outline shares its frame with the rectangle the picture is drawn
      // into, and must stay inside it: a clip reaching past the object's own
      // bounding box would show the backdrop beside it.
      for (const point of cut.outline) {
        expect(Math.abs(point.x)).toBeLessThanOrEqual(cut.extent.x + 1e-6);
        expect(Math.abs(point.y)).toBeLessThanOrEqual(cut.extent.y + 1e-6);
      }

      // Something actually reaches out: an outline hugging the middle would
      // clip the picture down to a dot.
      const reach = cut.outline.map((point) => Math.hypot(point.x, point.y));
      expect(Math.max(...reach)).toBeGreaterThan(0.5);
    }
  });

  it('cuts each one from where it actually is in the picture', () => {
    for (const cut of cuts(objects)) {
      expect(cut.source.width).toBeGreaterThan(0);
      expect(cut.source.height).toBeGreaterThan(0);
      expect(cut.source.x).toBeGreaterThanOrEqual(0);
      expect(cut.source.x + cut.source.width).toBeLessThanOrEqual(400 + 1e-6);
      expect(cut.source.y + cut.source.height).toBeLessThanOrEqual(400 + 1e-6);
    }

    // Five objects in five places, not five copies of one rectangle.
    const places = new Set(cuts(objects).map((cut) => `${cut.source.x},${cut.source.y}`));
    expect(places.size).toBe(5);
  });

  // Stretching every object to fill a circle would turn a splinter into a
  // pebble, which is the one thing the shapes are here to avoid.
  it('keeps an object as long and thin as it was', () => {
    const found = cuts(splinters);

    expect(found).toHaveLength(3);

    for (const cut of found) {
      expect(cut.extent.x).toBeCloseTo(1, 5);
      expect(cut.extent.y).toBeLessThan(0.5);
      // And the rectangle it is cut from is the same shape as the object.
      expect(cut.source.width).toBeGreaterThan(cut.source.height * 2);
    }
  });

  // What mass goes with, and what `lib/shape.ts` lays its chain of circles
  // along. A circle the object was cut to fit has area pi, so this over pi is
  // how much of that circle is glass.
  it('reports the area of the silhouette it traced', () => {
    for (const cut of cuts(splinters)) {
      // A bar half the picture long and a fifteenth of it thick, cut to a
      // circle: a small share of one.
      expect(cut.area / Math.PI).toBeLessThan(0.35);
      expect(cut.area).toBeGreaterThan(0);
    }

    for (const cut of cuts(objects)) {
      // A round blob fills most of the circle drawn round it.
      expect(cut.area / Math.PI).toBeGreaterThan(0.5);
    }
  });

  // A landscape has no backdrop to separate objects from, and the whole frame
  // comes back as one blob. Cutting every piece to that silhouette would be a
  // chamber of identical shapes, so this falls back to the patch path instead.
  it('refuses a picture that is all one object', () => {
    expect(cuts(() => [30, 90, 160])).toHaveLength(0);
  });

  it('refuses a picture with too few objects to be worth it', () => {
    expect(cuts(SUBJECT_ON_WHITE)).toHaveLength(0);
  });

  it('ignores specks too small to be anything', () => {
    const speckled = (x: number, y: number): [number, number, number] =>
      Math.hypot(x - 0.5, y - 0.5) < 0.006 ? [0, 0, 0] : objects(x, y);

    expect(cuts(speckled)).toHaveLength(5);
  });

  // A cut-out PNG has already been segmented by whoever made it. Judging it by
  // colour instead punches holes through a dark gem and breaks one into several
  // — or loses it entirely, since near-black is near the transparent ground's
  // own colour.
  it('trusts the alpha channel of a cut-out rather than the colours', () => {
    const found = cuts(cutOutPng);

    expect(found).toHaveLength(5);

    for (const cut of found) {
      const reach = cut.outline.map((point) => Math.hypot(point.x, point.y));
      expect(Math.max(...reach)).toBeGreaterThan(0.5);
    }
  });

  // A photograph has no alpha to trust, and a stray transparent corner is not
  // a cut-out, so the backdrop colour still decides there.
  it('still goes by colour on a picture with no transparency', () => {
    expect(cuts(objects)).toHaveLength(5);
  });

  it('gives the same piece the same object every time', () => {
    const { source, createCanvas } = picture(400, 400, objects);
    const patches = createSkinPatches(source, { patch: 0.26, createCanvas })!;

    expect(patches.cut({ x: 0.42, y: 0.1 })).toBe(patches.cut({ x: 0.42, y: 0.1 }));
  });

  it('spreads the pieces across the objects it found', () => {
    const { source, createCanvas } = picture(400, 400, objects);
    const patches = createSkinPatches(source, { patch: 0.26, createCanvas })!;
    const chosen = new Set(
      Array.from({ length: 40 }, (_, i) => patches.cut({ x: (i + 0.5) / 40, y: 0.5 })),
    );

    expect(chosen.size).toBe(5);
  });

  it('reports no object when there are none to report', () => {
    const { source, createCanvas } = picture(400, 400, SUBJECT_ON_WHITE);

    expect(createSkinPatches(source, { patch: 0.26, createCanvas })!.cut({ x: 0.5, y: 0.5 })).toBe(
      null,
    );
  });
});

describe('measureSource', () => {
  it('reads an image at its own size', () => {
    expect(measureSource({ width: 320, height: 200 } as unknown as CanvasImageSource)).toEqual({
      width: 320,
      height: 200,
    });
  });

  // A video's `width` is its layout size, which is not the size of the frames
  // it is playing — and cutting patches from the wrong one puts every piece in
  // the top-left corner of the feed.
  it('reads a video at its frame size, not its layout size', () => {
    const video = Object.assign(document.createElement('video'), {});
    Object.defineProperty(video, 'videoWidth', { value: 1280 });
    Object.defineProperty(video, 'videoHeight', { value: 720 });
    video.width = 40;
    video.height = 30;

    expect(measureSource(video)).toEqual({ width: 1280, height: 720 });
  });

  it('reports nothing for a source with no size yet', () => {
    expect(measureSource({} as unknown as CanvasImageSource)).toEqual({ width: 0, height: 0 });
  });
});
