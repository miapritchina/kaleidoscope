import { describe, expect, it } from 'vitest';

import { AIR, CHAMBER_RADIUS, liquidCell } from './chamber';
import {
  createFlakeSprites,
  createGlitter,
  drawGlitter,
  MAX_FLAKES,
  updateGlitter,
  type Flake,
} from './glitter';
import type { Shard } from './scene';
import { ROUND } from './shape';
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

const OIL = liquidCell(0.35);

function glass(count: number): Shard[] {
  return Array.from({ length: count }, (_, index) => ({
    kind: 'bead' as const,
    variant: 0,
    x: -0.4 + index * 0.3,
    y: 0,
    vx: 0,
    vy: 0,
    radius: 0.08,
    shape: ROUND,
    rotation: 0,
    spin: 0,
    skin: { x: 0.5, y: 0.5 },
  }));
}

/** Where a flake sits around the cell, in radians. */
const bearing = (flake: Flake) => Math.atan2(flake.y, flake.x);

describe('createGlitter', () => {
  it('is the same glitter for the same seed', () => {
    expect(createGlitter(9, 20)).toEqual(createGlitter(9, 20));
    expect(createGlitter(9, 20)).not.toEqual(createGlitter(10, 20));
  });

  it('makes a chamber full and lets the slider spend it', () => {
    const flakes = createGlitter(1, 20);

    expect(flakes).toHaveLength(MAX_FLAKES);

    for (const flake of flakes) {
      expect(Math.hypot(flake.x, flake.y)).toBeLessThanOrEqual(CHAMBER_RADIUS);
      expect(flake.host).toBeLessThan(20);
    }
  });

  it('copes with a chamber that has no glass to be caught on', () => {
    expect(() => {
      updateGlitter(createGlitter(1, 0), [], {
        dt: 1 / 60,
        medium: AIR,
        swirl: 0,
        angle: 0,
        live: 10,
      });
    }).not.toThrow();
  });
});

describe('a dry cell', () => {
  // The whole complaint against the lattice this replaced: it sat still while
  // the pile avalanched underneath it.
  it('carries every flake on the piece of glass it is caught on', () => {
    const shards = glass(3);
    const flakes = createGlitter(2, 3);
    const settings = { dt: 1 / 60, medium: AIR, swirl: 0, angle: 0, live: MAX_FLAKES };

    updateGlitter(flakes, shards, settings);

    const before = flakes.map((flake) => ({ x: flake.x, y: flake.y }));

    for (const shard of shards) {
      shard.x += 0.2;
      shard.y += 0.1;
    }

    updateGlitter(flakes, shards, settings);

    for (const [index, flake] of flakes.entries()) {
      expect(flake.x).toBeCloseTo(before[index]!.x + 0.2, 6);
      expect(flake.y).toBeCloseTo(before[index]!.y + 0.1, 6);
    }
  });

  it('turns a flake with the piece it is on', () => {
    const shards = glass(1);
    const [piece] = shards as [Shard];

    piece.x = 0;
    piece.y = 0;

    const flakes = createGlitter(4, 1);
    const settings = { dt: 1 / 60, medium: AIR, swirl: 0, angle: 0, live: MAX_FLAKES };

    updateGlitter(flakes, shards, settings);

    const before = flakes.map((flake) => Math.hypot(flake.x, flake.y));

    piece.rotation = Math.PI / 2;
    updateGlitter(flakes, shards, settings);

    for (const [index, flake] of flakes.entries()) {
      // A quarter turn about the piece's middle: as far from it as before, and
      // somewhere else.
      expect(Math.hypot(flake.x, flake.y)).toBeCloseTo(before[index]!, 6);
    }

    expect(flakes.some((flake, index) => Math.abs(flake.x - before[index]!) > 1e-6)).toBe(true);
  });

  it('leaves the flakes the slider is not paying for alone', () => {
    const shards = glass(2);
    const flakes = createGlitter(5, 2);
    const spare = { ...flakes[MAX_FLAKES - 1]! };

    updateGlitter(flakes, shards, {
      dt: 1 / 60,
      medium: AIR,
      swirl: 0,
      angle: 0,
      live: 10,
    });

    expect(flakes[MAX_FLAKES - 1]).toEqual(spare);
  });
});

describe('a liquid cell', () => {
  it('sweeps the flakes round with the fluid', () => {
    const flakes = createGlitter(6, 4);
    const watched = flakes.slice(0, 40).map(bearing);

    for (let frame = 0; frame < 60; frame += 1) {
      updateGlitter(flakes, [], {
        dt: 1 / 60,
        medium: OIL,
        swirl: 1.5,
        angle: 0,
        live: MAX_FLAKES,
      });
    }

    const swept = flakes
      .slice(0, 40)
      .map((flake, index) => Math.atan2(Math.sin(bearing(flake) - watched[index]!), 1));

    // Carried the way the fluid is turning, and nearly all of the way: a flake
    // is almost all surface, so it rides the fluid rather than swimming in it.
    expect(swept.every((moved) => moved > 0.5)).toBe(true);
  });

  it('lets them sag through it when nothing is turning', () => {
    const flakes = createGlitter(7, 4);
    const middle = () => flakes.reduce((sum, flake) => sum + flake.y, 0) / flakes.length;
    const before = middle();

    for (let frame = 0; frame < 300; frame += 1) {
      updateGlitter(flakes, [], {
        dt: 1 / 60,
        medium: OIL,
        swirl: 0,
        angle: 0,
        live: MAX_FLAKES,
      });
    }

    // Down the screen, and slowly: it is a sag rather than a fall.
    expect(middle()).toBeGreaterThan(before);
    expect(middle() - before).toBeLessThan(CHAMBER_RADIUS);
  });

  it('keeps every flake inside the wall', () => {
    const flakes = createGlitter(8, 4);

    for (let frame = 0; frame < 400; frame += 1) {
      updateGlitter(flakes, [], {
        dt: 1 / 60,
        medium: OIL,
        swirl: 4,
        angle: frame * 0.05,
        live: MAX_FLAKES,
      });
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
    live: MAX_FLAKES,
    sprites: fakeSprites(),
  };

  // Two passes: the flake, which covers what is behind it, and the flash over
  // the top of it. Light added to a white ground is still white, so a flake
  // that only flashed would be invisible over half the cell.
  it('draws each flake as something solid and something alight', () => {
    const context = createFakeContext();

    drawGlitter(asContext(context), createGlitter(3, 4), options);

    const drawn = context.stylesOf('drawImage');

    expect(drawn.length).toBeGreaterThan(MAX_FLAKES);
    expect(drawn.some((style) => style.globalCompositeOperation === 'source-over')).toBe(true);
    expect(drawn.some((style) => style.globalCompositeOperation === 'lighter')).toBe(true);
  });

  it('draws nothing at all with the slider down', () => {
    const context = createFakeContext();

    drawGlitter(asContext(context), createGlitter(3, 4), { ...options, live: 0 });

    expect(context.countOf('drawImage')).toBe(0);
  });

  it('hands the surface back as it found it', () => {
    const context = createFakeContext();

    drawGlitter(asContext(context), createGlitter(3, 4), options);

    expect(context.globalCompositeOperation).toBe('source-over');
    expect(context.globalAlpha).toBe(1);
  });
});
