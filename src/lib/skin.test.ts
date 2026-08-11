import { describe, expect, it } from 'vitest';

import { createSkinPatches, measureSource } from './skin';

/**
 * A picture, as a canvas the module can read back.
 *
 * jsdom has no canvas backend, so `drawImage` and `getImageData` are stubbed
 * with a painter: the picture is described as a function of position and the
 * fake fills the sampled buffer from it.
 */
function picture(
  width: number,
  height: number,
  paint: (x: number, y: number) => [number, number, number],
) {
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
              const [r, g, b] = paint(x / w, y / h);
              const i = (y * w + x) * 4;
              data[i] = r;
              data[i + 1] = g;
              data[i + 2] = b;
              data[i + 3] = 255;
            }
          }

          return { data, width: w, height: h };
        },
      }),
    } as unknown as HTMLCanvasElement;
  };

  return { source, createCanvas };
}

/** White everywhere except a blob of colour in the lower-right quarter. */
const SUBJECT_ON_WHITE = (x: number, y: number): [number, number, number] =>
  x > 0.6 && y > 0.6 ? [40, 20, 140] : [250, 250, 250];

const NOISE = (x: number, y: number): [number, number, number] => [
  Math.round((Math.sin(x * 37) * 0.5 + 0.5) * 255),
  Math.round((Math.sin(y * 53) * 0.5 + 0.5) * 255),
  Math.round((Math.sin((x + y) * 71) * 0.5 + 0.5) * 255),
];

/** Where a spread of pieces would be cut from, as fractions of the travel. */
function spread(paint: (x: number, y: number) => [number, number, number], count = 60) {
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
