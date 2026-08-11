import { pickGlassColor, rgbToCss, type Palette, type Rgb } from './palettes';
import { hashSeed, mulberry32, randomBetween, type Rng } from './random';
import type { ShardKind } from './scene';

/**
 * Pre-rendered chips.
 *
 * The pieces are **solid and opaque**, and the light is at the viewer's eye —
 * a ring flash, not a window behind them. That one decision sets everything
 * else about how they are shaded:
 *
 * - A face turned straight at you is lit straight on and comes back bright. A
 *   face tilted away catches almost nothing and goes dark. So the flat top of a
 *   piece blazes and the ground bevel around it falls off towards the rim,
 *   which is the exact opposite of the backlit arrangement, where the rim was
 *   dark because light had furthest to travel there.
 * - Because the light and the eye are in the same place, the specular
 *   highlight lands where the surface faces you rather than off to one side.
 *   On a polished metal that is a hard, blown-out blaze on some facets and
 *   nothing at all on their neighbours, and it is most of what says "metal".
 * - Every facet is flat and they meet along hard lines. A piece cut this way
 *   reads as a mosaic of separate brightnesses; airbrush it into one smooth
 *   dome and it reads as a plastic bead.
 *
 * The shape and the lighting are kept apart, because they are wanted
 * separately: the lighting alone goes over a photograph to skin a piece with
 * it, and the two composed together with a palette colour make an ordinary
 * coloured stone.
 */
export interface ChipSprites {
  readonly palette: Palette;
  /**
   * A finished chip, in one of the palette's colours.
   *
   * @param kind Which family of fragment.
   * @param colorStop Position along the palette; quantised to the cached steps.
   * @param variant Which cut of that fragment, so no two pieces are twins.
   */
  get(kind: ShardKind, colorStop: number, variant?: number): CanvasImageSource | null;
  /** How much of the light each facet returns. Stamp with `multiply`. */
  shading(kind: ShardKind, variant?: number): CanvasImageSource | null;
  /** The blaze off the facets that face you. Stamp with `lighter`. */
  blaze(kind: ShardKind, variant?: number): CanvasImageSource | null;
  /** The outline on the unit circle, for clipping a photograph to a piece. */
  outline(kind: ShardKind, variant?: number): readonly Point[];
  /** Side of every sprite, in pixels. Chips are scaled from this. */
  readonly size: number;
}

/** Distinct cuts rendered per shape, so a chamber is not full of identical pieces. */
export const CHIP_VARIANTS = 3;

/**
 * Shades rendered per palette colour.
 *
 * Two pieces out of the same jar are not the same colour; a chamber where every
 * green is the identical green reads as printed rather than filled.
 */
const TONES = 3;

export interface ChipSpriteOptions {
  /** Distinct colours rendered per shape. Defaults to the palette's own. */
  steps?: number;
  /** Side of each sprite in pixels. */
  size?: number;
  /** Polished metal rather than a matte stone: harder blaze, deeper shadow. */
  metallic?: boolean;
  createCanvas?: () => HTMLCanvasElement;
}

export interface Point {
  x: number;
  y: number;
}

/** Builds the sprite sheet for a palette. Cheap enough to redo on any change. */
export function createChipSprites(palette: Palette, options: ChipSpriteOptions = {}): ChipSprites {
  const steps = Math.max(1, options.steps ?? palette.colors.length * TONES);
  const size = Math.max(8, options.size ?? 192);
  const metallic = options.metallic ?? false;
  const create = options.createCanvas ?? (() => document.createElement('canvas'));
  const cache = new Map<string, HTMLCanvasElement | null>();

  const cut = (variant: number) =>
    ((Math.round(variant) % CHIP_VARIANTS) + CHIP_VARIANTS) % CHIP_VARIANTS;

  const cached = (key: string, build: () => HTMLCanvasElement | null) => {
    const found = cache.get(key);

    if (found !== undefined) {
      return found;
    }

    const made = build();
    cache.set(key, made);

    return made;
  };

  // The lighting depends on the cut, not on the colour, so it is rendered once
  // per cut and shared by every colour of it — and by the photograph path,
  // which stamps the very same two layers over a patch of picture.
  const shadingFor = (kind: ShardKind, variant: number) =>
    cached(`shade:${kind}:${String(variant)}`, () =>
      renderFacets(create, kind, variant, size, metallic, 'shading'),
    );

  const blazeFor = (kind: ShardKind, variant: number) =>
    cached(`blaze:${kind}:${String(variant)}`, () =>
      renderFacets(create, kind, variant, size, metallic, 'blaze'),
    );

  return {
    palette,
    size,
    get(kind, colorStop, variant = 0) {
      const step = ((Math.round(colorStop * steps) % steps) + steps) % steps;
      const shape = cut(variant);

      return cached(`chip:${kind}:${String(step)}:${String(shape)}`, () =>
        renderChip(
          create,
          kind,
          shape,
          temper(palette, step, steps),
          size,
          shadingFor(kind, shape),
          blazeFor(kind, shape),
        ),
      );
    },
    shading(kind, variant = 0) {
      return shadingFor(kind, cut(variant));
    },
    blaze(kind, variant = 0) {
      return blazeFor(kind, cut(variant));
    },
    outline(kind, variant = 0) {
      return outlineFor(kind, cut(variant), 1);
    },
  };
}

/**
 * A finished coloured piece: the colour, shaded, with the blaze on top.
 *
 * The same two passes the photograph path applies at draw time, composed once
 * here because the colour never changes between frames.
 */
function renderChip(
  create: () => HTMLCanvasElement,
  kind: ShardKind,
  variant: number,
  color: Rgb,
  size: number,
  shading: HTMLCanvasElement | null,
  blaze: HTMLCanvasElement | null,
): HTMLCanvasElement | null {
  const canvas = create();
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext('2d');

  if (!ctx || !shading || !blaze) {
    return null;
  }

  const radius = (size / 2) * 0.96;
  const outline = outlineFor(kind, variant, radius);

  ctx.save();
  ctx.translate(size / 2, size / 2);
  tracePolygon(ctx, outline);
  ctx.fillStyle = rgbToCss(color);
  ctx.fill();
  ctx.restore();

  ctx.globalCompositeOperation = 'multiply';
  ctx.drawImage(shading, 0, 0);
  ctx.globalCompositeOperation = 'lighter';
  ctx.drawImage(blaze, 0, 0);
  // Trim back to the shape: `lighter` has no alpha of its own to respect, so
  // without this the blaze would leave a faint square around every piece.
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(shading, 0, 0);
  ctx.globalCompositeOperation = 'source-over';

  return canvas;
}

/**
 * The lighting, as two separable layers.
 *
 * `shading` is how much of the light each facet returns, to be multiplied into
 * whatever the piece is made of. `blaze` is the specular on top, to be added.
 * Split because a photograph skinning a piece needs both applied to it, and
 * they composite differently.
 */
function renderFacets(
  create: () => HTMLCanvasElement,
  kind: ShardKind,
  variant: number,
  size: number,
  metallic: boolean,
  layer: 'shading' | 'blaze',
): HTMLCanvasElement | null {
  const canvas = create();
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext('2d');

  if (!ctx) {
    return null;
  }

  const radius = (size / 2) * 0.96;
  const outline = outlineFor(kind, variant, radius);
  const cut = CUTS[kind];
  // Same seed as the outline, so a cut always has the same facets on it.
  const rng = mulberry32(hashSeed(`facets:${kind}:${String(variant)}`));
  const table = scalePolygon(outline, cut.table);

  ctx.translate(size / 2, size / 2);

  if (layer === 'blaze') {
    // Everything that is not blazing is black, since this layer is added.
    ctx.fillStyle = '#000';
    tracePolygon(ctx, outline);
    ctx.fill();
  }

  // The flat top, split into a few faces of its own so it is not one slab.
  const tableFaces = Math.max(1, cut.tableFaces);

  for (let face = 0; face < tableFaces; face += 1) {
    const from = Math.round((face * table.length) / tableFaces);
    const to = Math.round(((face + 1) * table.length) / tableFaces);
    // Near enough flat, but not exactly: a real table is never one plane, and
    // when the light is at your eye a degree of tilt is a visible step in
    // brightness.
    paint(ctx, layer, Math.cos(randomBetween(rng, 0, 0.34)), metallic);
    traceWedge(ctx, table, from, to);
    ctx.fill();
  }

  // The ground bevel: a ring of flat faces, each tilted a little differently,
  // which is what makes a cut piece a mosaic rather than a dome.
  for (let face = 0; face < cut.faces; face += 1) {
    const from = Math.round((face * outline.length) / cut.faces);
    const to = Math.round(((face + 1) * outline.length) / cut.faces);

    paint(ctx, layer, Math.cos(randomBetween(rng, 0.6, 1.25)), metallic);
    traceBevelFace(ctx, outline, table, from, to);
    ctx.fill();
  }

  if (layer === 'shading') {
    // The rim: the last sliver before the piece turns away from you entirely.
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(1, radius * 0.07);
    ctx.strokeStyle = 'rgb(28 28 32)';
    tracePolygon(ctx, outline);
    ctx.stroke();
  }

  return canvas;
}

/**
 * Sets the fill for a facet whose normal makes `facing` with the line of sight.
 *
 * The light is at the eye, so a facet's diffuse return and its specular both
 * peak in the same place — straight on — rather than the specular sitting off
 * to one side of the shading. Raising the same quantity to a high power is
 * what separates a metal, which is either blazing or black, from a stone,
 * which shades gently.
 */
function paint(
  ctx: CanvasRenderingContext2D,
  layer: 'shading' | 'blaze',
  facing: number,
  metallic: boolean,
): void {
  const straight = Math.max(0, facing);

  if (layer === 'shading') {
    const ambient = metallic ? 0.16 : 0.34;
    const level = ambient + (1 - ambient) * straight ** (metallic ? 1.7 : 1.1);
    const channel = Math.round(level * 255);

    ctx.fillStyle = `rgb(${String(channel)} ${String(channel)} ${String(channel)})`;
    return;
  }

  const sharpness = metallic ? 34 : 12;
  const strength = metallic ? 0.95 : 0.3;
  const channel = Math.round(straight ** sharpness * strength * 255);

  ctx.fillStyle = `rgb(${String(channel)} ${String(channel)} ${String(channel)})`;
}

/** How each family of fragment is cut: bevel faces, table faces, table size. */
const CUTS: Record<ShardKind, { faces: number; tableFaces: number; table: number }> = {
  triangle: { faces: 3, tableFaces: 3, table: 0.56 },
  shard: { faces: 4, tableFaces: 2, table: 0.5 },
  bead: { faces: 6, tableFaces: 3, table: 0.6 },
  // A splinter is thin enough for two ground faces and no room for more.
  sliver: { faces: 2, tableFaces: 1, table: 0.42 },
};

/**
 * The colour of one piece: a palette colour, off the melt by a shade.
 *
 * The jar is chosen first and the shade within it second, so the palette still
 * reads as a handful of distinct colours rather than a smear between them.
 */
function temper(palette: Palette, step: number, steps: number): Rgb {
  const base = pickGlassColor(palette, step / steps);
  const off = ((step % TONES) - (TONES - 1) / 2) / Math.max(1, (TONES - 1) / 2);

  return off >= 0 ? lighten(base, off * 0.12) : shade(base, -off * 0.14);
}

/**
 * The outline of one cut of one kind of fragment.
 *
 * Generated from a seed fixed by the kind and the cut rather than written out,
 * so every piece looks broken rather than stamped while staying identical
 * between runs — the sprite cache and the seeded scene both depend on that.
 */
function outlineFor(kind: ShardKind, variant: number, radius: number): Point[] {
  const rng = mulberry32(hashSeed(`${kind}:${String(variant)}`));

  switch (kind) {
    case 'triangle':
      return polygon(rng, radius, 3, 0.18, 1);
    case 'shard':
      return polygon(rng, radius, rng() < 0.5 ? 4 : 5, 0.3, 1);
    case 'bead':
      return polygon(rng, radius, 9, 0.06, 1);
    case 'sliver':
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

export function tracePolygon(ctx: CanvasRenderingContext2D, points: readonly Point[]): void {
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

/** A slice of the flat top, from the middle out to corners `from` up to `to`. */
function traceWedge(
  ctx: CanvasRenderingContext2D,
  table: readonly Point[],
  from: number,
  to: number,
): void {
  const count = table.length;
  const steps = (((to - from) % count) + count) % count || count;

  ctx.beginPath();
  ctx.moveTo(0, 0);

  for (let step = 0; step <= steps; step += 1) {
    const point = table[(from + step) % count]!;
    ctx.lineTo(point.x, point.y);
  }

  ctx.closePath();
}

/** One face of the bevel: the band between the edge and the top. */
function traceBevelFace(
  ctx: CanvasRenderingContext2D,
  outline: readonly Point[],
  table: readonly Point[],
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

function scalePolygon(points: readonly Point[], scale: number): Point[] {
  return points.map((point) => ({ x: point.x * scale, y: point.y * scale }));
}

function shade({ r, g, b }: Rgb, amount: number): Rgb {
  const keep = 1 - amount;

  return { r: r * keep, g: g * keep, b: b * keep };
}

function lighten({ r, g, b }: Rgb, amount: number): Rgb {
  return {
    r: r + (255 - r) * amount,
    g: g + (255 - g) * amount,
    b: b + (255 - b) * amount,
  };
}
