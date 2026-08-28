import { describe, expect, it } from 'vitest';

import {
  createFlocs,
  createPalette,
  createPaper,
  kubelka,
  mixture,
  paintPigment,
  paletteAt,
  PALETTE_COUNT,
  stirFlocs,
  type Palette,
  type Paper,
} from './pigment';

/**
 * A hot-pressed sheet, one pixel per cell: no tooth at all.
 *
 * Everything below except the paper's own test is measuring the paint, and a
 * tooth is a texture laid over the whole picture — it would add the same
 * variance to a granulating wash and a smooth one alike and hide the very
 * difference the granulation test exists to measure.
 */
const smooth = (grid: number): Paper => ({
  size: grid,
  tooth: new Float32Array(grid * grid).fill(0.5),
});

/** The colour of a mixture, as three numbers 0 to 255. */
function colourOf(palette: Palette, parts: number[]): number[] {
  const tone = [0, 0, 0];

  mixture(palette, parts, tone);

  return tone;
}

/** Every palette, so a claim is made about the paint box and not about one seed. */
const every = Array.from({ length: PALETTE_COUNT }, (_, index) => paletteAt(index));

/** An even wash of one paint, painted, with the frame left out of the reckoning. */
function washOf(palette: Palette, paint: number, grid = 48, paper = smooth(grid), depth = 0.9) {
  const cells = grid * grid;
  const held = [0, 1, 2].map(() => new Float32Array(cells));
  const flocs = createFlocs(grid, 4);

  held[paint]!.fill(palette.paints[paint]!.pour * depth);

  const pixels = new Uint8ClampedArray(cells * 4);

  paintPigment(palette, held, flocs, paper, 1, pixels);

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

  // The claim the whole model is for: two paints from either side of green make
  // green. Two primaries subtracted one each cannot do this — take red out with
  // the one and blue out with the other and what is left is a grey.
  it('makes a green out of a green-gold yellow and a turquoise', () => {
    const palette = every.find(
      (one) =>
        one.paints[0]!.name === 'Irgazin Yellow' && one.paints[2]!.name === 'Cobalt Turquoise',
    );

    expect(palette).toBeDefined();

    const [red, green, blue] = colourOf(palette!, [0.2, 0, 0.12]);

    expect(green!).toBeGreaterThan(red!);
    expect(green!).toBeGreaterThan(blue!);
  });

  /**
   * The mud test, and it is the one the palettes were rebuilt around.
   *
   * The cell is sealed and it folds, so a few minutes of drifting puts a little
   * of all three paints into most of it. Whatever that mixture comes out as is
   * therefore the colour most of the cell will be after a while, however
   * lovely the three paints are on their own — and with a *triad*, which is
   * three primaries spread round the wheel, it is by construction the grey in
   * the middle. Measured on a phone the old palettes settled to a green-grey
   * wash inside forty seconds, which is what prompted this.
   *
   * So: every mixture of every palette, at every depth worth looking at, still
   * has a colour in it. Chroma here is the plainest thing it could be — the
   * spread between the strongest and weakest channels — and the floor is set
   * where a colour stops being nameable rather than anywhere theoretical. The
   * old set failed it at 20 of its lattice points and its dullest mixture came
   * out at a chroma of 2.8 — a grey to three parts in 255. The set that
   * replaced it has none, and its dullest is 26.
   */
  it('has no mixture anywhere in it that comes out grey', () => {
    for (const palette of every) {
      const pours = palette.paints.map((paint) => paint.pour);
      let dullest = 255;
      let where = '';

      for (let a = 0; a <= 4; a += 1) {
        for (let b = 0; b <= 4; b += 1) {
          for (let c = 0; c <= 4; c += 1) {
            const parts = [(a / 4) * pours[0]!, (b / 4) * pours[1]!, (c / 4) * pours[2]!];
            const tone = colourOf(palette, parts);
            const light = (tone[0]! + tone[1]! + tone[2]!) / 3;

            // A mixture too dark or too pale to have a hue is not mud, it is
            // black or it is water. What is being looked for is the middle.
            if (light < 40 || light > 235) {
              continue;
            }

            const chroma = Math.max(...tone) - Math.min(...tone);

            if (chroma < dullest) {
              dullest = chroma;
              where = `${palette.paints.map((paint) => paint.name).join(' + ')} at ${a}${b}${c}`;
            }
          }
        }
      }

      expect(dullest, where).toBeGreaterThan(16);
    }
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

    paintPigment(palette, held, flocs, smooth(grid), 1, pixels);

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

describe('the paper', () => {
  it('cuts the same sheet for the same seed, and a different one otherwise', () => {
    expect(Array.from(createPaper(24, 3).tooth)).toEqual(Array.from(createPaper(24, 3).tooth));
    expect(Array.from(createPaper(24, 3).tooth)).not.toEqual(Array.from(createPaper(24, 4).tooth));
  });

  it('has pits and peaks either side of the middle, and stays between them', () => {
    const { tooth } = createPaper(96, 5);
    const mean = tooth.reduce((sum, one) => sum + one, 0) / tooth.length;

    expect(Math.min(...tooth)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...tooth)).toBeLessThanOrEqual(1);
    expect(Math.min(...tooth)).toBeLessThan(0.3);
    expect(Math.max(...tooth)).toBeGreaterThan(0.7);
    expect(mean).toBeCloseTo(0.5, 1);
  });

  // What the tooth is for. A flat wash on a rough sheet is not flat: the pits
  // hold more water and therefore more pigment than the peaks do, and that is
  // most of what makes a watercolour look like one rather than like an
  // airbrush.
  /**
   * How much spread the sheet itself adds to a wash of a given depth.
   *
   * Against the same wash on a hot-pressed sheet, so what is left is the tooth
   * and not the pigment's own flocculation — which is much the larger of the
   * two on a fresh cell, and is a different thing being measured elsewhere in
   * this file. The paint is the palette's *weakest*, the one poured at its full
   * share, so the depth asked for is the load the tooth actually sees.
   */
  function toothOf(depth: number, grid = 48) {
    const palette = paletteAt(0);
    const pours = palette.paints.map((paint) => paint.pour);
    const weakest = pours.indexOf(Math.max(...pours));
    const flat = washOf(palette, weakest, grid, smooth(grid), depth);
    const rough = washOf(palette, weakest, grid, createPaper(grid, 7), depth);

    return { added: rough.spread - flat.spread, flat, rough };
  }

  it('mottles a middling wash that a hot-pressed sheet leaves flat', () => {
    const { added, flat, rough } = toothOf(0.25);

    // Measured: a spread of 8.6 out of 255 on the smooth sheet and 11.5 on the
    // rough one.
    expect(added).toBeGreaterThan(1.5);
    expect(rough.spread).toBeGreaterThan(flat.spread * 1.2);
    // And it takes as much as it gives: the wash is the same weight of paint,
    // laid unevenly.
    expect(Math.abs(rough.mean - flat.mean)).toBeLessThan(3);
  });

  // The other end, and it is the correction the whole texture needed. A wash
  // deep enough to be near its mass tone has filled the pits and the peaks
  // alike and there is nothing left for the tooth to separate — so it lets go.
  // Ramped instead of humped, the deepest part of a cell was the most speckled
  // part of the picture, which is the wrong way round, and on a phone at the
  // top of the zoom slider it read as dirt rather than as paper.
  it('lets go of a wash deep enough to have filled the pits', () => {
    // Measured: 2.94 of added spread at a quarter, 0.08 at one and a fifth.
    expect(toothOf(1.2).added).toBeLessThan(toothOf(0.25).added * 0.2);
  });

  // The bare sheet as well as the wash. A white that is exactly 255 everywhere
  // is not a sheet of paper, it is a screen with nothing drawn on it — and the
  // mirrors repeat this square dozens of times, so it has to be a whisper.
  it('shades the white of an empty cell, faintly', () => {
    const palette = paletteAt(0);
    const grid = 48;
    const held = [0, 1, 2].map(() => new Float32Array(grid * grid));
    const pixels = new Uint8ClampedArray(grid * grid * 4);

    paintPigment(palette, held, createFlocs(grid, 1), createPaper(grid, 9), 1, pixels);

    let least = 255;
    let most = 0;

    for (let k = 0; k < grid * grid; k += 1) {
      least = Math.min(least, pixels[k * 4]!);
      most = Math.max(most, pixels[k * 4]!);
    }

    expect(most).toBe(255);
    expect(least).toBeLessThan(253);
    expect(least).toBeGreaterThan(238);
  });
});
