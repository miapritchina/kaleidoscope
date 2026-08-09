import { rgbToCss, samplePalette, type Palette, type Rgb } from './palettes';
import type { ShardKind } from './scene';

/**
 * Pre-rendered glass chips.
 *
 * Real kaleidoscope chips are bits of coloured glass lit from behind: denser in
 * the middle where the glass is thickest, translucent at the edges, with a bright
 * rim where the light catches. Painting that per chip per frame would mean
 * building a gradient for every one of several hundred draws, so each
 * kind-and-colour combination is rendered once into a small canvas and stamped
 * from then on — the same trick the wedge itself uses, one level down.
 */
export interface ChipSprites {
  readonly palette: Palette;
  /**
   * The sprite for a chip.
   *
   * @param kind Which shape.
   * @param colorStop Position along the palette; quantised to the cached steps.
   */
  get(kind: ShardKind, colorStop: number): CanvasImageSource | null;
  /** Side of every sprite, in pixels. Chips are scaled from this. */
  readonly size: number;
}

export interface ChipSpriteOptions {
  /** Distinct colours rendered per shape. */
  steps?: number;
  /** Side of each sprite in pixels. */
  size?: number;
  createCanvas?: () => HTMLCanvasElement;
}

/** Builds the sprite sheet for a palette. Cheap enough to redo on palette change. */
export function createChipSprites(palette: Palette, options: ChipSpriteOptions = {}): ChipSprites {
  const steps = Math.max(1, options.steps ?? 24);
  const size = Math.max(8, options.size ?? 96);
  const create = options.createCanvas ?? (() => document.createElement('canvas'));
  const cache = new Map<string, HTMLCanvasElement | null>();

  return {
    palette,
    size,
    get(kind, colorStop) {
      const step = ((Math.round(colorStop * steps) % steps) + steps) % steps;
      const key = `${kind}:${step}`;
      const cached = cache.get(key);

      if (cached !== undefined) {
        return cached;
      }

      const sprite = renderChip(create, kind, samplePalette(palette, step / steps), size);
      cache.set(key, sprite);

      return sprite;
    },
  };
}

function renderChip(
  create: () => HTMLCanvasElement,
  kind: ShardKind,
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
  // Leave room for the rim highlight to sit inside the sprite.
  const radius = centre * 0.92;

  ctx.translate(centre, centre);

  let body: CanvasGradient | string;

  try {
    const gradient = ctx.createRadialGradient(
      -radius * 0.25,
      -radius * 0.3,
      radius * 0.05,
      0,
      0,
      radius,
    );
    // Thick in the middle, thinning to translucent at the edge — glass, not paint.
    gradient.addColorStop(0, rgbToCss(lighten(color, 0.28), 0.95));
    gradient.addColorStop(0.5, rgbToCss(color, 0.85));
    gradient.addColorStop(1, rgbToCss(darken(color, 0.3), 0.45));
    body = gradient;
  } catch {
    // Canvas implementations without gradients still get a usable chip.
    body = rgbToCss(color, 0.85);
  }

  ctx.fillStyle = body;
  tracePath(ctx, kind, radius);
  ctx.fill();

  // The catch-light along the upper-left edge, which is what makes it read as a
  // solid object rather than a flat shape.
  ctx.lineWidth = Math.max(1, radius * 0.09);
  ctx.strokeStyle = rgbToCss(lighten(color, 0.75), 0.5);
  tracePath(ctx, kind, radius * 0.93);
  ctx.stroke();

  return canvas;
}

function tracePath(ctx: CanvasRenderingContext2D, kind: ShardKind, radius: number): void {
  ctx.beginPath();

  switch (kind) {
    case 'disc':
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      break;
    case 'ring':
      ctx.arc(0, 0, radius * 0.78, 0, Math.PI * 2);
      ctx.arc(0, 0, radius * 0.5, 0, Math.PI * 2, true);
      break;
    case 'petal':
      ctx.moveTo(0, -radius);
      ctx.quadraticCurveTo(radius, 0, 0, radius);
      ctx.quadraticCurveTo(-radius, 0, 0, -radius);
      break;
    case 'sliver':
      ctx.moveTo(0, -radius);
      ctx.lineTo(radius * 0.42, radius);
      ctx.lineTo(-radius * 0.42, radius * 0.6);
      ctx.closePath();
      break;
  }
}

function lighten({ r, g, b }: Rgb, amount: number): Rgb {
  return {
    r: r + (255 - r) * amount,
    g: g + (255 - g) * amount,
    b: b + (255 - b) * amount,
  };
}

function darken({ r, g, b }: Rgb, amount: number): Rgb {
  const keep = 1 - amount;

  return { r: r * keep, g: g * keep, b: b * keep };
}
