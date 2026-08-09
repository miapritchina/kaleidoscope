import { describe, expect, it, vi } from 'vitest';

import { asContext, createFakeContext, type FakeContext } from '../test/fakeCanvas';
import { CHIP_VARIANTS, createChipSprites } from './chips';
import { getPalette } from './palettes';
import { SHARD_KINDS } from './scene';

const palette = getPalette('aurora');

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
    // The body, three bevel faces, and the spark.
    expect(chip!.countOf('fill')).toBe(5);
    // The spark is clipped to the chip, so it cannot hang over an edge.
    expect(chip!.countOf('clip')).toBe(1);
    expect(chip!.countOf('stroke')).toBe(1);
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
