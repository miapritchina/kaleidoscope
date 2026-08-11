import { describe, expect, it, vi } from 'vitest';

import { asContext, createFakeContext, type FakeContext } from '../test/fakeCanvas';
import { CHIP_VARIANTS, createChipSprites } from './chips';
import { SHARD_KINDS } from './scene';

/** Canvases rendered per cut: the shading, and the blaze. */
const LAYERS = 2;

/** How each kind is cut. Mirrors the table in `chips.ts`. */
const CUTS = {
  triangle: { faces: 3, tableFaces: 3 },
  bead: { faces: 6, tableFaces: 3 },
} as const;

/** Mean channel of an `rgb(r g b)` string, for comparing two paints. */
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
  it('renders the two lighting layers per shape', () => {
    const { createCanvas } = recordingCanvases();
    const sprites = createChipSprites({ createCanvas });

    for (const kind of SHARD_KINDS) {
      expect(sprites.shading(kind)).not.toBeNull();
      expect(sprites.blaze(kind)).not.toBeNull();
    }

    expect(createCanvas).toHaveBeenCalledTimes(SHARD_KINDS.length * LAYERS);
  });

  // These are stamped over every piece, every frame. Rendering them again each
  // time is exactly what the cache exists to avoid.
  it('renders each shape and cut once', () => {
    const { createCanvas } = recordingCanvases();
    const sprites = createChipSprites({ createCanvas });

    const first = sprites.shading('bead');
    const again = sprites.shading('bead');

    expect(again).toBe(first);
    expect(createCanvas).toHaveBeenCalledOnce();
  });

  // Every piece cut from the same die is what makes a chamber look printed.
  it('cuts each shape more than one way', () => {
    const { createCanvas } = recordingCanvases();
    const sprites = createChipSprites({ createCanvas });

    expect(sprites.shading('shard', 0)).not.toBe(sprites.shading('shard', 1));
    expect(sprites.shading('shard', CHIP_VARIANTS)).toBe(sprites.shading('shard', 0));
    expect(createCanvas).toHaveBeenCalledTimes(2);
  });

  // A piece is a solid with flat faces, each turning the light a different way.
  // Airbrushing one soft gradient over it is what makes a rendered solid read
  // as moulded plastic.
  it('paints the piece as a mosaic of flat faces rather than one dome', () => {
    const { contexts, createCanvas } = recordingCanvases();

    createChipSprites({ createCanvas }).shading('triangle');

    const [shading] = contexts;
    const faces = CUTS.triangle.faces + CUTS.triangle.tableFaces;

    expect(shading!.countOf('fill')).toBe(faces);
    expect(
      new Set(shading!.stylesOf('fill').map((style) => String(style.fillStyle))).size,
    ).toBeGreaterThan(1);
    // The rim: the last sliver before the piece turns away from you entirely.
    expect(shading!.countOf('stroke')).toBe(1);
  });

  // The light is at the eye, so a face turned towards you returns the most and
  // one tilted away returns less. Getting that backwards inverts the solid.
  it('shades the flat top brighter than the faces ground away from you', () => {
    const { contexts, createCanvas } = recordingCanvases();

    createChipSprites({ createCanvas }).shading('bead');

    const fills = contexts[0]!.stylesOf('fill').map((style) => brightness(style.fillStyle));
    const table = fills.slice(0, CUTS.bead.tableFaces);
    const bevel = fills.slice(CUTS.bead.tableFaces);

    expect(Math.min(...table)).toBeGreaterThan(Math.max(...bevel));
  });

  // The blaze is added over the shading, so everything not catching the light
  // has to be black rather than merely dark.
  it('lays the blaze over black, and only on the faces that catch it', () => {
    const { contexts, createCanvas } = recordingCanvases();

    createChipSprites({ createCanvas }).blaze('bead');

    const styles = contexts[0]!.stylesOf('fill').map((style) => String(style.fillStyle));
    const [ground, ...faces] = styles;
    const levels = faces.map(brightness);

    expect(ground).toBe('#000');
    expect(Math.max(...levels)).toBeGreaterThan(0);
    expect(Math.min(...levels)).toBe(0);
  });

  // The outline clips a photograph to a piece, so it has to be usable apart
  // from either layer.
  it('offers the outline on the unit circle, for clipping a picture to', () => {
    const sprites = createChipSprites({ createCanvas: recordingCanvases().createCanvas });
    const outline = sprites.outline('shard');

    expect(outline.length).toBeGreaterThan(2);

    for (const point of outline) {
      expect(Math.hypot(point.x, point.y)).toBeLessThanOrEqual(1);
    }
  });

  it('gives the same cut the same outline every time', () => {
    const sprites = createChipSprites({ createCanvas: recordingCanvases().createCanvas });

    expect(sprites.outline('bead', 1)).toEqual(sprites.outline('bead', 1));
    expect(sprites.outline('bead', 1)).not.toEqual(sprites.outline('bead', 0));
  });

  it('survives a canvas that cannot give a context', () => {
    const sprites = createChipSprites({
      createCanvas: () => ({ getContext: () => null }) as unknown as HTMLCanvasElement,
    });

    expect(sprites.shading('bead')).toBeNull();
  });
});
