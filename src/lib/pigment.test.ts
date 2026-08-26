import { describe, expect, it } from 'vitest';

import {
  createFlocs,
  createPalette,
  kubelka,
  mixture,
  paintPigment,
  paletteAt,
  PALETTE_COUNT,
  stirFlocs,
  type Palette,
} from './pigment';

/** The colour of a mixture, as three numbers 0 to 255. */
function colourOf(palette: Palette, parts: number[]): number[] {
  const tone = [0, 0, 0];

  mixture(palette, parts, tone);

  return tone;
}

/** Every palette, so a claim is made about the paint box and not about one seed. */
const every = Array.from({ length: PALETTE_COUNT }, (_, index) => paletteAt(index));

/** An even wash of one paint, painted, with the frame left out of the reckoning. */
function washOf(palette: Palette, paint: number, grid = 48) {
  const cells = grid * grid;
  const held = [0, 1, 2].map(() => new Float32Array(cells));
  const flocs = createFlocs(grid, 4);

  held[paint]!.fill(palette.paints[paint]!.pour * 0.9);

  const pixels = new Uint8ClampedArray(cells * 4);

  paintPigment(palette, held, flocs, 1, pixels);

  // Only the inside: the rim reads the frame of the grid as an edge of the
  // wash, which it is, and that is not what this is measuring.
  const inner: number[] = [];

  for (let j = 4; j < grid - 4; j += 1) {
    for (let i = 4; i < grid - 4; i += 1) {
      inner.push(pixels[(i + j * grid) * 4]!);
    }
  }

  const mean = inner.reduce((sum, one) => sum + one, 0) / inner.length;
  const spread = Math.sqrt(inner.reduce((sum, one) => sum + (one - mean) ** 2, 0) / inner.length);

  return { mean, spread };
}

describe('kubelka', () => {
  it('leaves the ground alone where there is no paint', () => {
    expect(kubelka(0, 0)).toBe(1);
    expect(kubelka(0, 0, 0.5)).toBe(0.5);
  });

  it('darkens as the layer deepens, and never past black or white', () => {
    let last = 1;

    for (const depth of [0.1, 0.5, 1, 2, 5, 12, 40]) {
      const reflectance = kubelka(depth, depth * 0.2);

      expect(reflectance).toBeLessThan(last);
      expect(reflectance).toBeGreaterThanOrEqual(0);
      last = reflectance;
    }
  });
});

describe('a palette', () => {
  it('holds three paints, and the same three for the same seed', () => {
    expect(createPalette(7).paints).toHaveLength(3);
    expect(createPalette(7)).toBe(createPalette(7));
  });

  // The whole point of the pours: tinting strength across a paint box runs
  // nearly ten to one, so equal parts of a Prussian and a potter's pink is a
  // cell of Prussian — the one black, the other not there at all. Poured by the
  // reciprocal, every paint arrives at a full cloud as its own mass tone: deep
  // in whichever primary it absorbs hardest, and still recognisably its own
  // colour. Measured across the whole paint box, the darkest channel of a full
  // cloud lands between 11 and 26 out of 255 for every paint but potter's pink,
  // which is a pale pigment and reads as one at 75.
  it('pours the strong paints thinner, so a full cloud of each is its mass tone', () => {
    for (const palette of every) {
      // One of the three fills the cell and the others are let down against it.
      expect(Math.max(...palette.paints.map((paint) => paint.pour))).toBeCloseTo(1, 6);

      for (const [at, paint] of palette.paints.entries()) {
        const parts = [0, 0, 0];

        parts[at] = paint.pour;

        const tone = colourOf(palette, parts);
        const mean = (tone[0]! + tone[1]! + tone[2]!) / 3;

        // Neither blacked out nor barely there.
        expect(mean).toBeGreaterThan(10);
        expect(mean).toBeLessThan(160);
        // And deep in the primary it takes out hardest.
        expect(Math.min(...tone)).toBeLessThan(85);
      }
    }
  });

  it('is clear water where there is no paint', () => {
    for (const palette of every) {
      expect(colourOf(palette, [0, 0, 0])).toEqual([255, 255, 255]);
    }
  });

  // Kubelka-Munk over the mixture rather than an average of the parts. Two
  // paints together absorb more than either alone, which is why a glaze is a
  // glaze; an average would land between them.
  it('mixes as paint rather than as an average', () => {
    for (const palette of every) {
      const light = (parts: number[]) => {
        const tone = colourOf(palette, parts);

        return (tone[0]! + tone[1]! + tone[2]!) / 3;
      };
      const [a, b] = [palette.paints[0]!.pour * 0.3, palette.paints[1]!.pour * 0.3];

      expect(light([a, b, 0])).toBeLessThan(Math.min(light([a, 0, 0]), light([0, b, 0])));
    }
  });

  // The claim the whole model is for: blue and yellow make green. Two
  // primaries subtracted one each cannot do this — take red out with the blue
  // and blue out with the yellow and what is left is a grey.
  it('makes a green out of ultramarine and a green-gold yellow', () => {
    const palette = every.find(
      (one) => one.paints[0]!.name === 'Ultramarine' && one.paints[1]!.name === 'Irgazin Yellow',
    );

    expect(palette).toBeDefined();

    const [red, green, blue] = colourOf(palette!, [0.2, 0.15, 0]);

    expect(green!).toBeGreaterThan(red!);
    expect(green!).toBeGreaterThan(blue!);
  });
});

describe('granulation', () => {
  // Measured, because it is the difference between two real pigments and not a
  // decoration: on an even wash the coarse paint of a palette varies from pixel
  // to pixel by an order of magnitude more than the fine one. Ultramarine
  // against quinacridone comes out about 17 against 2, out of 255.
  it('mottles the coarse paints and leaves the fine ones smooth', () => {
    for (const palette of every) {
      const grains = palette.paints.map((paint) => paint.grain);
      const coarse = grains.indexOf(Math.max(...grains));
      const fine = grains.indexOf(Math.min(...grains));

      expect(washOf(palette, coarse).spread).toBeGreaterThan(washOf(palette, fine).spread * 3);
    }
  });

  it('keeps the clumping inside its range, and keeps it moving', () => {
    const flocs = createFlocs(32, 9);
    const before = Array.from(flocs.where);

    for (let step = 0; step < 60; step += 1) {
      stirFlocs(flocs, step / 30, 1 / 30);
    }

    let moved = 0;

    for (let k = 0; k < flocs.where.length; k += 1) {
      expect(flocs.where[k]).toBeGreaterThanOrEqual(0);
      expect(flocs.where[k]).toBeLessThanOrEqual(1);

      if (Math.abs(flocs.where[k]! - before[k]!) > 0.02) {
        moved += 1;
      }
    }

    expect(moved).toBeGreaterThan(flocs.where.length * 0.2);
  });
});

describe('paintPigment', () => {
  // The rim: where the amount of paint changes fastest, it darkens. A disc of
  // paint should therefore be darker at its edge than in its middle, even
  // though the middle holds more of it.
  it('darkens the edge of a wash', () => {
    const grid = 48;
    const palette = paletteAt(0);
    const held = [0, 1, 2].map(() => new Float32Array(grid * grid));
    const flocs = createFlocs(grid, 2);
    const middle = (grid - 1) / 2;

    // Even clumping, so the only thing varying across the disc is its edge.
    flocs.where.fill(0.5);

    for (let j = 0; j < grid; j += 1) {
      for (let i = 0; i < grid; i += 1) {
        const away = Math.hypot(i - middle, j - middle);

        held[0]![i + j * grid] = away < grid * 0.3 ? palette.paints[0]!.pour * 0.5 : 0;
      }
    }

    const pixels = new Uint8ClampedArray(grid * grid * 4);

    paintPigment(palette, held, flocs, 1, pixels);

    const lightAt = (i: number, j: number) => {
      const at = (i + j * grid) * 4;

      return (pixels[at]! + pixels[at + 1]! + pixels[at + 2]!) / 3;
    };
    const centre = lightAt(Math.round(middle), Math.round(middle));
    const edge = lightAt(Math.round(middle + grid * 0.29), Math.round(middle));

    expect(edge).toBeLessThan(centre);
    expect(lightAt(1, 1)).toBe(255);
  });
});
