import { describe, expect, it } from 'vitest';

import { CHAMBER_RADIUS } from './chamber';
import {
  createFlakeSprites,
  createGlitter,
  drawGlitter,
  MOST_FLAKES,
  updateGlitter,
  type Flake,
} from './glitter';
import { asContext, createFakeContext } from '../test/fakeCanvas';

/** jsdom has no canvas backend, so the specks are cut on the recorder instead. */
function fakeSprites() {
  return createFlakeSprites({
    createCanvas: () => {
      const context = createFakeContext();

      return {
        width: 0,
        height: 0,
        getContext: () => asContext(context),
      } as unknown as HTMLCanvasElement;
    },
  });
}

/** Where a flake sits around the cell, in radians. */
const bearing = (flake: Flake) => Math.atan2(flake.y, flake.x);

const still = { dt: 1 / 60, thickness: 0.35, swirl: 0, angle: 0 };

describe('createGlitter', () => {
  it('is the same glitter for the same seed', () => {
    expect(createGlitter(9, 0.5)).toEqual(createGlitter(9, 0.5));
    expect(createGlitter(9, 0.5)).not.toEqual(createGlitter(10, 0.5));
  });

  // The Amount slider is the population itself: more glitter is more flakes,
  // so a cell asked for little of it costs little to run and little to draw.
  it('fills the cell in proportion to what was asked for', () => {
    expect(createGlitter(1, 1)).toHaveLength(MOST_FLAKES);
    expect(createGlitter(1, 0.5).length).toBeLessThan(MOST_FLAKES);
    expect(createGlitter(1, 0).length).toBeGreaterThan(0);

    for (const flake of createGlitter(1, 1)) {
      expect(Math.hypot(flake.x, flake.y)).toBeLessThanOrEqual(CHAMBER_RADIUS);
    }
  });

  it('sizes the flakes with the pinch', () => {
    const small = createGlitter(2, 0.4, 1);
    const large = createGlitter(2, 0.4, 2);

    expect(large[0]!.size).toBeCloseTo(small[0]!.size * 2, 9);
  });
});

describe('updateGlitter', () => {
  it('sweeps the flakes round with the fluid', () => {
    const flakes = createGlitter(6, 0.2);
    const watched = flakes.map(bearing);

    for (let frame = 0; frame < 60; frame += 1) {
      updateGlitter(flakes, { ...still, swirl: 1.5 });
    }

    const swept = flakes.map((flake, index) => Math.sin(bearing(flake) - watched[index]!));

    // Carried the way the fluid is turning, and nearly all of the way: a flake
    // is almost all surface, so it rides the fluid rather than swimming in it.
    expect(swept.every((moved) => moved > 0.4)).toBe(true);
  });

  it('lets them sag through it when nothing is turning', () => {
    const flakes = createGlitter(7, 0.2);
    const middle = () => flakes.reduce((sum, flake) => sum + flake.y, 0) / flakes.length;
    const before = middle();

    for (let frame = 0; frame < 300; frame += 1) {
      updateGlitter(flakes, still);
    }

    // Down the screen, and slowly: it is a sag rather than a fall.
    expect(middle()).toBeGreaterThan(before);
    expect(middle() - before).toBeLessThan(CHAMBER_RADIUS);
  });

  // Thick enough and the cell is a paperweight: what is in it hangs where it is
  // until something turns the tube.
  it('holds them where they are in a gel', () => {
    const thin = createGlitter(8, 0.2);
    const thick = createGlitter(8, 0.2);
    const drop = (flakes: Flake[], thickness: number) => {
      const before = flakes.reduce((sum, flake) => sum + flake.y, 0) / flakes.length;

      for (let frame = 0; frame < 300; frame += 1) {
        updateGlitter(flakes, { ...still, thickness });
      }

      return flakes.reduce((sum, flake) => sum + flake.y, 0) / flakes.length - before;
    };

    expect(drop(thin, 0)).toBeGreaterThan(drop(thick, 1) * 2);
  });

  it('keeps every flake inside the wall', () => {
    const flakes = createGlitter(8, 0.3);

    for (let frame = 0; frame < 400; frame += 1) {
      updateGlitter(flakes, { ...still, swirl: 4, angle: frame * 0.05 });
    }

    for (const flake of flakes) {
      expect(Math.hypot(flake.x, flake.y)).toBeLessThanOrEqual(CHAMBER_RADIUS + 1e-9);
    }
  });
});

describe('drawGlitter', () => {
  const options = {
    scale: 100,
    rotation: 0,
    pan: { x: 0, y: 0 },
    light: { x: 0, y: 0.55, z: 1 },
    sprites: fakeSprites(),
  };

  // Two passes: the flake, which covers what is behind it, and the flash over
  // the top of it. Light added to a lit ground is still that ground, so a flake
  // that only flashed would be invisible over anything pale.
  it('draws each flake as something solid and something alight', () => {
    const context = createFakeContext();
    const flakes = createGlitter(3, 0.2);

    drawGlitter(asContext(context), flakes, options);

    const drawn = context.stylesOf('drawImage');

    expect(drawn.length).toBeGreaterThan(flakes.length);
    expect(drawn.some((style) => style.globalCompositeOperation === 'source-over')).toBe(true);
    expect(drawn.some((style) => style.globalCompositeOperation === 'lighter')).toBe(true);
  });

  it('draws nothing at all with no glitter in the cell', () => {
    const context = createFakeContext();

    drawGlitter(asContext(context), [], options);

    expect(context.countOf('drawImage')).toBe(0);
  });

  it('hands the surface back as it found it', () => {
    const context = createFakeContext();

    drawGlitter(asContext(context), createGlitter(3, 0.1), options);

    expect(context.globalCompositeOperation).toBe('source-over');
    expect(context.globalAlpha).toBe(1);
  });
});
