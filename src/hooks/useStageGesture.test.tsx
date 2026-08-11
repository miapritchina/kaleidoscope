import { act, fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useStageGesture, type StageGesture } from './useStageGesture';

const WIDTH = 200;
const HEIGHT = 200;

function Harness({
  expose,
  now,
  zoom,
  onZoom,
}: {
  expose: (gesture: StageGesture) => void;
  now: () => number;
  zoom: () => number;
  onZoom: (value: number) => void;
}) {
  const gesture = useStageGesture({ now, zoom, onZoom });
  expose(gesture);

  return (
    <div data-testid="stage" {...gesture.handlers}>
      stage
    </div>
  );
}

function renderStage(startingZoom = 1) {
  let gesture!: StageGesture;
  // The hook's clock is injected so a swipe's speed can be dictated exactly;
  // event timestamps cannot be, jsdom overwrites them.
  let clock = 1000;
  // The zoom lives outside the hook, the way it does in the app: a setting the
  // pinch reads and writes rather than state of its own.
  let zoom = startingZoom;
  const zoomed: number[] = [];
  const view = render(
    <Harness
      expose={(value) => (gesture = value)}
      now={() => clock}
      zoom={() => zoom}
      onZoom={(value) => {
        zoom = value;
        zoomed.push(value);
      }}
    />,
  );
  // Scoped to this render's own container: the default queries search the whole
  // document, and some tests mount two stages to compare them.
  const stage = view.container.querySelector<HTMLElement>('[data-testid="stage"]')!;

  // jsdom lays nothing out and does not implement pointer capture.
  stage.getBoundingClientRect = () =>
    ({ width: WIDTH, height: HEIGHT, left: 0, top: 0 }) as DOMRect;
  stage.setPointerCapture = vi.fn();
  stage.releasePointerCapture = vi.fn();
  stage.hasPointerCapture = vi.fn().mockReturnValue(true);

  return {
    stage,
    /** Every zoom the pinch has asked for, in order. */
    zoomed,
    get zoom() {
      return zoom;
    },
    get gesture() {
      return gesture;
    },
    down(x: number, y: number, init: Record<string, unknown> = {}) {
      fireEvent.pointerDown(stage, { pointerId: 1, button: 0, clientX: x, clientY: y, ...init });
    },
    /** Puts a second finger down, which is what starts a pinch. */
    second(x: number, y: number, pointerId = 2) {
      fireEvent.pointerDown(stage, { pointerId, button: 0, clientX: x, clientY: y });
    },
    /** Moves the pointer, advancing the injected clock by `ms`. */
    move(x: number, y: number, ms = 100, pointerId = 1) {
      clock += ms;
      fireEvent.pointerMove(stage, { pointerId, clientX: x, clientY: y });
    },
    up(pointerId = 1) {
      fireEvent.pointerUp(stage, { pointerId });
    },
    /** Advances the injected clock without moving the pointer. */
    wait(ms: number) {
      clock += ms;
    },
  };
}

describe('useStageGesture', () => {
  it('starts idle', () => {
    const view = renderStage();

    expect(view.gesture.mode).toBeNull();
    expect(view.gesture.turnRef.current).toBe(0);
    expect(view.gesture.panRef.current).toEqual({ x: 0, y: 0 });
  });

  describe('turning', () => {
    it('treats a plain swipe as a turn', () => {
      const view = renderStage();

      view.down(50, 100);

      expect(view.gesture.mode).toBe('turn');
    });

    it('turns anticlockwise for a left-to-right swipe', () => {
      const view = renderStage();

      view.down(50, 100);
      view.move(150, 100);

      // Canvas angles grow clockwise on screen, so anticlockwise is negative.
      expect(view.gesture.turnRef.current).toBeLessThan(0);
    });

    // The two axes have to agree, or a diagonal swipe cancels itself out.
    it('turns anticlockwise for a top-to-bottom swipe too', () => {
      const view = renderStage();

      view.down(100, 50);
      view.move(100, 150);

      expect(view.gesture.turnRef.current).toBeLessThan(0);
    });

    it('turns clockwise for the opposite swipes', () => {
      const rightToLeft = renderStage();
      rightToLeft.down(150, 100);
      rightToLeft.move(50, 100);
      expect(rightToLeft.gesture.turnRef.current).toBeGreaterThan(0);

      const bottomToTop = renderStage();
      bottomToTop.down(100, 150);
      bottomToTop.move(100, 50);
      expect(bottomToTop.gesture.turnRef.current).toBeGreaterThan(0);
    });

    // Down-and-right together should turn it more than either alone, not less.
    // Small, slow steps, so neither saturates the rate cap and hides the point.
    it('adds the two axes rather than letting them fight', () => {
      const straight = renderStage();
      straight.down(50, 50);
      straight.move(60, 50, 200);

      const diagonal = renderStage();
      diagonal.down(50, 50);
      diagonal.move(60, 60, 200);

      expect(Math.abs(diagonal.gesture.turnRef.current)).toBeGreaterThan(
        Math.abs(straight.gesture.turnRef.current),
      );
    });

    it('turns faster for a faster swipe', () => {
      // Small steps, so both stay below the rate cap and can be compared.
      const slow = renderStage();
      slow.down(50, 100);
      slow.move(60, 100, 100);

      const fast = renderStage();
      fast.down(50, 100);
      fast.move(60, 100, 20);

      expect(Math.abs(fast.gesture.turnRef.current)).toBeGreaterThan(
        Math.abs(slow.gesture.turnRef.current),
      );
    });

    it('caps the rate however hard it is swiped', () => {
      const view = renderStage();

      view.down(0, 100);
      for (let i = 0; i < 20; i += 1) {
        view.move(10_000, 100, 8);
      }

      expect(Math.abs(view.gesture.turnRef.current)).toBeLessThanOrEqual(2 * Math.PI * 2 + 0.001);
    });

    // A real barrel keeps turning after your hand leaves it. It matters more
    // than it sounds: the glass only moves while the tube turns, and a turn that
    // ends with the finger gives the pile a fraction of a second to avalanche in.
    it('coasts on after the swipe ends, and stops within a second or so', () => {
      const view = renderStage();

      view.down(50, 100);
      view.move(150, 100);
      const flick = view.gesture.turnRef.current;
      expect(flick).not.toBe(0);

      view.up();
      expect(view.gesture.mode).toBeNull();
      expect(view.gesture.turnRef.current).toBe(flick);

      // Half a second in it is still turning, the same way, but slower.
      for (let frame = 0; frame < 30; frame += 1) {
        view.gesture.settle(1 / 60);
      }
      expect(Math.sign(view.gesture.turnRef.current)).toBe(Math.sign(flick));
      expect(Math.abs(view.gesture.turnRef.current)).toBeLessThan(Math.abs(flick));

      // And it comes to a stop rather than creeping on for ever.
      for (let frame = 0; frame < 180; frame += 1) {
        view.gesture.settle(1 / 60);
      }
      expect(view.gesture.turnRef.current).toBe(0);
    });

    // Letting go of something you had already stopped does not set it going.
    it('stops dead when the finger had come to rest before lifting', () => {
      const view = renderStage();

      view.down(50, 100);
      view.move(150, 100);
      view.wait(500);
      view.up();

      expect(view.gesture.turnRef.current).toBe(0);
    });

    it('stops a coasting tube the moment it is grabbed again', () => {
      const view = renderStage();

      view.down(50, 100);
      view.move(150, 100);
      view.up();
      expect(view.gesture.turnRef.current).not.toBe(0);

      view.down(50, 100);

      expect(view.gesture.turnRef.current).toBe(0);
    });

    // A finger resting mid-swipe fires no move events, so the rate has to expire
    // on its own or the tube would keep turning under a motionless finger.
    it('stops the turn when the finger stops moving', () => {
      const view = renderStage();

      view.down(50, 100);
      view.move(150, 100);
      expect(view.gesture.turnRef.current).not.toBe(0);

      view.wait(500);
      view.gesture.settle(1 / 60);

      expect(view.gesture.turnRef.current).toBe(0);
    });

    it('keeps turning while the swipe is still fresh', () => {
      const view = renderStage();

      view.down(50, 100);
      view.move(150, 100);
      const rate = view.gesture.turnRef.current;

      view.wait(10);
      view.gesture.settle(1 / 60);

      expect(view.gesture.turnRef.current).toBe(rate);
    });
  });

  describe('panning', () => {
    it('pans instead of turning when Shift is held', () => {
      const view = renderStage();

      view.down(100, 100, { shiftKey: true });
      view.move(200, 100);

      expect(view.gesture.mode).toBe('pan');
      expect(view.gesture.panRef.current.x).toBeCloseTo(1, 5);
      expect(view.gesture.turnRef.current).toBe(0);
    });

    it('pans for a secondary button', () => {
      const view = renderStage();

      view.down(100, 100, { button: 2 });

      expect(view.gesture.mode).toBe('pan');
    });

    it('pans once a second finger joins', () => {
      const view = renderStage();

      view.down(100, 100);
      expect(view.gesture.mode).toBe('turn');

      fireEvent.pointerDown(view.stage, { pointerId: 2, button: 0, clientX: 120, clientY: 100 });

      expect(view.gesture.mode).toBe('pan');
    });

    it('leaves the source where the pan ended', () => {
      const view = renderStage();

      view.down(100, 100, { shiftKey: true });
      view.move(150, 100);
      const settled = { ...view.gesture.panRef.current };
      view.up();

      expect(view.gesture.panRef.current).toEqual(settled);
    });

    it('clamps the pan at the ends of its travel', () => {
      const view = renderStage();

      view.down(0, 100, { shiftKey: true });
      view.move(10_000, 100);

      expect(view.gesture.panRef.current.x).toBe(1);
    });

    // Two fingers track the pair, not either one. Following the first finger
    // alone would shove the source sideways every time the other one squeezed.
    it('drags from the point midway between two fingers', () => {
      const view = renderStage();

      view.down(60, 100);
      view.second(140, 100);
      // Both fingers move right by 20: the middle moves 20, not 40.
      view.move(80, 100, 100, 1);
      view.move(160, 100, 100, 2);

      expect(view.gesture.panRef.current.x).toBeCloseTo((20 / WIDTH) * 2, 5);
    });

    it('does not shove the source when a pinch is symmetric', () => {
      const view = renderStage();

      view.down(60, 100);
      view.second(140, 100);
      view.move(40, 100, 100, 1);
      view.move(160, 100, 100, 2);

      expect(view.gesture.panRef.current.x).toBeCloseTo(0, 5);
    });
  });

  describe('pinching', () => {
    it('zooms in as the fingers spread, from wherever the zoom already is', () => {
      const view = renderStage(1.5);

      view.down(60, 100);
      view.second(140, 100);
      // The span doubles, from 80 to 160.
      view.move(20, 100, 100, 1);
      view.move(180, 100, 100, 2);

      expect(view.zoom).toBeCloseTo(3, 5);
    });

    it('zooms out as the fingers close', () => {
      const view = renderStage(2);

      view.down(20, 100);
      view.second(180, 100);
      view.move(60, 100, 100, 1);
      view.move(140, 100, 100, 2);

      expect(view.zoom).toBeCloseTo(1, 5);
    });

    // Fingers dragging together are never perfectly parallel, so without a
    // deadband every two-finger pan would creep the zoom along with it.
    it('ignores the wobble in a two-finger drag', () => {
      const view = renderStage();

      view.down(60, 100);
      view.second(140, 100);
      // Both move right, one a couple of pixels further: a 2.5% change.
      view.move(90, 100, 100, 1);
      view.move(172, 100, 100, 2);

      expect(view.zoomed).toHaveLength(0);
    });

    // Two fingers landing on top of each other give a tiny starting span, and
    // dividing by it turns a millimetre of movement into a wild change.
    it('does not pinch from two fingers landing on the same spot', () => {
      const view = renderStage();

      view.down(100, 100);
      view.second(105, 100);
      view.move(60, 100, 100, 1);
      view.move(160, 100, 100, 2);

      expect(view.zoomed).toHaveLength(0);
    });

    it('leaves the zoom alone for a one-finger swipe', () => {
      const view = renderStage();

      view.down(50, 100);
      view.move(150, 100);
      view.up();

      expect(view.zoomed).toHaveLength(0);
    });

    // Fingers rarely leave together. The one still down goes on dragging, and
    // it must not take the source with it by the width of the gap.
    it('keeps the source still when one finger of a pinch lifts', () => {
      const view = renderStage();

      view.down(60, 100);
      view.second(140, 100);
      view.move(60, 100, 100, 1);
      view.move(140, 100, 100, 2);

      const held = { ...view.gesture.panRef.current };
      view.up(2);
      view.move(140, 100, 100, 1);

      expect(view.gesture.panRef.current.x).toBeCloseTo(held.x + (80 / WIDTH) * 2, 5);
    });

    it('starts a fresh pinch from the zoom the last one left', () => {
      const view = renderStage(1);

      view.down(60, 100);
      view.second(140, 100);
      view.move(20, 100, 100, 1);
      view.move(180, 100, 100, 2);
      view.up(1);
      view.up(2);

      expect(view.zoom).toBeCloseTo(2, 5);

      view.down(60, 100);
      view.second(140, 100);
      view.move(20, 100, 100, 1);
      view.move(180, 100, 100, 2);

      expect(view.zoom).toBeCloseTo(4, 5);
    });
  });

  it('recentres and stops on reset', () => {
    const view = renderStage();

    view.down(50, 100);
    view.move(150, 100);
    act(() => {
      view.gesture.reset();
    });

    expect(view.gesture.turnRef.current).toBe(0);
    expect(view.gesture.panRef.current).toEqual({ x: 0, y: 0 });
    expect(view.gesture.mode).toBeNull();
  });
});
