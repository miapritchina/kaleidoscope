import { describe, expect, it } from 'vitest';

import { CHAMBER_RADIUS } from './chamber';
import {
  createFlow,
  curlAt,
  neighbour,
  positionOf,
  projectFlow,
  stepFlow,
  stirFlow,
  velocityAt,
  type Flow,
} from './flow';
import { createGlitter, updateGlitter } from './glitter';

const GRID = 64;

/** Total divergence magnitude over the cell, which projection exists to remove. */
function divergenceOf(flow: Flow): number {
  const { grid, u, v, inside } = flow;
  let total = 0;

  for (let j = 0; j < grid; j += 1) {
    for (let i = 0; i < grid; i += 1) {
      const k = i + j * grid;

      if (!inside[k]) {
        continue;
      }

      total += Math.abs(
        neighbour(u, inside, grid, u[k]!, i + 1, j) -
          neighbour(u, inside, grid, u[k]!, i - 1, j) +
          neighbour(v, inside, grid, v[k]!, i, j + 1) -
          neighbour(v, inside, grid, v[k]!, i, j - 1),
      );
    }
  }

  return total;
}

describe('createFlow', () => {
  it('marks the round wall out on the grid', () => {
    const flow = createFlow(GRID);

    for (let j = 0; j < GRID; j += 1) {
      for (let i = 0; i < GRID; i += 1) {
        const away = Math.hypot(positionOf(GRID, i), positionOf(GRID, j));

        expect(flow.inside[i + j * GRID]).toBe(away <= CHAMBER_RADIUS ? 1 : 0);
      }
    }
  });
});

describe('projectFlow', () => {
  it('takes most of a local source back out of the field', () => {
    const flow = createFlow(GRID);

    // A small patch of outflow: the kind of divergence one step introduces,
    // which is what sixteen Gauss-Seidel passes are sized for. A field
    // diverging *everywhere* is a different problem — information crosses one
    // cell per pass — and not one any step of this fluid ever poses.
    for (let j = 0; j < GRID; j += 1) {
      for (let i = 0; i < GRID; i += 1) {
        const k = i + j * GRID;
        const x = positionOf(GRID, i);
        const y = positionOf(GRID, j);
        const away = Math.hypot(x, y);

        if (flow.inside[k] && away < 0.3 && away > 0) {
          flow.u[k] = (x / away) * (1 - away / 0.3);
          flow.v[k] = (y / away) * (1 - away / 0.3);
        }
      }
    }

    const before = divergenceOf(flow);

    projectFlow(flow);

    expect(divergenceOf(flow)).toBeLessThan(before * 0.5);
  });
});

describe('stirFlow', () => {
  it('moves the fluid where the finger was, and only there', () => {
    const flow = createFlow(GRID);

    stirFlow(flow, { x: 0.4, y: 0, vx: 0, vy: 2, reach: 0.25 });
    stepFlow(flow, { dt: 1 / 20, thickness: 0.35, swirl: 0 });

    const at = { x: 0, y: 0 };

    velocityAt(flow, 0.4, 0, at);
    expect(Math.hypot(at.x, at.y)).toBeGreaterThan(0.1);

    velocityAt(flow, -0.8, 0, at);
    expect(Math.hypot(at.x, at.y)).toBeLessThan(0.05);
  });

  it('banks time, so a queued stir is not lost between frames', () => {
    const flow = createFlow(GRID);

    stirFlow(flow, { x: 0, y: 0, vx: 3, vy: 0, reach: 0.3 });

    // Frames shorter than a fluid step: the stir waits in the queue.
    for (let frame = 0; frame < 4; frame += 1) {
      stepFlow(flow, { dt: 1 / 120, thickness: 0.35, swirl: 0 });
    }

    const at = { x: 0, y: 0 };

    velocityAt(flow, 0, 0, at);
    expect(at.x).toBeGreaterThan(0.5);
  });
});

describe('the wall', () => {
  it('drags the body of fluid round with the tube', () => {
    const flow = createFlow(GRID);

    for (let frame = 0; frame < 60; frame += 1) {
      stepFlow(flow, { dt: 1 / 30, thickness: 0.35, swirl: 1.5 });
    }

    // A point out on the x axis should be moving in +y, the way a body
    // turning anticlockwise carries it.
    const at = { x: 0, y: 0 };

    velocityAt(flow, 0.6, 0, at);
    expect(at.y).toBeGreaterThan(0.3);
    expect(curlAt(flow, 0, 0)).toBeGreaterThan(0.5);
  });
});

describe('the wall, as a wall', () => {
  /** The fastest anything in the cell is going, in cell units a second. */
  function fastestOf(flow: Flow): number {
    let most = 0;

    for (let k = 0; k < flow.u.length; k += 1) {
      const speed = Math.hypot(flow.u[k]!, flow.v[k]!);

      if (Number.isNaN(speed)) {
        return NaN;
      }

      most = Math.max(most, speed);
    }

    return most;
  }

  /** One smooth swirl in the middle of the cell, and nothing else. */
  function swirled(): Flow {
    const flow = createFlow(GRID);

    for (let j = 0; j < GRID; j += 1) {
      for (let i = 0; i < GRID; i += 1) {
        const k = i + j * GRID;

        if (!flow.inside[k]) {
          continue;
        }

        const x = positionOf(GRID, i);
        const y = positionOf(GRID, j);
        const much = Math.exp((-(x * x + y * y) / (CHAMBER_RADIUS * 0.4) ** 2) * 2);

        flow.u[k] = -y * 1.6 * much;
        flow.v[k] = x * 1.6 * much;
      }
    }

    projectFlow(flow);

    return flow;
  }

  // The one that mattered. The round wall is a staircase on a square grid, and
  // the divergence used to be measured against a neighbour that agreed with
  // the cell asking — which is not a wall, it is a hole: the solve was told
  // nothing was flowing out and let the fluid through the glass. A cell with
  // *nothing pushing on it* then fed itself off the staircase and ran away to
  // the speed limit within ten seconds, which is where the thin end of the
  // Thickness slider went to NaN.
  it('does not feed a cell that nothing is pushing', () => {
    const flow = swirled();
    const opened = fastestOf(flow);

    for (let frame = 0; frame < 30 * 30; frame += 1) {
      stepFlow(flow, { dt: 1 / 30, thickness: 0, swirl: 0, confine: 6 });
    }

    expect(fastestOf(flow)).toBeLessThan(opened);
  }, 20000);

  it('holds every setting of the slider to a speed, and to a number', () => {
    for (const thickness of [0, 0.35, 1]) {
      const flow = swirled();

      for (let frame = 0; frame < 30 * 12; frame += 1) {
        stepFlow(flow, { dt: 1 / 30, thickness, swirl: 4, confine: 6 });
      }

      const fastest = fastestOf(flow);

      expect(Number.isFinite(fastest)).toBe(true);
      // The wall itself is dragged round at swirl x radius; nothing in the
      // cell has any business going much faster than that.
      expect(fastest).toBeLessThan(4 * CHAMBER_RADIUS * 3);
    }
  }, 20000);
});

describe('viscosity', () => {
  /** How much of a stirred eddy is left after some seconds. */
  function eddyAfter(thickness: number, seconds: number): number {
    const flow = createFlow(GRID);

    stirFlow(flow, { x: 0.4, y: 0, vx: 0, vy: 2, reach: 0.3 });
    stepFlow(flow, { dt: 1 / 30, thickness, swirl: 0 });

    let opened = 0;

    for (let k = 0; k < flow.u.length; k += 1) {
      opened += Math.hypot(flow.u[k]!, flow.v[k]!);
    }

    for (let frame = 0; frame < seconds * 30; frame += 1) {
      stepFlow(flow, { dt: 1 / 30, thickness, swirl: 0 });
    }

    let left = 0;

    for (let k = 0; k < flow.u.length; k += 1) {
      left += Math.hypot(flow.u[k]!, flow.v[k]!);
    }

    return opened > 0 ? left / opened : 0;
  }

  // What the Thickness slider is *for*, and what it did not do: the wall's
  // grip used to be applied at full strength to every cell, so an eddy lost a
  // quarter of itself per step at any setting and a stir was gone in a tenth
  // of a second. Now the slider is the viscosity, and the viscosity is what
  // decides how long the finger's wake lives.
  it('lets a thin cell hold a stir far longer than a gel does', () => {
    const thin = eddyAfter(0, 4);
    const gel = eddyAfter(1, 4);

    expect(thin).toBeGreaterThan(0.35);
    expect(gel).toBeLessThan(thin * 0.6);
  });
});

describe('glitter in a real fluid', () => {
  const still = { dt: 1 / 60, thickness: 0.35, swirl: 0, angle: 0 };

  it('tumbles the flakes where the fluid is turning', () => {
    const flow = createFlow(GRID);

    // Spin the fluid up so it holds a body of turning.
    for (let frame = 0; frame < 60; frame += 1) {
      stepFlow(flow, { dt: 1 / 30, thickness: 0.35, swirl: 2 });
    }

    const flakes = createGlitter(11, 0.3);
    const turns = flakes.map((flake) => flake.turn);

    for (let frame = 0; frame < 120; frame += 1) {
      updateGlitter(flakes, { ...still, fluid: flow });
    }

    const moved = flakes.filter((flake, index) => flake.turn !== turns[index]);

    expect(moved.length).toBeGreaterThan(flakes.length / 2);
  });

  it('carries the flakes on a stirred eddy rather than a rigid turn', () => {
    const flow = createFlow(GRID);

    stirFlow(flow, { x: 0.3, y: 0, vx: 0, vy: 1.5, reach: 0.3 });
    stepFlow(flow, { dt: 1 / 20, thickness: 0.35, swirl: 0 });

    const flakes = createGlitter(12, 0.3);
    const near = flakes.filter((flake) => Math.hypot(flake.x - 0.3, flake.y) < 0.25);
    const before = near.map((flake) => ({ x: flake.x, y: flake.y }));

    for (let frame = 0; frame < 30; frame += 1) {
      updateGlitter(flakes, { ...still, fluid: flow });
    }

    const carried = near.filter(
      (flake, index) => Math.hypot(flake.x - before[index]!.x, flake.y - before[index]!.y) > 0.005,
    );

    expect(carried.length).toBeGreaterThan(0);
  });
});
