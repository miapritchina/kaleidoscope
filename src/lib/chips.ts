import { pickGlassColor, rgbToCss, type Palette, type Rgb } from './palettes';
import { hashSeed, mulberry32, randomBetween, type Rng } from './random';
import type { ShardKind } from './scene';

/**
 * Pre-rendered glass chips.
 *
 * A kaleidoscope is held up to a light, so a chip is not a lit object on a dark
 * field — it is a hole in the light with a colour. What you see is the light
 * that survived the glass, which is why these are stamped with `multiply`
 * (see `drawChamber`) and why they are drawn as absorption rather than paint:
 *
 * - **The body** takes the glass's transmission colour out of the light.
 * - **The rim** is darker, because light entering near an edge crosses more
 *   glass and meets the bevel at a grazing angle.
 * - **The facets** are hard-edged, not a soft gradient. Broken glass is a solid
 *   with flat faces, and each face turns the light a different way; a smooth
 *   airbrushed falloff is what makes rendered glass read as plastic.
 *
 * Building all that per chip per frame would mean several gradients and a
 * dozen path fills for every one of hundreds of draws, so each shape-and-colour
 * combination is rendered once into a small canvas and stamped from then on —
 * the same trick the mirror triangle uses, one level down.
 */
export interface ChipSprites {
  readonly palette: Palette;
  /**
   * The sprite for a chip.
   *
   * @param kind Which family of fragment.
   * @param colorStop Position along the palette; quantised to the cached steps.
   * @param variant Which cut of that fragment, so no two chips are twins.
   */
  get(kind: ShardKind, colorStop: number, variant?: number): CanvasImageSource | null;
  /** Side of every sprite, in pixels. Chips are scaled from this. */
  readonly size: number;
}

/** Distinct cuts rendered per shape, so a chamber is not full of identical glass. */
export const CHIP_VARIANTS = 3;

export interface ChipSpriteOptions {
  /** Distinct colours rendered per shape. Defaults to the palette's own. */
  steps?: number;
  /** Side of each sprite in pixels. */
  size?: number;
  createCanvas?: () => HTMLCanvasElement;
}

/** Builds the sprite sheet for a palette. Cheap enough to redo on palette change. */
export function createChipSprites(palette: Palette, options: ChipSpriteOptions = {}): ChipSprites {
  const steps = Math.max(1, options.steps ?? palette.colors.length);
  const size = Math.max(8, options.size ?? 96);
  const create = options.createCanvas ?? (() => document.createElement('canvas'));
  const cache = new Map<string, HTMLCanvasElement | null>();

  return {
    palette,
    size,
    get(kind, colorStop, variant = 0) {
      const step = ((Math.round(colorStop * steps) % steps) + steps) % steps;
      const cut = ((Math.round(variant) % CHIP_VARIANTS) + CHIP_VARIANTS) % CHIP_VARIANTS;
      const key = `${kind}:${step}:${cut}`;
      const cached = cache.get(key);

      if (cached !== undefined) {
        return cached;
      }

      const sprite = renderChip(create, kind, cut, pickGlassColor(palette, step / steps), size);
      cache.set(key, sprite);

      return sprite;
    },
  };
}

function renderChip(
  create: () => HTMLCanvasElement,
  kind: ShardKind,
  variant: number,
  color: Rgb,
  size: number,
): HTMLCanvasElement | null {
  const canvas = create();
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext('2d');

  if (!ctx) {
    return null;
  }

  const centre = size / 2;
  // Leave room for the rim to sit inside the sprite.
  const radius = centre * 0.94;
  const cut = CUTS[kind];
  const outline = outlineFor(kind, variant, radius);

  ctx.translate(centre, centre);

  // The body: what the light looks like after crossing the middle of the chip.
  ctx.fillStyle = rgbToCss(color, 0.94);
  tracePolygon(ctx, outline);
  ctx.fill();

  // The bevel: the ring of ground faces between the flat top and the edge. It
  // is the single most recognisable thing about a piece of cut glass, and the
  // reason a lit chip has a bright interior with a distinctly darker border
  // rather than one even wash of colour.
  const table = scalePolygon(outline, 0.62);

  // The faces of that bevel, shaded by how far each turns from the light. Hard
  // edges between them, because a ground face is flat: a smooth falloff here is
  // what makes rendered glass read as moulded plastic.
  for (let face = 0; face < cut.faces; face += 1) {
    const from = Math.round((face * outline.length) / cut.faces);
    const to = Math.round(((face + 1) * outline.length) / cut.faces);
    const near = outline[from % outline.length]!;
    const far = outline[to % outline.length]!;
    // Which way the face looks, from the middle of the chip out past its edge.
    const facing = Math.atan2((near.y + far.y) / 2, (near.x + far.x) / 2);
    // The light is over the viewer's shoulder, up and to the left, the way it
    // is in every photograph anyone takes down one of these.
    const lit = Math.cos(facing - LIGHT_ANGLE);

    traceBevelFace(ctx, outline, table, from, to);
    ctx.fillStyle =
      lit >= 0
        ? rgbToCss(WHITE, lit * 0.34) // Facing the light: thin, and it shines.
        : rgbToCss(shade(color, 0.55), -lit * 0.5);
    ctx.fill();
  }

  // The catch-light: a small face turned straight at the light. Glass is
  // specular, and one hard white spark is most of what separates it from a
  // coloured shape. Clipped to the chip, since an irregular cut can put it
  // near enough to an edge to hang over it.
  ctx.save();
  tracePolygon(ctx, outline);
  ctx.clip();
  ctx.fillStyle = rgbToCss(WHITE, 0.55);
  tracePolygon(
    ctx,
    translatePolygon(scalePolygon(table, cut.spark), {
      x: Math.cos(LIGHT_ANGLE) * radius * 0.3,
      y: Math.sin(LIGHT_ANGLE) * radius * 0.3,
    }),
  );
  ctx.fill();
  ctx.restore();

  // The rim. Light entering here crosses the most glass and meets the edge
  // side-on, so the border of a piece of glass is always its darkest part.
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(1, radius * 0.09);
  ctx.strokeStyle = rgbToCss(shade(color, 0.55), 0.85);
  tracePolygon(ctx, outline);
  ctx.stroke();

  return canvas;
}

/** How each family of fragment is ground: bevel faces, and the size of its spark. */
const CUTS: Record<ShardKind, { faces: number; spark: number }> = {
  triangle: { faces: 3, spark: 0.34 },
  shard: { faces: 3, spark: 0.3 },
  bead: { faces: 4, spark: 0.28 },
  // A splinter is thin enough to have two ground faces and no room for more.
  sliver: { faces: 2, spark: 0.22 },
};

/** Where the light is, as an angle in the sprite's own frame. */
const LIGHT_ANGLE = (-3 * Math.PI) / 4;

const WHITE: Rgb = { r: 255, g: 255, b: 255 };

interface Point {
  x: number;
  y: number;
}

/**
 * The outline of one cut of one kind of fragment.
 *
 * Generated from a seed fixed by the kind and the cut rather than written out,
 * so every chip is irregular the way broken glass is while staying identical
 * between runs — the sprite cache and the seeded scene both depend on that.
 */
function outlineFor(kind: ShardKind, variant: number, radius: number): Point[] {
  const rng = mulberry32(hashSeed(`${kind}:${String(variant)}`));

  switch (kind) {
    case 'triangle':
      return polygon(rng, radius, 3, 0.18, 1);
    case 'shard':
      // Four or five corners, unevenly spaced: a piece off a broken sheet.
      return polygon(rng, radius, rng() < 0.5 ? 4 : 5, 0.3, 1);
    case 'bead':
      // Many small faces, so it reads as a rounded, tumbled bead.
      return polygon(rng, radius, 9, 0.06, 1);
    case 'sliver':
      // A splinter: the same construction, squashed onto one axis.
      return polygon(rng, radius, 4, 0.22, 0.32);
  }
}

/**
 * A closed irregular polygon.
 *
 * @param jitter How far the corners stray from a regular polygon, as a fraction.
 * @param flatten Scale applied across the shape, for long thin pieces.
 */
function polygon(
  rng: Rng,
  radius: number,
  corners: number,
  jitter: number,
  flatten: number,
): Point[] {
  const step = (Math.PI * 2) / corners;
  const spin = rng() * Math.PI * 2;
  const points: Point[] = [];

  for (let corner = 0; corner < corners; corner += 1) {
    const angle = spin + corner * step + randomBetween(rng, -jitter, jitter) * step;
    const reach = radius * (1 - randomBetween(rng, 0, jitter));

    points.push({ x: Math.cos(angle) * reach, y: Math.sin(angle) * reach * flatten });
  }

  return points;
}

function tracePolygon(ctx: CanvasRenderingContext2D, points: Point[]): void {
  ctx.beginPath();

  for (const [index, point] of points.entries()) {
    if (index === 0) {
      ctx.moveTo(point.x, point.y);
    } else {
      ctx.lineTo(point.x, point.y);
    }
  }

  ctx.closePath();
}

/**
 * Traces one face of the bevel: the band between the chip's edge and its top,
 * spanning corners `from` up to `to`.
 */
function traceBevelFace(
  ctx: CanvasRenderingContext2D,
  outline: Point[],
  table: Point[],
  from: number,
  to: number,
): void {
  const count = outline.length;
  const steps = (((to - from) % count) + count) % count || count;

  ctx.beginPath();

  for (let step = 0; step <= steps; step += 1) {
    const point = outline[(from + step) % count]!;

    if (step === 0) {
      ctx.moveTo(point.x, point.y);
    } else {
      ctx.lineTo(point.x, point.y);
    }
  }

  // Back along the top, so the two arcs close into a band instead of crossing.
  for (let step = steps; step >= 0; step -= 1) {
    const point = table[(from + step) % count]!;
    ctx.lineTo(point.x, point.y);
  }

  ctx.closePath();
}

/** The same outline, shrunk towards the middle. */
function scalePolygon(points: Point[], scale: number): Point[] {
  return points.map((point) => ({ x: point.x * scale, y: point.y * scale }));
}

function translatePolygon(points: Point[], by: Point): Point[] {
  return points.map((point) => ({ x: point.x + by.x, y: point.y + by.y }));
}

/** Darkens towards black, for the parts of a chip the light crosses furthest. */
function shade({ r, g, b }: Rgb, amount: number): Rgb {
  const keep = 1 - amount;

  return { r: r * keep, g: g * keep, b: b * keep };
}
