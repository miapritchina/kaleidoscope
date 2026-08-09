import { describe, expect, it, vi } from 'vitest';

import { asContext, createFakeContext, type FakeContext } from '../test/fakeCanvas';
import { createChipSprites } from './chips';
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

    const first = sprites.get('disc', 0.25);
    const again = sprites.get('disc', 0.25);

    expect(again).toBe(first);
    expect(createCanvas).toHaveBeenCalledOnce();
  });

  it('quantises nearby colours onto the same sprite', () => {
    const { createCanvas } = recordingCanvases();
    const sprites = createChipSprites(palette, { steps: 8, createCanvas });

    expect(sprites.get('disc', 0.26)).toBe(sprites.get('disc', 0.24));
    expect(createCanvas).toHaveBeenCalledOnce();
  });

  it('separates distinct colours', () => {
    const { createCanvas } = recordingCanvases();
    const sprites = createChipSprites(palette, { steps: 8, createCanvas });

    expect(sprites.get('disc', 0.1)).not.toBe(sprites.get('disc', 0.6));
    expect(createCanvas).toHaveBeenCalledTimes(2);
  });

  it('wraps colour positions outside [0, 1]', () => {
    const { createCanvas } = recordingCanvases();
    const sprites = createChipSprites(palette, { steps: 8, createCanvas });

    expect(sprites.get('disc', 1.25)).toBe(sprites.get('disc', 0.25));
    expect(sprites.get('disc', -0.75)).toBe(sprites.get('disc', 0.25));
  });

  it('paints a body and a catch-light, which is what makes it read as glass', () => {
    const { contexts, createCanvas } = recordingCanvases();
    const sprites = createChipSprites(palette, { createCanvas });

    sprites.get('disc', 0.5);

    const [chip] = contexts;
    expect(chip!.countOf('fill')).toBe(1);
    expect(chip!.countOf('stroke')).toBe(1);
  });

  it('survives a canvas that cannot give a context', () => {
    const sprites = createChipSprites(palette, {
      createCanvas: () => ({ getContext: () => null }) as unknown as HTMLCanvasElement,
    });

    expect(sprites.get('disc', 0.5)).toBeNull();
  });

  it('exposes the palette it was built for, so it can be swapped when that changes', () => {
    expect(
      createChipSprites(palette, { createCanvas: recordingCanvases().createCanvas }).palette,
    ).toBe(palette);
  });
});
