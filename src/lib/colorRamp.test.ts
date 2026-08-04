import { describe, expect, it } from 'vitest';

import { createColorRamp } from './colorRamp';
import { getPalette } from './palettes';

const palette = getPalette('aurora');

describe('createColorRamp', () => {
  it('returns css colour strings', () => {
    const ramp = createColorRamp(palette);

    expect(ramp.css(0.25)).toMatch(/^rgb\(\d+ \d+ \d+\)$/);
    expect(ramp.css(0.25, 0.5)).toMatch(/^rgb\(\d+ \d+ \d+ \/ \d\.\d+\)$/);
  });

  it('memoises: identical requests return the same string instance', () => {
    const ramp = createColorRamp(palette);

    expect(ramp.css(0.4, 0.6)).toBe(ramp.css(0.4, 0.6));
  });

  it('quantises nearby positions to the same colour', () => {
    const ramp = createColorRamp(palette, { steps: 10, alphaSteps: 4 });

    expect(ramp.css(0.301)).toBe(ramp.css(0.299));
    expect(ramp.css(0.3, 0.51)).toBe(ramp.css(0.3, 0.49));
  });

  it('wraps positions outside [0, 1] instead of clamping', () => {
    const ramp = createColorRamp(palette);

    expect(ramp.css(1.2)).toBe(ramp.css(0.2));
    expect(ramp.css(-0.8)).toBe(ramp.css(0.2));
  });

  it('clamps alpha into range', () => {
    const ramp = createColorRamp(palette);

    expect(ramp.css(0.5, 5)).toBe(ramp.css(0.5, 1));
    expect(ramp.css(0.5, -5)).toBe(ramp.css(0.5, 0));
  });

  it('exposes the palette it was built from', () => {
    expect(createColorRamp(palette).palette).toBe(palette);
  });
});
