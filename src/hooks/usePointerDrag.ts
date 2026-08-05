import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

export interface DragPosition {
  x: number;
  y: number;
}

export interface PointerDrag {
  /** Current position, each axis in `[-1, 1]`. Read from the animation loop. */
  positionRef: { current: DragPosition };
  isDragging: boolean;
  handlers: {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
  };
  reset: () => void;
}

/**
 * Tracks a press-and-drag as a position in `[-1, 1]` per axis.
 *
 * Dragging moves the source with the pointer and leaves it where it was let go.
 * Tracking the pointer on hover instead — which is what this replaced — reads as
 * the image sliding away by itself, and inverts the direction people expect:
 * grabbing something and pulling right should carry it right.
 *
 * The position lives in a ref because the animation loop reads it every frame;
 * routing it through state would re-render the tree 60 times a second.
 */
export function usePointerDrag(): PointerDrag {
  const positionRef = useRef<DragPosition>({ x: 0, y: 0 });
  const originRef = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    // Ignore secondary buttons so a right-click menu does not start a drag.
    if (event.button !== 0) {
      return;
    }

    originRef.current = {
      x: event.clientX,
      y: event.clientY,
      startX: positionRef.current.x,
      startY: positionRef.current.y,
    };
    // Capture, so a drag that leaves the canvas keeps tracking until release.
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsDragging(true);
  }, []);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const origin = originRef.current;

    if (!origin) {
      return;
    }

    const bounds = event.currentTarget.getBoundingClientRect();

    if (bounds.width === 0 || bounds.height === 0) {
      return;
    }

    // A drag across half the stage is a full sweep of the travel, which keeps
    // the gesture usable on a phone without feeling twitchy on a desktop.
    positionRef.current = {
      x: clampUnit(origin.startX + ((event.clientX - origin.x) / bounds.width) * 2),
      y: clampUnit(origin.startY + ((event.clientY - origin.y) / bounds.height) * 2),
    };
  }, []);

  const end = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    originRef.current = null;
    setIsDragging(false);

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const reset = useCallback(() => {
    positionRef.current = { x: 0, y: 0 };
    originRef.current = null;
    setIsDragging(false);
  }, []);

  return {
    positionRef,
    isDragging,
    handlers: { onPointerDown, onPointerMove, onPointerUp: end, onPointerCancel: end },
    reset,
  };
}

function clampUnit(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(-1, value)) : 0;
}
