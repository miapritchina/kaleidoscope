import { act, fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useStageGesture, type StageGesture } from './useStageGesture';

const WIDTH = 200;
const HEIGHT = 200;

function Harness({ expose, now }: { expose: (gesture: StageGesture) => void; now: () => number }) {
  const gesture = useStageGesture(now);
  expose(gesture);

  return (
    <div data-testid="stage" {...gesture.handlers}>
      stage
    </div>
  );
}

function renderStage() {
  let gesture!: StageGesture;
  // The hook's clock is injected so a swipe's speed can be dictated exactly;
  // event timestamps cannot be, jsdom overwrites them.
  let clock = 1000;
  const view = render(<Harness expose={(value) => (gesture = value)} now={() => clock} />);
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
    get gesture() {
      return gesture;
    },
    down(x: number, y: number, init: Record<string, unknown> = {}) {
      fireEvent.pointerDown(stage, { pointerId: 1, button: 0, clientX: x, clientY: y, ...init });
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
