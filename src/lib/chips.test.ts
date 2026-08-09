import { describe, expect, it, vi } from 'vitest';

import { asContext, createFakeContext, type FakeContext } from '../test/fakeCanvas';
import { CHIP_VARIANTS, createChipSprites } from './chips';
import { getPalette } from './palettes';
import { SHARD_KINDS } from './scene';

const palette = getPalette('aurora');

/** Mean channel of an `rgb(r g b / a)` string, for comparing two paints. */
function brightness(style: unknown): number {
  const channels = /rgb\((\d+) (\d+) (\d+)/.exec(String(style));

  if (!channels) {
    throw new TypeError(`Not an rgb() colour: ${String(style)}`);
  }

  return (Number(channels[1]) + Number(channels[2]) + Number(channels[3])) / 3;
}

/** Canvases that record what was drawn into them, since jsdom draws nothing. */
function recordingCanvases() {
  const contexts: FakeContext[] = [];
  const createCanvas = vi.fn(() => {
    const ctx = createFakeContext();
    contexts.push(ctx);

    return {
      width: 0,
      height: 0,
      getContext: () => asContext(ctx),
    } as unknown as HTMLCanvasElement;
  });

  return { contexts, createCanvas };
}

describe('createChipSprites', () => {
  it('renders a sprite per shape', () => {
    const { createCanvas } = recordingCanvases();
    const sprites = createChipSprites(palette, { createCanvas });

    for (const kind of SHARD_KINDS) {
      expect(sprites.get(kind, 0.5)).not.toBeNull();
    }

    expect(createCanvas).toHaveBeenCalledTimes(SHARD_KINDS.length);
  });

  // Chips are drawn hundreds of times a frame; rendering the gradient each time
  // is exactly what this cache exists to avoid.
  it('renders each shape and colour once', () => {
    const { createCanvas } = recordingCanvases();
    const sprites = createChipSprites(palette, { createCanvas });

    const first = sprites.get('bead', 0.25);
    const again = sprites.get('bead', 0.25);

    expect(again).toBe(first);
    expect(createCanvas).toHaveBeenCalledOnce();
  });

  it('quantises nearby colours onto the same sprite', () => {
    const { createCanvas } = recordingCanvases();
    const sprites = createChipSprites(palette, { steps: 8, createCanvas });

    expect(sprites.get('bead', 0.26)).toBe(sprites.get('bead', 0.24));
    expect(createCanvas).toHaveBeenCalledOnce();
  });

  it('separates distinct colours', () => {
    const { createCanvas } = recordingCanvases();
    const sprites = createChipSprites(palette, { steps: 8, createCanvas });

    expect(sprites.get('bead', 0.1)).not.toBe(sprites.get('bead', 0.6));
    expect(createCanvas).toHaveBeenCalledTimes(2);
  });

  it('wraps colour positions outside [0, 1]', () => {
    const { createCanvas } = recordingCanvases();
    const sprites = createChipSprites(palette, { steps: 8, createCanvas });

    expect(sprites.get('bead', 1.25)).toBe(sprites.get('bead', 0.25));
    expect(sprites.get('bead', -0.75)).toBe(sprites.get('bead', 0.25));
  });

  // A chip is a solid with flat faces, and each face turns the light a
  // different way. Airbrushing a single soft gradient over it is what makes
  // rendered glass read as plastic.
  it('paints a body, the faces of a bevel, a catch-light and a rim', () => {
    const { contexts, createCanvas } = recordingCanvases();
    const sprites = createChipSprites(palette, { createCanvas });

    sprites.get('triangle', 0.5);

    const [chip] = contexts;
    // The body, three bevel faces and the spark, plus a fill per bubble.
    expect(chip!.countOf('fill')).toBeGreaterThanOrEqual(5);
    // The rim, plus a stroke per crack and per bubble.
    expect(chip!.countOf('stroke')).toBeGreaterThanOrEqual(2);
    // Two clips: the spark, and the flaws. Both would otherwise be able to
    // spill over an edge of an irregular cut and show outside the glass.
    expect(chip!.countOf('clip')).toBe(2);
  });

  // Glass broken down to this size is nearly always cracked short of broken
  // somewhere inside as well, and a fracture reflects, so it reads as a bright
  // hairline rather than a dark one.
  it('cracks every piece, and draws the fractures light against a dark rim', () => {
    for (const kind of SHARD_KINDS) {
      const { contexts, createCanvas } = recordingCanvases();

      createChipSprites(palette, { createCanvas }).get(kind, 0.5);

      const strokes = contexts[0]!.stylesOf('stroke');
      // At least one fracture, then the rim. Bubbles may add more between.
      expect(strokes.length, kind).toBeGreaterThan(1);

      // A fracture is a surface inside a transparent solid, so it reflects:
      // it comes out as a bright hairline. The rim is the opposite — the light
      // crosses the most glass there — and it is drawn last.
      const rim = strokes.at(-1)!;
      const inside = strokes.slice(0, -1).map((style) => brightness(style.strokeStyle));

      expect(Math.max(...inside), kind).toBeGreaterThan(200);
      expect(brightness(rim.strokeStyle), kind).toBeLessThan(120);
    }
  });

  // The palette is a handful of jars, but a melt is never quite even, and a
  // chamber where every green is the identical green reads as printed.
  it('renders more than one shade of each palette colour', () => {
    const { createCanvas } = recordingCanvases();
    const sprites = createChipSprites(palette, { createCanvas });

    // Two positions inside the same jar: the same colour, off the melt by a
    // shade. Neighbouring jars would prove nothing.
    const first = sprites.get('bead', 0.01);
    const second = sprites.get('bead', 1 / palette.colors.length - 0.01);

    expect(second).not.toBe(first);
  });

  // Every chip cut from the same die is what makes a chamber look printed.
  it('cuts each shape more than one way', () => {
    const { createCanvas } = recordingCanvases();
    const sprites = createChipSprites(palette, { createCanvas });

    expect(sprites.get('shard', 0.5, 0)).not.toBe(sprites.get('shard', 0.5, 1));
    expect(sprites.get('shard', 0.5, CHIP_VARIANTS)).toBe(sprites.get('shard', 0.5, 0));
    expect(createCanvas).toHaveBeenCalledTimes(2);
  });

  it('survives a canvas that cannot give a context', () => {
    const sprites = createChipSprites(palette, {
      createCanvas: () => ({ getContext: () => null }) as unknown as HTMLCanvasElement,
    });

    expect(sprites.get('bead', 0.5)).toBeNull();
  });

  it('exposes the palette it was built for, so it can be swapped when that changes', () => {
    expect(
      createChipSprites(palette, { createCanvas: recordingCanvases().createCanvas }).palette,
    ).toBe(palette);
  });
});
