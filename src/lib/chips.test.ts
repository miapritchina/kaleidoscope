import { describe, expect, it, vi } from 'vitest';

import { asContext, createFakeContext, type FakeContext } from '../test/fakeCanvas';
import { CHIP_VARIANTS, createChipSprites } from './chips';
import { getPalette } from './palettes';
import { SHARD_KINDS } from './scene';

const palette = getPalette('aurora');

/** Canvases rendered per finished piece: the shading, the blaze, the piece. */
const LAYERS = 3;

/** How each kind is cut. Mirrors the table in `chips.ts`. */
const CUTS = {
  triangle: { faces: 3, tableFaces: 3 },
  bead: { faces: 6, tableFaces: 3 },
} as const;

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

    // The piece itself, plus the two lighting layers it is composed from.
    expect(createCanvas).toHaveBeenCalledTimes(SHARD_KINDS.length * LAYERS);
  });

  // Chips are drawn hundreds of times a frame; rendering the gradient each time
  // is exactly what this cache exists to avoid.
  it('renders each shape and colour once', () => {
    const { createCanvas } = recordingCanvases();
    const sprites = createChipSprites(palette, { createCanvas });

    const first = sprites.get('bead', 0.25);
    const again = sprites.get('bead', 0.25);

    expect(again).toBe(first);
    expect(createCanvas).toHaveBeenCalledTimes(LAYERS);
  });

  it('quantises nearby colours onto the same sprite', () => {
    const { createCanvas } = recordingCanvases();
    const sprites = createChipSprites(palette, { steps: 8, createCanvas });

    expect(sprites.get('bead', 0.26)).toBe(sprites.get('bead', 0.24));
    expect(createCanvas).toHaveBeenCalledTimes(LAYERS);
  });

  it('separates distinct colours', () => {
    const { createCanvas } = recordingCanvases();
    const sprites = createChipSprites(palette, { steps: 8, createCanvas });

    expect(sprites.get('bead', 0.1)).not.toBe(sprites.get('bead', 0.6));
    // The lighting depends on the cut rather than the colour, so the second
    // colour costs one more canvas rather than another three.
    expect(createCanvas).toHaveBeenCalledTimes(LAYERS + 1);
  });

  it('wraps colour positions outside [0, 1]', () => {
    const { createCanvas } = recordingCanvases();
    const sprites = createChipSprites(palette, { steps: 8, createCanvas });

    expect(sprites.get('bead', 1.25)).toBe(sprites.get('bead', 0.25));
    expect(sprites.get('bead', -0.75)).toBe(sprites.get('bead', 0.25));
  });

  // A chip is a solid with flat faces, and each face turns the light a
  // different way. Airbrushing a single soft gradient over it is what makes a
  // rendered solid read as plastic.
  it('paints the piece as a mosaic of flat faces rather than one dome', () => {
    const { contexts, createCanvas } = recordingCanvases();
    const sprites = createChipSprites(palette, { createCanvas });

    sprites.get('triangle', 0.5);

    // Built shading first, then the blaze, then the piece composed from them.
    const [shading] = contexts;
    const faces = CUTS.triangle.faces + CUTS.triangle.tableFaces;

    expect(shading!.countOf('fill')).toBe(faces);
    // Every face is filled with its own level, not all with one.
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

    createChipSprites(palette, { createCanvas }).shading('bead');

    const fills = contexts[0]!.stylesOf('fill').map((style) => brightness(style.fillStyle));
    const table = fills.slice(0, CUTS.bead.tableFaces);
    const bevel = fills.slice(CUTS.bead.tableFaces);

    expect(Math.min(...table)).toBeGreaterThan(Math.max(...bevel));
  });

  // Metal is either blazing or black; stone shades gently between. That
  // difference, and not the colour, is what reads as polished.
  it('blazes harder off metal than off stone, and shadows it deeper', () => {
    const build = (metallic: boolean) => {
      const { contexts, createCanvas } = recordingCanvases();
      const sprites = createChipSprites(palette, { createCanvas, metallic });

      sprites.shading('bead');
      sprites.blaze('bead');

      return {
        shading: contexts[0]!.stylesOf('fill').map((style) => brightness(style.fillStyle)),
        // The first fill is the black ground the specular is added over.
        blaze: contexts[1]!
          .stylesOf('fill')
          .slice(1)
          .map((style) => brightness(style.fillStyle)),
      };
    };

    const stone = build(false);
    const metal = build(true);

    expect(Math.max(...metal.blaze)).toBeGreaterThan(Math.max(...stone.blaze));
    expect(Math.min(...metal.shading)).toBeLessThan(Math.min(...stone.shading));
    // Either blazing or black: most faces of a metal piece catch nothing.
    expect(metal.blaze.filter((level) => level < 1).length).toBeGreaterThan(metal.blaze.length / 2);
  });

  // The two layers go over a photograph as well as over a palette colour, so
  // they have to be usable apart from the finished piece.
  it('offers the lighting on its own, and the outline to clip a photo to', () => {
    const { createCanvas } = recordingCanvases();
    const sprites = createChipSprites(palette, { createCanvas });

    expect(sprites.shading('shard')).not.toBeNull();
    expect(sprites.blaze('shard')).not.toBeNull();

    const outline = sprites.outline('shard');
    expect(outline.length).toBeGreaterThan(2);
    // On the unit circle, so the caller scales it to whatever the piece is.
    for (const point of outline) {
      expect(Math.hypot(point.x, point.y)).toBeLessThanOrEqual(1);
    }
  });

  it('gives the same cut the same outline every time', () => {
    const sprites = createChipSprites(palette, { createCanvas: recordingCanvases().createCanvas });

    expect(sprites.outline('bead', 1)).toEqual(sprites.outline('bead', 1));
    expect(sprites.outline('bead', 1)).not.toEqual(sprites.outline('bead', 0));
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
    // A different cut is a different shape, so it needs its own lighting too.
    expect(createCanvas).toHaveBeenCalledTimes(LAYERS * 2);
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
