/**
 * Real paint, and what it does to the light coming through the cell.
 *
 * Lifted from `paintwheel`, a wet-watercolour simulator, and simplified down to
 * what an object cell can afford. Four things came across, and every one of
 * them is a thing paint does that a coloured fluid does not:
 *
 * 1. **Kubelka-Munk mixing.** Two paints overlapping are not two colours
 *    averaged. Each one takes light out (absorption, `K`) and throws light back
 *    (scattering, `S`) at its own rate per wavelength, and the pair together is
 *    solved as one layer over the white behind it. That is why a green-gold
 *    yellow and a turquoise make green rather than grey, why a stainer glazes
 *    while an earth covers, and why nothing here ever turns to mud the way
 *    averaged colours do. It is not the *only* defence against mud, and it
 *    turned out not to be enough on its own — see {@link PALETTES}.
 * 2. **Every paint has a weight.** Quinacridone is a fine stain that hangs in
 *    water almost indefinitely; magnetite black is coarse and heavy and falls
 *    out of it. So a mixture does not stay a mixture — it *separates*, the
 *    heavy half sinking through the light half, and a green cloud comes apart
 *    into blue below and yellow above. See {@link Pigment.weight}.
 * 3. **Granulation.** Coarse pigment flocculates: it gathers into clumps
 *    rather than staying evenly spread, and the clumps are what give a
 *    granulating wash its mottle. Ultramarine does it violently and phthalo
 *    not at all, and that difference is per-paint and measured. See
 *    {@link Pigment.grain} and {@link stirFlocs}.
 * 4. **The tooth of the paper.** A wash sits in a texture rather than lying
 *    flat on one: the pits hold the water and therefore the pigment, and the
 *    peaks are skipped. See {@link Paper}.
 *
 * What did *not* come across is everything to do with paper as a *process* —
 * deposition, lifting, staining, drying, backruns. Nothing dries in a sealed
 * cell, so none of it has anything to act on. What did come across, on second
 * thoughts and against the note that used to stand here, is the paper's
 * **tooth**: see {@link Paper}. A wash on a cold-pressed sheet is not a smooth
 * field of colour and never has been — it is a field of colour sitting in a
 * texture, darker in the pits and skipped on the peaks — and a watercolour with
 * that taken out reads as an airbrush. It is the one thing about paper that is
 * visible in a single frame rather than over a drying time, and it is the only
 * one worth the cost.
 *
 * The paints are the real ones, by Colour Index number, with their measured
 * mass tone and undertone inverted to K/S by the method in Curtis, Anderson,
 * Seims, Fleischer and Salesin, _Computer-Generated Watercolor_ (SIGGRAPH
 * 1997), Appendix A.
 */

import { createNoise } from './noise';
import { mulberry32 } from './random';

/**
 * Optical depth in the thickest part of a cloud.
 *
 * How deep a layer of paint the cell holds where it holds the most. Paintwheel
 * puts a paint's mass tone — straight from the pan, with no water in it — at
 * about 14, a juicy wash at 2 and a thin one at 0.3, so this is a wash that has
 * been let down a little: dark enough in the middle of a ribbon to read as
 * paint rather than as a tint, and pale enough that where the ribbon draws out
 * thin it still shows what colour it is.
 *
 * It is the one number that has to be right, because Kubelka-Munk over a deep
 * enough layer is black whatever is in it — every paint in the box and every
 * mixture of them alike. Set at nine, which is where a first go put it, the
 * cell was a slow churn of near-black shapes: correct, and no use at all. The
 * range where a paint shows what it is turns out to be under about four.
 *
 * It is reached at the *thickest part of a cloud* rather than at a
 * concentration of one, because how much of a paint a cloud holds depends on
 * how strong that paint is — see {@link Pigment.pour}. So the whole palette is
 * scaled to arrive here together, and a cell of potter's pink is exactly as
 * deep as a cell of phthalo.
 */
const DEPTH = 2.2;

/**
 * Steps along each side of the colour table. See {@link Palette.lut}.
 *
 * Solving Kubelka-Munk needs an exponential per channel, and doing that per
 * pixel per frame costs about a millisecond and a half on the grid this runs
 * at — as much as the whole fluid step. The answer only depends on how much of
 * each of the three paints is in the pixel, though, so it is solved once for a
 * lattice of mixtures and read back with a straight interpolation. Twenty-one
 * steps a side is 9,261 mixtures, built in a couple of milliseconds when the
 * cell is filled and never touched again.
 */
const TABLE = 21;

/**
 * The white behind the paint.
 *
 * One, and not a paper's 0.92, because the white behind it is the chamber's own
 * ground: the cell is drawn over it with `multiply`, so a pixel holding no paint
 * has to come out as exactly the ground and not as a shade of it. Clear water
 * does not darken a lit cell.
 */
const GROUND = 1;

/** Screen gamma, for the one place linear light has to become a pixel. */
const GAMMA = 2.2;

/**
 * How dark the rim of a wash goes, at most.
 *
 * The one thing everybody recognises a watercolour by. Where a wash has an edge
 * the water leaves fastest at that edge, fluid runs out from the middle to
 * replace it and carries pigment with it, and the pigment piles up in a line
 * along the boundary. Nothing here evaporates, so this is the composite-time
 * shortcut from DiVerdi et al., _Painting with Polygons_ (TVCG 2013) that
 * paintwheel also uses: darken by how fast the pigment is changing rather than
 * by moving any. It costs four reads a pixel and it is what makes a ribbon read
 * as a shape with an edge instead of as a smear.
 */
const RIM = 0.34;

/** How sharply the paint has to change before the rim reads. See {@link RIM}. */
const RIM_GAIN = 1.3;

/**
 * Below this much paint altogether, a pixel is clear water.
 *
 * A hundredth of the depth at which the rim starts to show, and two hundredths
 * of a wash thin enough to see through — so what is skipped is genuinely the
 * white of the ground and not a faint tint of something.
 */
const CLEAR = 3e-4;

export interface Pigment {
  /** What it is called on the tube. */
  name: string;
  /** Absorption per channel, already scaled by tinting strength and {@link DEPTH}. */
  k: [number, number, number];
  /** Scattering per channel, likewise. */
  s: [number, number, number];
  /**
   * How fast it falls through the water, relative to the others.
   *
   * Paintwheel's density, straight across. It is a particle size as much as a
   * density — quinacridone is milled to a fraction of a micron and magnetite is
   * a coarse grit — and the spread across a paint box is more than five to one,
   * which is enough that a mixture visibly comes apart as it drifts.
   */
  weight: number;
  /**
   * How hard it flocculates, 0 smooth to 1 violently.
   *
   * Phthalo and quinacridone stay in an even dispersion; ultramarine, potter's
   * pink and magnetite black gather into clumps you can see with the naked eye.
   */
  grain: number;
  /**
   * How much of the cell's fill this one takes, 0 to 1.
   *
   * Tinting strength runs from about a third to three across a paint box, which
   * is nearly ten to one, and a cell filled with equal parts of Prussian and
   * potter's pink is a cell of Prussian. So the strong ones are poured
   * proportionally less: what is equal between them is how much colour each
   * one puts in the water, not how many grams. It is what anybody does at a
   * palette without thinking about it.
   */
  pour: number;
}

export interface Palette {
  /** The three paints in the cell. */
  paints: Pigment[];
  /**
   * Every mixture of them, solved and gamma-encoded.
   *
   * A cube {@link TABLE} a side, three bytes an entry, indexed by how much of
   * each paint is in the pixel. The axis is the *square root* of concentration,
   * so the steps are packed where the colour changes fastest — a thin wash goes
   * from nothing to something over a tenth of the range, and a deep one hardly
   * moves over the last half.
   */
  lut: Uint8Array;
}

/**
 * The paint box.
 *
 * Mass tone (`over` white) and undertone (`under`, over black) are the two
 * measurements that define a watercolour's optics: the first is what it looks
 * like straight from the pan, the second is what the same paint does when there
 * is nothing behind it to bounce off. Everything else is the pigment's
 * chemistry — how strong it is, how heavy, how coarse.
 */
const PAINTS = [
  {
    name: 'Cadmium Lemon',
    over: '#efe049',
    under: '#4e4a16',
    tint: 1.0,
    weight: 0.07,
    grain: 0.15,
  },
  {
    name: 'Irgazin Yellow',
    over: '#c3b022',
    under: '#1b1c05',
    tint: 1.5,
    weight: 0.03,
    grain: 0.1,
  },
  {
    // The warm yellow the box was missing. Every other yellow in here leans
    // green — the cadmium is a lemon, the irgazin is an olive-gold — and the
    // instrument leans green as well: the mirrors take a few per cent of the
    // light at every bounce and tint what is left as they go, so a pale cool
    // yellow arrives at the eye as khaki. It is the one place a palette of real
    // paints had to answer to the optics rather than to the paint box.
    name: 'New Gamboge',
    over: '#eda31e',
    under: '#4a2b05',
    tint: 1.4,
    weight: 0.05,
    grain: 0.2,
  },
  { name: 'Raw Siena', over: '#b98a3a', under: '#271a08', tint: 0.8, weight: 0.07, grain: 0.7 },
  { name: 'Burnt Siena', over: '#b46325', under: '#1f0f05', tint: 0.9, weight: 0.06, grain: 0.65 },
  {
    name: 'Pyrrole Scarlet',
    over: '#d63c2a',
    under: '#2b0a06',
    tint: 1.5,
    weight: 0.03,
    grain: 0.2,
  },
  {
    name: 'Quinacridone Pink',
    over: '#c93a86',
    under: '#1e0616',
    tint: 2,
    weight: 0.02,
    grain: 0.08,
  },
  {
    name: "Potter's Pink",
    over: '#c98d92',
    under: '#3a2426',
    tint: 0.35,
    weight: 0.08,
    grain: 0.95,
  },
  {
    name: 'Dioxazine Purple',
    over: '#7a52b5',
    under: '#12081f',
    tint: 2.2,
    weight: 0.02,
    grain: 0.15,
  },
  { name: 'Ultramarine', over: '#3b4fc0', under: '#0a0d2e', tint: 1.1, weight: 0.05, grain: 0.91 },
  { name: 'Prussian Blue', over: '#2e4a6b', under: '#050a12', tint: 3, weight: 0.02, grain: 0.15 },
  {
    name: 'Cobalt Turquoise',
    over: '#45a8b8',
    under: '#0d2a2e',
    tint: 0.8,
    weight: 0.08,
    grain: 0.85,
  },
  { name: 'Green', over: '#567f36', under: '#0c1607', tint: 1.8, weight: 0.04, grain: 0.35 },
  {
    name: 'Granulating Black',
    over: '#3a3835',
    under: '#090908',
    tint: 1.3,
    weight: 0.11,
    grain: 1,
  },
] as const;

/**
 * The sets of three the cell is filled from.
 *
 * Not three paints drawn at random, for the reason the lava's palette had to be
 * fixed as well: some triples are lovely and some are a puddle. Every one is
 * chosen so the three are of *different weights and different grains*, because
 * that is what makes the separating and the mottling visible. A cell of three
 * fine stainers behaves impeccably and looks like coloured water.
 *
 * **And every one of them is analogous** — the three sit inside about a third
 * of the colour wheel — which is a correction, and it is the same correction
 * the lava's own palette note records arriving at from the other direction.
 * These used to be *triads*: primaries spread evenly round the wheel, which is
 * what a painter sets out because a triad can reach every colour there is
 * between them. That is the right palette for a person choosing two of the
 * three at a time and the worst possible one for a cell that mixes all of them
 * with everything. The cell is sealed, so nothing ever leaves it: half a minute
 * of folding puts a little of all three into most of it, and a little of all
 * three of a triad is by construction the grey in the middle of the wheel.
 * Measured on a phone, a triad cell settled to a green-grey wash with two
 * ribbons of colour left in it inside forty seconds.
 *
 * Analogous, the same arithmetic has nowhere muddy to go: blue mixed with
 * violet is a blue-violet, and blue mixed with violet mixed with magenta is
 * still one. What is given up is the reach of the palette in any one cell,
 * which is what the seed is for — the reach is across the six of them.
 */
const PALETTES: readonly (readonly [string, string, string])[] = [
  // Violet through blue to a dusty rose. Potter's pink is the second most
  // granulating pigment there is and also the weakest, so it fills the cell and
  // the other two thread through it — and it is four times the dioxazine's
  // weight, which is what makes the pair come apart as they drift.
  ['Ultramarine', 'Dioxazine Purple', "Potter's Pink"],
  // Magenta through scarlet to a raw earth: the warm end, and the siena is
  // three times the weight of the quinacridone and eight times the grain.
  ['Quinacridone Pink', 'Pyrrole Scarlet', 'Raw Siena'],
  // Gold through burnt orange to magenta, and the warmest cell there is. It was
  // built on the cadmium lemon and had to be rebuilt: a cool yellow through six
  // green-leaning mirrors is khaki, and a cell of khaki and magenta was the
  // ugliest thing the substance made.
  ['New Gamboge', 'Burnt Siena', 'Quinacridone Pink'],
  // A green-gold yellow through green to turquoise. The turquoise is the
  // heaviest thing in the box short of the black and nearly three times the
  // irgazin, so it drops out of the mix almost as you watch.
  ['Irgazin Yellow', 'Green', 'Cobalt Turquoise'],
  // Green through turquoise to a deep blue. Prussian overpowers everything,
  // which is why it is poured at a sixth of what the turquoise is.
  ['Green', 'Cobalt Turquoise', 'Prussian Blue'],
  // Turquoise through blue to violet, and the coolest cell there is.
  ['Cobalt Turquoise', 'Ultramarine', 'Dioxazine Purple'],
  // There is no seventh, and what is missing from it is the magnetite black —
  // the best granulator in the box, coarse, the heaviest thing in it, and the
  // fastest to fall out of suspension. It had a palette of its own and it lost
  // it: a black paint has no hue, so half a cell of it is a grey whatever it is
  // standing next to, which is the exact complaint these palettes were rebuilt
  // to answer. It stays in {@link PAINTS} — it is a measured paint, and if this
  // cell ever grows an ink-wash mode meant to be grey it is the paint for it.
];

/**
 * Picks a palette and solves its colour table, deterministically.
 *
 * Kept once made. There are only as many palettes as there are entries in
 * {@link PALETTES}, and solving one is a few thousand exponentials — cheap
 * enough to do when a cell is filled, not cheap enough to do again every time a
 * slider moves and the cell is rebuilt.
 */
export function createPalette(seed: number): Palette {
  const rng = mulberry32(seed);

  return paletteAt(Math.floor(rng() * PALETTES.length));
}

/** How many sets of three there are to choose from. */
export const PALETTE_COUNT = PALETTES.length;

/** One numbered palette, solved once and kept. See {@link createPalette}. */
export function paletteAt(index: number): Palette {
  const which = ((index % PALETTES.length) + PALETTES.length) % PALETTES.length;
  const known = solved.get(which);

  if (known) {
    return known;
  }

  const chosen = PALETTES[which]!.map((name) => PAINTS.find((paint) => paint.name === name)!);
  // Pour by the reciprocal of tinting strength, scaled so the weakest of the
  // three fills the cell and the rest are let down against it. See Pigment.pour.
  const weakest = Math.min(...chosen.map((paint) => paint.tint));
  const paints = chosen.map((paint) => {
    // Absorption is quoted per unit of paint; this puts it per unit of *cell*,
    // so that a full cloud of any of the three arrives at DEPTH together.
    const { k, s } = absorption(paint.over, paint.under);
    const scale = (paint.tint * DEPTH) / weakest;

    return {
      name: paint.name,
      k: k.map((channel) => channel * scale) as [number, number, number],
      s: s.map((channel) => channel * scale) as [number, number, number],
      weight: paint.weight,
      grain: paint.grain,
      pour: weakest / paint.tint,
    };
  });
  const palette = { paints, lut: solve(paints) };

  solved.set(which, palette);

  return palette;
}

/** Every palette that has been asked for so far. See {@link createPalette}. */
const solved = new Map<number, Palette>();

/**
 * Kubelka-Munk: what one layer of paint over a white ground reflects.
 *
 * `k` and `s` are the mixture's absorption and scattering, already multiplied
 * by how much of it there is, so they are an optical depth rather than a
 * property of the paint. The layer both reflects some of the light straight
 * back (`reflect`) and lets some through to the ground and back out again
 * (`through`, twice, with what bounces between the two summed as a series).
 *
 * This is the whole of why the colour mixing is worth having: it is one
 * equation over the mixture rather than an average of the parts, so a paint
 * that scatters and a paint that only absorbs do different things to each
 * other, and the answer is what the two of them together look like.
 */
export function kubelka(k: number, s: number, ground = GROUND): number {
  if (s <= 1e-9 && k <= 1e-9) {
    return ground;
  }

  const a = 1 + k / Math.max(s, 1e-6);
  const b = Math.sqrt(Math.max(a * a - 1, 1e-8));
  // Twenty is opaque to any precision anyone can see, and it keeps the
  // exponential below from running away.
  const depth = Math.min(b * Math.max(s, 1e-6), 20);
  const rise = Math.exp(depth);
  const sinh = (rise - 1 / rise) / 2;
  const cosh = (rise + 1 / rise) / 2;
  const under = a * sinh + b * cosh;
  const reflect = sinh / under;
  const through = b / under;

  return Math.min(
    1,
    Math.max(0, reflect + (through * through * ground) / Math.max(1 - reflect * ground, 1e-4)),
  );
}

/** Solves every mixture of the three onto a lattice. See {@link Palette.lut}. */
function solve(paints: Pigment[]): Uint8Array {
  const lut = new Uint8Array(TABLE * TABLE * TABLE * 3);
  // The lattice is square-rooted, so undo that to get back to concentration.
  const amounts = Array.from({ length: TABLE }, (_, step) => (step / (TABLE - 1)) ** 2);

  for (let c = 0; c < TABLE; c += 1) {
    for (let b = 0; b < TABLE; b += 1) {
      for (let a = 0; a < TABLE; a += 1) {
        const parts = [amounts[a]!, amounts[b]!, amounts[c]!];
        const at = ((c * TABLE + b) * TABLE + a) * 3;

        for (let channel = 0; channel < 3; channel += 1) {
          let k = 0;
          let s = 0;

          for (let paint = 0; paint < paints.length; paint += 1) {
            k += parts[paint]! * paints[paint]!.k[channel]!;
            s += parts[paint]! * paints[paint]!.s[channel]!;
          }

          lut[at + channel] = Math.round(255 * kubelka(k, s) ** (1 / GAMMA));
        }
      }
    }
  }

  return lut;
}

/**
 * Reads a mixture back out of the table, interpolated.
 *
 * Trilinear across the eight lattice points around it, so a wash that thins
 * smoothly reads as a smooth ramp rather than as twenty-one bands. The
 * interpolation is done on the gamma-encoded values rather than on light, which
 * is wrong by a fraction of a step and saves three powers a pixel.
 */
export function mixture(palette: Palette, parts: number[], into: number[]): void {
  const { lut } = palette;
  let base = 0;
  let corner = 1;

  // Where in the lattice, and how far between the two neighbours on each side.
  for (let paint = 0; paint < 3; paint += 1) {
    const at = Math.sqrt(Math.min(1, Math.max(0, parts[paint]!))) * (TABLE - 1);
    const low = Math.min(TABLE - 2, Math.floor(at));

    base += low * corner;
    fraction[paint] = at - low;
    corner *= TABLE;
  }

  const [fa, fb, fc] = [fraction[0]!, fraction[1]!, fraction[2]!];
  const step = TABLE;
  const plane = TABLE * TABLE;

  for (let channel = 0; channel < 3; channel += 1) {
    const at = base * 3 + channel;
    const near = lut[at]! * (1 - fa) + lut[at + 3]! * fa;
    const far = lut[at + step * 3]! * (1 - fa) + lut[at + (step + 1) * 3]! * fa;
    const nearUp = lut[at + plane * 3]! * (1 - fa) + lut[at + (plane + 1) * 3]! * fa;
    const farUp = lut[at + (plane + step) * 3]! * (1 - fa) + lut[at + (plane + step + 1) * 3]! * fa;

    into[channel] = (near * (1 - fb) + far * fb) * (1 - fc) + (nearUp * (1 - fb) + farUp * fb) * fc;
  }
}

/** Scratch for {@link mixture}, which is called once per pixel per frame. */
const fraction = [0, 0, 0];

/**
 * Turns a paint's mass tone and undertone into absorption and scattering.
 *
 * The inversion in Curtis et al., Appendix A: a paint measured over white and
 * over black is two equations in the layer's two unknowns, and this solves
 * them. Both are clamped away from the ends first — a measurement of exactly
 * black or exactly white is a paint with infinite absorption or none, and
 * neither is a paint.
 */
function absorption(
  over: string,
  under: string,
): { k: [number, number, number]; s: [number, number, number] } {
  const white = linear(over);
  const black = linear(under);
  const k: [number, number, number] = [0, 0, 0];
  const s: [number, number, number] = [0, 0, 0];

  for (let channel = 0; channel < 3; channel += 1) {
    const light = Math.min(0.985, Math.max(0.005, white[channel]!));
    const dark = Math.min(0.98, Math.max(0.001, Math.min(black[channel]!, light - 0.004)));
    const a = 0.5 * (light + (dark - light + 1) / dark);
    const b = Math.sqrt(Math.max(a * a - 1, 1e-8));
    const arg = Math.max((b * b - (a - light) * (a - 1)) / (b * (1 - light)), 1 + 1e-6);

    s[channel] = Math.max(Math.log((arg + 1) / (arg - 1)) / 2 / b, 1e-4);
    k[channel] = s[channel]! * (a - 1);
  }

  return { k, s };
}

/** A `#rrggbb` string as light rather than as a pixel value. */
function linear(hex: string): [number, number, number] {
  return [1, 3, 5].map((at) => (parseInt(hex.slice(at, at + 2), 16) / 255) ** GAMMA) as [
    number,
    number,
    number,
  ];
}

/**
 * The tooth of the paper, and what it does to a wash.
 *
 * A sheet of cold-pressed watercolour paper is a felted mat of fibres pressed
 * between blankets, and what it leaves is a landscape of pits and peaks about a
 * fifth of a millimetre across. A wash floods it, the water drains into the
 * pits, and the pigment goes with the water: a flat wash on a rough sheet is
 * not flat, it is a field of little dark hollows and little pale ridges. That
 * texture is most of what makes a watercolour look like one, it is the thing a
 * digital wash is always missing, and unlike everything else the paper does it
 * is visible in a single frame rather than over a drying time.
 *
 * Two numbers, and they are separate on purpose. {@link PAPER_BITE} is how much
 * more pigment the pits hold than the peaks, which is the granulating texture
 * and only shows where there is paint. {@link PAPER_FIBRE} is the shading of
 * the bare sheet — the pits are in shadow whether or not anything has been
 * painted on them — and it is the reason the white of this cell is a *white
 * sheet* rather than a flat 255. It has to be small: the folded picture repeats
 * the same square dozens of times, so anything loud enough to notice once is a
 * pattern the second time.
 */
const PAPER_BITE = 0.2;
const PAPER_FIBRE = 0.028;

/**
 * How coarse the tooth is, in painted pixels, and how much of each size there
 * is.
 *
 * Three sizes, not one, and for the reason the flocs have two: a single size of
 * noise reads as a screen door laid over the picture, and paper does not have
 * one size. The finest is the individual pits, the middle one the grain of the
 * felt, the coarsest the way the sheet's own making varies across it.
 *
 * The sizes are not multiples of each other, and each octave is read along its
 * own axis — see {@link TOOTH_TURNS}. `lib/noise.ts` is value noise, which is
 * smooth but lattice-aligned: it has a faint square grid in it, harmless where
 * that module is used (buried inside a fluid, differentiated first) and not
 * harmless at all here, where the field is looked at directly and magnified.
 * Stacked in register, three octaves of it agreed about where their squares
 * were and the sheet came out as a dither pattern rather than as paper —
 * plainly so at the top of the zoom slider, which is where a texture is looked
 * at hardest. Turned against each other, there is no shared lattice left to
 * see.
 */
const TOOTH_SIZES = [5, 11, 24] as const;
const TOOTH_PARTS = [0.48, 0.33, 0.19] as const;

/** Which way each octave's own lattice runs, in radians. Nothing shared. */
const TOOTH_TURNS = [0.31, 1.19, 2.42] as const;

export interface Paper {
  /** Pixels across. This is the size of the *picture*, not of the fluid's grid. */
  readonly size: number;
  /** The tooth, 0 in the deepest pit to 1 on the highest peak, middling a half. */
  readonly tooth: Float32Array;
}

/**
 * Cuts a sheet of paper for a cell, deterministically.
 *
 * Made once when the cell is filled and never again: it is a property of the
 * sheet and not of anything in the water, and every frame of a cell is painted
 * on the same sheet. Thirty-odd thousand samples of two-octave value noise,
 * which is a couple of milliseconds the one time it is done.
 */
export function createPaper(size: number, seed: number): Paper {
  const grain = createNoise(seed ^ 0x9e37);
  const tooth = new Float32Array(size * size);
  const turns = TOOTH_TURNS.map((angle) => ({ cos: Math.cos(angle), sin: Math.sin(angle) }));

  for (let j = 0; j < size; j += 1) {
    for (let i = 0; i < size; i += 1) {
      let much = 0;

      for (let octave = 0; octave < TOOTH_SIZES.length; octave += 1) {
        const at = TOOTH_SIZES[octave]!;
        const { cos, sin } = turns[octave]!;

        much +=
          TOOTH_PARTS[octave]! *
          grain((i * cos - j * sin) / at, (i * sin + j * cos) / at, octave * 11.7);
      }

      tooth[i + j * size] = Math.min(1, Math.max(0, 0.5 + much * 1.35));
    }
  }

  return { size, tooth };
}

/**
 * How coarse the clumps are, in grid cells.
 *
 * Two sizes together, because real flocculation has both: a fine speckle where
 * single particles gather, and a coarser drift where the speckle itself pools.
 * One size alone reads as a texture laid over the picture rather than as
 * something in the water.
 */
const FLOC_SIZES = [3.5, 9] as const;

/** How much of the coarse size there is against the fine. */
const FLOC_MIX = 0.42;

/**
 * How long a clump lasts, in seconds.
 *
 * Flocs are not a pattern printed on the fluid — they gather, drift, break up
 * and gather again somewhere else. Carrying the field along with the water and
 * nothing more would be a pattern, and a fading one: the trace blurs it a
 * little every step, so within a minute a cell of vivid mottle is a cell of
 * flat wash. So a little fresh clumping is folded in every step, which both
 * keeps the mottle alive and is the truer story of what the pigment is doing.
 *
 * Long rather than short, and that is the whole tuning: fold fresh clumping in
 * quickly and the mottle stops travelling with the paint and sits still in the
 * cell instead, which is paper grain and not flocculation. Five seconds is long
 * enough that what you see is mostly being carried, and short enough that it
 * never settles into a fixed pattern.
 */
const FLOC_LIFE = 5;

/** How far the fresh clumping drifts each second, in clumps. */
const FLOC_DRIFT = 0.11;

/**
 * How far the mottle spreads either side of even.
 *
 * At one it would be the difference between twice the pigment and none of it,
 * which is more than any wash does. Just over half is a strong granulating
 * paint seen close up — and it is *scaled by the paint's own grain*, so this is
 * what ultramarine gets and phthalo gets a twentieth of it. Measured across an
 * even wash: ultramarine varies from pixel to pixel by 17 values out of 255
 * against quinacridone's 1.7, which is the separation the real pair have.
 */
export const FLOC_DEPTH = 0.62;

export interface Flocs {
  /** Cells across the chamber, matching the fluid's grid. */
  readonly grid: number;
  /** Where the clumps are, 0 to 1 about a middle of a half. Carried by the fluid. */
  where: Float32Array;
  /** Somewhere to carry into while the old field is still being read. */
  where0: Float32Array;
  /**
   * The clumping the water keeps making.
   *
   * Held rather than generated per step: value noise costs eight hashes a
   * sample and there are nine thousand cells, so a field made fresh every step
   * would spend a millisecond a frame on it. Made once and read at an offset
   * that drifts, which is a clumping that never repeats itself and costs four
   * array reads a cell.
   */
  fresh: Float32Array;
  /**
   * How fast a paint falls here, against how fast it falls on average.
   *
   * The clumping again, read as a rate rather than as a colour: a floc is a
   * bigger particle and a bigger particle falls faster. Kept as its own array
   * so the advection can read it without working it out per cell per paint.
   */
  settling: Float32Array;
}

/** Builds a cell's clumping, deterministically. */
export function createFlocs(grid: number, seed: number): Flocs {
  const cells = grid * grid;
  const draught = createNoise(seed);
  const fresh = new Float32Array(cells);

  for (let j = 0; j < grid; j += 1) {
    for (let i = 0; i < grid; i += 1) {
      let much = 0;

      for (let octave = 0; octave < FLOC_SIZES.length; octave += 1) {
        const size = FLOC_SIZES[octave]!;
        const part = octave === 0 ? 1 - FLOC_MIX : FLOC_MIX;

        much += part * draught(i / size, j / size, octave * 7.3);
      }

      // Averaging two octaves pulls the spread in towards the middle, so it is
      // opened back out again: a mottle that never reaches either end is a
      // mottle nobody can see.
      fresh[i + j * grid] = Math.min(1, Math.max(0, 0.5 + much * 0.9));
    }
  }

  const where = new Float32Array(cells);

  where.set(fresh);

  const flocs = {
    grid,
    where,
    where0: new Float32Array(cells),
    fresh,
    settling: new Float32Array(cells),
  };

  rate(flocs);

  return flocs;
}

/**
 * How much faster than average the paint falls in each cell. See
 * {@link Flocs.settling}.
 *
 * Centred on one, so the palette's weights still say what they say and this
 * only spreads them about. Wide, because a narrow spread does not break the
 * grid lock the drift would otherwise fall into.
 */
function rate(flocs: Flocs): void {
  const { where, settling } = flocs;

  for (let at = 0; at < where.length; at += 1) {
    settling[at] = 0.4 + 1.2 * where[at]!;
  }
}

/**
 * Folds a little fresh clumping into a field the fluid has carried.
 *
 * See {@link FLOC_LIFE}. What is folded in is the same clumping read a little
 * further along, so it is never quite what is already there.
 */
export function stirFlocs(flocs: Flocs, elapsed: number, step: number): void {
  const { grid, where, fresh } = flocs;
  const share = Math.min(1, step / FLOC_LIFE);
  const shift = elapsed * FLOC_DRIFT;
  // Two different rates, so the offset never retraces its own path.
  const alongX = shift * FLOC_SIZES[0];
  const alongY = shift * FLOC_SIZES[0] * 0.63;

  for (let j = 0; j < grid; j += 1) {
    for (let i = 0; i < grid; i += 1) {
      const at = i + j * grid;

      where[at] = where[at]! * (1 - share) + wrapped(fresh, grid, i + alongX, j + alongY) * share;
    }
  }

  rate(flocs);
}

/** A bilinear read that wraps, so the clumping has no seam and no edge. */
function wrapped(field: Float32Array, grid: number, x: number, y: number): number {
  const gx = Math.floor(x);
  const gy = Math.floor(y);
  const fx = x - gx;
  const fy = y - gy;
  const x0 = wrap(gx, grid);
  const x1 = wrap(gx + 1, grid);
  const y0 = wrap(gy, grid) * grid;
  const y1 = wrap(gy + 1, grid) * grid;

  return (
    (1 - fy) * (field[x0 + y0]! * (1 - fx) + field[x1 + y0]! * fx) +
    fy * (field[x0 + y1]! * (1 - fx) + field[x1 + y1]! * fx)
  );
}

function wrap(at: number, side: number): number {
  return ((at % side) + side) % side;
}

/**
 * Paints a cell of watercolour onto a sheet of paper, over a white ground.
 *
 * Four things happen here and none of them is a colour being mixed with
 * another colour:
 *
 * 1. **Clumping.** How much of each paint a pixel holds is pushed either side
 *    of even by where the flocs are, scaled by that paint's own coarseness.
 *    Ultramarine swings by half; phthalo hardly moves. It is done at painting
 *    time rather than by actually gathering the pigment, because a mottle that
 *    is only ever looked at does not have to be conserved — the same shortcut
 *    paintwheel takes against the tooth of its paper.
 * 2. **Mixing.** The three concentrations go into Kubelka-Munk together and one
 *    colour comes out. See {@link mixture}.
 * 3. **The rim.** Where the amount of paint changes fastest, it darkens. See
 *    {@link RIM}.
 * 4. **The paper.** All of the above is solved on the fluid's own grid, and
 *    then laid onto a sheet several times finer than that: the wash is
 *    reconstructed between cells with an eased weight, and the tooth darkens
 *    the pits and skips the peaks. See {@link Paper}.
 *
 * The last of those is why this is two passes rather than one. Kubelka-Munk is
 * the expensive part and it wants the coarse grid, because the concentrations
 * are the fluid's and the fluid has no detail finer than a cell; the paper is
 * the cheap part and wants the fine one, because a tooth quantised to the
 * fluid's grid is not a tooth, it is a checkerboard.
 *
 * Writes RGBA into `pixels`, which is {@link Paper.size} square. Subtractive,
 * so a pixel holding no paint comes out as the white of the sheet and the whole
 * thing is drawn with `multiply` over the chamber's own ground.
 */
export function paintPigment(
  palette: Palette,
  held: Float32Array[],
  flocs: Flocs,
  paper: Paper,
  strength: number,
  pixels: Uint8ClampedArray,
): void {
  const { paints } = palette;
  const { grid, where } = flocs;
  const cells = grid * grid;

  if (loaded.length !== cells) {
    loaded = new Float32Array(cells);
  }

  if (washed.length !== cells * 4) {
    washed = new Float32Array(cells * 4);
  }

  for (let k = 0; k < cells; k += 1) {
    let sum = 0;

    for (let paint = 0; paint < paints.length; paint += 1) {
      sum += held[paint]![k]!;
    }

    loaded[k] = sum;
  }

  for (let j = 0; j < grid; j += 1) {
    for (let i = 0; i < grid; i += 1) {
      const k = i + j * grid;
      const at = k * 4;

      // Clear water, which most of a cell usually is. Nothing to solve: the
      // table's own answer for no paint at all is the ground it was solved
      // over, and the rim below is already faded out well above this. Worth a
      // sixth of the pass on a cell three-quarters full of paint, and more on
      // any cell holding less than that.
      if (loaded[k]! < CLEAR) {
        washed[at] = 255;
        washed[at + 1] = 255;
        washed[at + 2] = 255;
        washed[at + 3] = 0;
        continue;
      }

      // Either side of even, so a floc takes paint from between the flocs
      // rather than adding paint that was never poured.
      const clump = (where[k]! - 0.5) * 2;

      for (let paint = 0; paint < paints.length; paint += 1) {
        parts[paint] = Math.min(
          1,
          Math.max(
            0,
            held[paint]![k]! * strength * (1 + paints[paint]!.grain * FLOC_DEPTH * clump),
          ),
        );
      }

      mixture(palette, parts, tone);

      // Read across four cells rather than one, so the clumping above — which
      // is the sharpest thing in the picture — does not itself read as an edge.
      const across = loadAt(grid, i + 2, j) - loadAt(grid, i - 2, j);
      const down = loadAt(grid, i, j + 2) - loadAt(grid, i, j - 2);
      const rim =
        Math.min(RIM, Math.hypot(across, down) * 0.5 * RIM_GAIN) * shows(loaded[k]!, 0.03, 0.35);

      washed[at] = tone[0]! * (1 - rim);
      washed[at + 1] = tone[1]! * (1 - rim);
      washed[at + 2] = tone[2]! * (1 - rim);
      // How hard the tooth is allowed to bite here. Granulation is a thing
      // pigment does, so a bare sheet gets only its own shading and a loaded
      // one gets the lot.
      washed[at + 3] = shows(loaded[k]!, 0, 0.22);
    }
  }

  laydown(paper, grid, pixels);
}

/**
 * Lays a wash solved on the fluid's grid onto the sheet it is painted on.
 *
 * The eased bilinear is the same one the lava and the oil film reconstruct
 * their fields with, and it is here for the same reason: a straight bilinear
 * has a kink in it at every cell boundary, and a kink every three pixels is a
 * texture of its own competing with the one this function exists to draw.
 */
function laydown(paper: Paper, grid: number, pixels: Uint8ClampedArray): void {
  const { size, tooth } = paper;

  if (lowAt.length !== size || spanned !== grid) {
    lowAt = new Int32Array(size);
    highAt = new Int32Array(size);
    blend = new Float32Array(size);
    spanned = grid;

    for (let i = 0; i < size; i += 1) {
      // Cell centres to pixel centres, so the two grids share a middle and the
      // wash does not creep half a cell towards one corner.
      const at = ((i + 0.5) * grid) / size - 0.5;
      const cell = Math.floor(at);

      lowAt[i] = Math.min(grid - 1, Math.max(0, cell));
      highAt[i] = Math.min(grid - 1, Math.max(0, cell + 1));
      blend[i] = smooth(at - cell);
    }
  }

  for (let j = 0; j < size; j += 1) {
    const up = lowAt[j]! * grid;
    const down = highAt[j]! * grid;
    const fy = blend[j]!;

    for (let i = 0; i < size; i += 1) {
      const fx = blend[i]!;
      const a = (up + lowAt[i]!) * 4;
      const b = (up + highAt[i]!) * 4;
      const c = (down + lowAt[i]!) * 4;
      const d = (down + highAt[i]!) * 4;
      const wa = (1 - fy) * (1 - fx);
      const wb = (1 - fy) * fx;
      const wc = fy * (1 - fx);
      const wd = fy * fx;
      const k = i + j * size;
      const at = k * 4;
      // Positive in a pit and negative on a peak. The pits hold the water, the
      // water holds the pigment, and the peaks are where a wash skips.
      const hollow = 1 - 2 * tooth[k]!;
      const bite =
        1 -
        hollow *
          (PAPER_FIBRE +
            PAPER_BITE *
              (washed[a + 3]! * wa +
                washed[b + 3]! * wb +
                washed[c + 3]! * wc +
                washed[d + 3]! * wd));

      pixels[at] = (washed[a]! * wa + washed[b]! * wb + washed[c]! * wc + washed[d]! * wd) * bite;
      pixels[at + 1] =
        (washed[a + 1]! * wa + washed[b + 1]! * wb + washed[c + 1]! * wc + washed[d + 1]! * wd) *
        bite;
      pixels[at + 2] =
        (washed[a + 2]! * wa + washed[b + 2]! * wb + washed[c + 2]! * wc + washed[d + 2]! * wd) *
        bite;
      pixels[at + 3] = 255;
    }
  }
}

/** Smoothstep, so the join between two cells of the wash has no kink in it. */
function smooth(at: number): number {
  return at * at * (3 - 2 * at);
}

/** The wash, solved on the fluid's grid: three channels and how loaded it is. */
let washed = new Float32Array(0);

/** Which two cells of the wash each painted pixel reads, and how far between. */
let lowAt = new Int32Array(0);
let highAt = new Int32Array(0);
let blend = new Float32Array(0);
let spanned = 0;

/** How much paint a cell holds, with nothing beyond the grid. */
function loadAt(grid: number, i: number, j: number): number {
  if (i < 0 || i >= grid || j < 0 || j >= grid) {
    return 0;
  }

  return loaded[i + j * grid]!;
}

/** A smooth nought-to-one across a range, for fading an effect in. */
function shows(value: number, from: number, to: number): number {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)));

  return t * t * (3 - 2 * t);
}

/** How much paint is in each cell altogether, for the rim. */
let loaded = new Float32Array(0);

/** Scratch for one pixel's worth, which is worked out thousands of times a frame. */
const parts = [0, 0, 0];
const tone = [0, 0, 0];
