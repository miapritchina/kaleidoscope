import { describe, expect, it } from 'vitest';

import { asContext, createFakeContext } from '../test/fakeCanvas';
import { CHAMBER_RADIUS, type ChamberView } from './chamber';
import { GROUND } from './color';
import { SUBSTANCES, type SubstanceId } from './settings';
import { createSubstanceChamber } from './substanceChamber';

const view: ChamberView = {
  scale: 100,
  rotation: 0,
  pan: { x: 0, y: 0 },
  drag: { x: 0, y: 0 },
  reach: CHAMBER_RADIUS,
  light: { x: 0, y: 1, z: 1 },
};

function cell(substance: SubstanceId) {
  return createSubstanceChamber({ seed: 'cell', substance, amount: 0.55 });
}

describe('createSubstanceChamber', () => {
  it('caps the tube, substance or not', () => {
    for (const substance of SUBSTANCES) {
      expect(cell(substance).open, substance).toBe(false);
    }
  });

  // A dye only reads as transmitted colour over something white; a reflection
  // only reads at all over something dark.
  it('lights the dyes against a page and the reflections against the dark', () => {
    expect(cell('lava').ground).toBe(GROUND);
    expect(cell('smoke').ground).toBe(GROUND);
    expect(cell('glitter').ground).not.toBe(GROUND);
    expect(cell('film').ground).not.toBe(GROUND);
  });

  // The fluid is dragged round by the wall rather than bolted to it, so it
  // trails the tube and then outlives it. That slip is what is heard.
  it('reports the slip between its fluid and the tube as a wash', () => {
    const chamber = cell('smoke');

    expect(chamber.listen?.().wash).toBe(0);

    for (let frame = 0; frame < 10; frame += 1) {
      chamber.update({ dt: 1 / 20, gravity: 0, turn: 6, touch: null });
    }

    const spinning = chamber.listen?.();

    expect(spinning?.wash).toBeGreaterThan(0);
    // Nothing hard in here to knock.
    expect(spinning?.impacts).toEqual([]);
  });

  // A finger in the fluid moves it. Only a cell of substance takes one — the
  // body hands the same touch to every chamber and lets it decide.
  it('takes a finger in the fluid', () => {
    const chamber = cell('smoke');

    expect(() => {
      chamber.update({
        dt: 1 / 20,
        gravity: 0,
        turn: 0,
        touch: { x: 0.2, y: 0, vx: 3, vy: 0 },
      });
    }).not.toThrow();
  });

  // Its whole disc, which is the one thing the body asks for: the flakes are a
  // scatter and what covers the disc behind them is the dark ground, but the
  // scatter itself has to be drawn.
  it('scatters its flakes across the cell', () => {
    const chamber = createSubstanceChamber(
      { seed: 'cover', substance: 'glitter', amount: 0.9 },
      {
        thickness: () => 0.35,
        createCanvas: () =>
          ({
            width: 0,
            height: 0,
            getContext: () => asContext(createFakeContext()),
          }) as unknown as HTMLCanvasElement,
      },
    );
    const ctx = createFakeContext();

    chamber.paint(asContext(ctx), view);

    expect(ctx.countOf('drawImage')).toBeGreaterThan(0);
  });

  // The three fluid substances paint themselves onto surfaces of their own,
  // which jsdom has no backend for — so what they put on the cell is checked
  // by looking at the picture rather than here. What can be checked is that
  // asking them costs nothing and breaks nothing when there is no canvas.
  it('paints nothing rather than falling over without a canvas backend', () => {
    for (const substance of SUBSTANCES) {
      const ctx = createFakeContext();

      expect(() => {
        cell(substance).paint(asContext(ctx), view);
      }, substance).not.toThrow();
    }
  });
});
