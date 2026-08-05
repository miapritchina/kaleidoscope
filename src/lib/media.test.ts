import { describe, expect, it } from 'vitest';

import { asContext, createFakeContext } from '../test/fakeCanvas';
import { drawMedia, getMediaSize, isMediaReady, type MediaElement } from './media';

/** A stand-in for an `<img>`; jsdom never loads real pixels. */
function fakeImage(width: number, height: number): MediaElement {
  return { naturalWidth: width, naturalHeight: height } as unknown as HTMLImageElement;
}

/** A stand-in for a `<video>`; `readyState` 2 is HAVE_CURRENT_DATA. */
function fakeVideo(width: number, height: number, readyState = 4): MediaElement {
  return { videoWidth: width, videoHeight: height, readyState } as unknown as HTMLVideoElement;
}

const NO_PAN = { x: 0, y: 0 };

describe('getMediaSize', () => {
  it('reads the intrinsic size of each element type', () => {
    expect(getMediaSize(fakeImage(800, 600))).toEqual({ width: 800, height: 600 });
    expect(getMediaSize(fakeVideo(1280, 720))).toEqual({ width: 1280, height: 720 });
  });
});

describe('isMediaReady', () => {
  it('rejects missing or unloaded media', () => {
    expect(isMediaReady(null)).toBe(false);
    expect(isMediaReady(undefined)).toBe(false);
    expect(isMediaReady(fakeImage(0, 0))).toBe(false);
  });

  it('waits for a video to have frame data', () => {
    expect(isMediaReady(fakeVideo(640, 480, 0))).toBe(false);
    expect(isMediaReady(fakeVideo(640, 480, 1))).toBe(false);
    expect(isMediaReady(fakeVideo(640, 480, 2))).toBe(true);
  });

  it('accepts a loaded image', () => {
    expect(isMediaReady(fakeImage(10, 10))).toBe(true);
  });
});

describe('drawMedia', () => {
  function draw(media: MediaElement, options: Partial<Parameters<typeof drawMedia>[2]> = {}) {
    const ctx = createFakeContext();

    drawMedia(asContext(ctx), media, {
      size: 100,
      zoom: 1,
      pan: NO_PAN,
      alpha: 1,
      ...options,
    });

    const [args] = ctx.argsOf('drawImage');

    return {
      ctx,
      drawn: args
        ? { x: args[1] as number, y: args[2] as number, w: args[3] as number, h: args[4] as number }
        : null,
    };
  }

  it('covers the full 2x span around the apex', () => {
    // The sector reaches `size` along both axes from the apex, so the media has
    // to span 2 * size to leave no gap at any segment count.
    const { drawn } = draw(fakeImage(400, 400));

    expect(drawn).not.toBeNull();
    expect(drawn!.w).toBe(200);
    expect(drawn!.h).toBe(200);
    // Centred on the apex at (0, 0).
    expect(drawn!.x).toBe(-100);
    expect(drawn!.y).toBe(-100);
  });

  it('covers on the short edge for a wide image', () => {
    const { drawn } = draw(fakeImage(400, 200));

    // Height is the constraint: it must reach 200, scaling width past it.
    expect(drawn!.h).toBe(200);
    expect(drawn!.w).toBe(400);
  });

  it('magnifies with zoom', () => {
    const { drawn } = draw(fakeImage(400, 400), { zoom: 2 });

    expect(drawn!.w).toBe(400);
    expect(drawn!.h).toBe(400);
  });

  it('never zooms below cover, which would expose the backdrop', () => {
    const atCover = draw(fakeImage(400, 400), { zoom: 1 }).drawn;
    const zoomedOut = draw(fakeImage(400, 400), { zoom: 0.5 }).drawn;

    expect(zoomedOut).toEqual(atCover);
  });

  it('pans by the slack the media has outside the covered square', () => {
    // At zoom 2 a square image is 400 wide against a 200 span: 100 of slack.
    const centred = draw(fakeImage(400, 400), { zoom: 2 }).drawn;
    const panned = draw(fakeImage(400, 400), { zoom: 2, pan: { x: 1, y: -1 } }).drawn;

    expect(panned!.x - centred!.x).toBe(100);
    expect(panned!.y - centred!.y).toBe(-100);
  });

  it('cannot pan when the media exactly covers', () => {
    const centred = draw(fakeImage(400, 400)).drawn;
    const panned = draw(fakeImage(400, 400), { pan: { x: 1, y: 1 } }).drawn;

    expect(panned).toEqual(centred);
  });

  it('clamps pan beyond the edges', () => {
    const pinned = draw(fakeImage(400, 400), { zoom: 2, pan: { x: 1, y: 1 } }).drawn;
    const overshot = draw(fakeImage(400, 400), { zoom: 2, pan: { x: 9, y: 9 } }).drawn;

    expect(overshot).toEqual(pinned);
  });

  it('ignores a non-finite pan', () => {
    const centred = draw(fakeImage(400, 400), { zoom: 2 }).drawn;
    const broken = draw(fakeImage(400, 400), { zoom: 2, pan: { x: Number.NaN, y: 0 } }).drawn;

    expect(broken).toEqual(centred);
  });

  it('applies alpha for trails and composites normally', () => {
    const { ctx } = draw(fakeImage(400, 400), { alpha: 0.4 });

    expect(ctx.globalAlpha).toBe(0.4);
    expect(ctx.globalCompositeOperation).toBe('source-over');
  });

  it('draws nothing for degenerate input', () => {
    expect(draw(fakeImage(400, 400), { size: 0 }).drawn).toBeNull();
    expect(draw(fakeImage(0, 0)).drawn).toBeNull();
  });

  it('balances save with restore', () => {
    const { ctx } = draw(fakeImage(400, 400));

    expect(ctx.countOf('save')).toBe(ctx.countOf('restore'));
  });
});
