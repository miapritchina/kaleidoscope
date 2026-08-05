import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { usePointerDrag, type PointerDrag } from './usePointerDrag';

const STAGE = { width: 200, height: 100, left: 0, top: 0 };

function Harness({ expose }: { expose: (drag: PointerDrag) => void }) {
  const drag = usePointerDrag();
  expose(drag);

  return (
    <div data-testid="stage" {...drag.handlers}>
      stage
    </div>
  );
}

function renderStage() {
  let drag!: PointerDrag;
  const view = render(<Harness expose={(value) => (drag = value)} />);
  const stage = view.getByTestId('stage');

  // jsdom lays nothing out, and pointer capture is unimplemented.
  stage.getBoundingClientRect = () => ({
    ...STAGE,
    right: 200,
    bottom: 100,
    x: 0,
    y: 0,
    toJSON: () => '',
  });
  stage.setPointerCapture = vi.fn();
  stage.releasePointerCapture = vi.fn();
  stage.hasPointerCapture = vi.fn().mockReturnValue(true);

  const down = (x: number, y: number, button = 0) =>
    fireEvent.pointerDown(stage, { pointerId: 1, button, clientX: x, clientY: y });
  const move = (x: number, y: number) =>
    fireEvent.pointerMove(stage, { pointerId: 1, clientX: x, clientY: y });
  const up = () => fireEvent.pointerUp(stage, { pointerId: 1 });

  return {
    stage,
    down,
    move,
    up,
    get drag() {
      return drag;
    },
  };
}

describe('usePointerDrag', () => {
  it('starts centred', () => {
    const view = renderStage();

    expect(view.drag.positionRef.current).toEqual({ x: 0, y: 0 });
    expect(view.drag.isDragging).toBe(false);
  });

  // Hovering used to move the source, which reads as it sliding away by itself.
  it('ignores movement when the pointer is not held down', () => {
    const view = renderStage();

    view.move(150, 80);

    expect(view.drag.positionRef.current).toEqual({ x: 0, y: 0 });
  });

  it('moves the source with the pointer, not against it', () => {
    const view = renderStage();

    view.down(100, 50);
    view.move(150, 50);

    // Half the width to the right is a full sweep of the travel.
    expect(view.drag.positionRef.current.x).toBeCloseTo(0.5, 5);
    expect(view.drag.positionRef.current.y).toBe(0);
  });

  it('tracks both axes', () => {
    const view = renderStage();

    view.down(100, 50);
    view.move(100, 25);

    expect(view.drag.positionRef.current.y).toBeCloseTo(-0.5, 5);
  });

  it('leaves the source where it was let go', () => {
    const view = renderStage();

    view.down(100, 50);
    view.move(150, 50);
    view.up();
    const settled = { ...view.drag.positionRef.current };

    view.move(20, 90);

    expect(view.drag.positionRef.current).toEqual(settled);
  });

  it('resumes from where the previous drag ended', () => {
    const view = renderStage();

    view.down(100, 50);
    view.move(140, 50);
    view.up();

    view.down(100, 50);
    view.move(140, 50);

    expect(view.drag.positionRef.current.x).toBeCloseTo(0.8, 5);
  });

  it('clamps at the ends of the travel', () => {
    const view = renderStage();

    view.down(0, 50);
    view.move(10_000, 50);

    expect(view.drag.positionRef.current.x).toBe(1);
  });

  it('captures the pointer so a drag off the canvas keeps tracking', () => {
    const view = renderStage();

    view.down(100, 50);

    expect(view.stage.setPointerCapture).toHaveBeenCalledWith(1);
    expect(view.drag.isDragging).toBe(true);

    view.up();

    expect(view.stage.releasePointerCapture).toHaveBeenCalledWith(1);
    expect(view.drag.isDragging).toBe(false);
  });

  it('ignores non-primary buttons, so a context menu does not drag', () => {
    const view = renderStage();

    view.down(100, 50, 2);
    view.move(150, 50);

    expect(view.drag.positionRef.current).toEqual({ x: 0, y: 0 });
  });

  it('recentres on reset', () => {
    const view = renderStage();

    view.down(100, 50);
    view.move(150, 50);
    view.drag.reset();

    expect(view.drag.positionRef.current).toEqual({ x: 0, y: 0 });
  });
});
