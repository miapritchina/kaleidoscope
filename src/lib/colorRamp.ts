import { rgbToCss, samplePalette, type Palette } from './palettes';

/**
 * A quantised, memoised view over a palette.
 *
 * The draw loop asks for hundreds of colours per frame; parsing hex and building
 * `rgb()` strings that often would show up in a profile. Quantising the ramp and
 * caching the resulting CSS strings keeps allocation out of the hot path.
 */
export interface ColorRamp {
  readonly palette: Palette;
  /**
   * @param t Position along the palette; wraps outside `[0, 1]`.
   * @param alpha Opacity in `[0, 1]`.
   */
  css(t: number, alpha?: number): string;
}

export interface ColorRampOptions {
  /** Colour stops resolved along the ramp. */
  steps?: number;
  /** Distinct opacity levels retained in the cache. */
  alphaSteps?: number;
}

export function createColorRamp(palette: Palette, options: ColorRampOptions = {}): ColorRamp {
  const steps = Math.max(2, options.steps ?? 180);
  const alphaSteps = Math.max(1, options.alphaSteps ?? 16);
  const cache = new Map<number, string>();

  return {
    palette,
    css(t, alpha = 1) {
      const colorIndex = ((Math.round(t * steps) % steps) + steps) % steps;
      const alphaIndex = Math.min(alphaSteps, Math.max(0, Math.round(alpha * alphaSteps)));
      const key = colorIndex * (alphaSteps + 1) + alphaIndex;
      const cached = cache.get(key);

      if (cached !== undefined) {
        return cached;
      }

      const value = rgbToCss(samplePalette(palette, colorIndex / steps), alphaIndex / alphaSteps);
      cache.set(key, value);

      return value;
    },
  };
}
