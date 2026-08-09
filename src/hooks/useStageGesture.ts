import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

export type GestureMode = 'turn' | 'pan';

export interface Vector {
  x: number;
  y: number;
}

export interface StageGesture {
  /** Current pan position, each axis in `[-1, 1]`. Read from the frame loop. */
  panRef: { current: Vector };
  /** Current turning rate in radians per second. Zero unless mid-swipe. */
  turnRef: { current: number };
  /** The gesture in progress, for the cursor. */
  mode: GestureMode | null;
  handlers: {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
  };
  /**
   * Call once a frame.
   *
   * A finger held still fires no `pointermove`, so without this the last
   * velocity would keep the tube turning under a motionless finger.
   */
  settle: () => void;
  reset: () => void;
}

/**
 * A swipe across the whole stage in one second turns the tube this many times.
 *
 * Turning a real kaleidoscope is a wrist movement, not a flick, so the mapping
 * is deliberately unhurried.
 */
const TURNS_PER_SWEEP = 0.6;

/** Fastest the tube will turn, in turns per second, however hard it is swiped. */
const MAX_TURNS_PER_SECOND = 2;

/**
 * Smoothing applied to the swipe velocity, per event.
 *
 * Pointer samples are jittery, and an unsmoothed rate makes the figure stutter.
 */
const VELOCITY_SMOOTHING = 0.35;

/**
 * A finger resting mid-swipe stops counting as a swipe after this long.
 *
 * Holding still should hold the tube still, which is what a real one does.
 */
const STALE_MOVE_MS = 90;

/** How far a drag across half the stage moves the source. */
const PAN_SENSITIVITY = 2;

interface Origin {
  x: number;
  y: number;
  startX: number;
  startY: number;
}

interface Sample {
  x: number;
  y: number;
  time: number;
}

/**
 * The stage's pointer gestures.
 *
 * A plain swipe turns the tube: left-to-right or top-to-bottom goes clockwise,
 * and the swipe's speed sets the turning rate, which drops to nothing the moment
 * the swipe ends. Holding a second finger down — or Shift, or a secondary
 * button — pans the source instead, so both gestures live on the same surface
 * without one stealing the other.
 */
export function useStageGesture(now: () => number = defaultNow): StageGesture {
  const panRef = useRef<Vector>({ x: 0, y: 0 });
  const turnRef = useRef(0);
  const originRef = useRef<Origin | null>(null);
  const lastSampleRef = useRef<Sample | null>(null);
  const activePointers = useRef(new Set<number>());
  const [mode, setMode] = useState<GestureMode | null>(null);
  const modeRef = useRef<GestureMode | null>(null);

  const setActiveMode = useCallback((next: GestureMode | null) => {
    modeRef.current = next;
    setMode(next);
  }, []);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0 && event.button !== 2) {
        return;
      }

      activePointers.current.add(event.pointerId);

      // A second finger switches an in-flight turn into a pan, which is how
      // two-finger gestures behave elsewhere.
      const wantsPan =
        activePointers.current.size > 1 || event.shiftKey || event.altKey || event.button === 2;

      originRef.current = {
        x: event.clientX,
        y: event.clientY,
        startX: panRef.current.x,
        startY: panRef.current.y,
      };
      lastSampleRef.current = { x: event.clientX, y: event.clientY, time: now() };
      turnRef.current = 0;
      event.currentTarget.setPointerCapture(event.pointerId);
      setActiveMode(wantsPan ? 'pan' : 'turn');
    },
    [now, setActiveMode],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const origin = originRef.current;
      const current = modeRef.current;

      if (!origin || !current) {
        return;
      }

      const bounds = event.currentTarget.getBoundingClientRect();

      if (bounds.width === 0 || bounds.height === 0) {
        return;
      }

      if (current === 'pan') {
        panRef.current = {
          x: clampUnit(
            origin.startX + ((event.clientX - origin.x) / bounds.width) * PAN_SENSITIVITY,
          ),
          y: clampUnit(
            origin.startY + ((event.clientY - origin.y) / bounds.height) * PAN_SENSITIVITY,
          ),
        };
        return;
      }

      const previous = lastSampleRef.current;
      const time = now();
      lastSampleRef.current = { x: event.clientX, y: event.clientY, time };

      if (!previous) {
        return;
      }

      // Guard against a zero or absurd interval: coalesced events can share an
      // instant, and a tab that was backgrounded can report a huge one.
      const seconds = Math.min(0.1, Math.max(0.008, (time - previous.time) / 1000));
      // Rightwards and downwards both read as clockwise, so the two axes add.
      const sweeps =
        (event.clientX - previous.x) / bounds.width + (event.clientY - previous.y) / bounds.height;
      const target = clampTurn((sweeps / seconds) * TURNS_PER_SWEEP * Math.PI * 2);

      turnRef.current += (target - turnRef.current) * VELOCITY_SMOOTHING;
    },
    [now],
  );

  const end = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      activePointers.current.delete(event.pointerId);

      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }

      if (activePointers.current.size > 0) {
        return;
      }

      // The turn ends with the swipe; no coasting, for now.
      turnRef.current = 0;
      originRef.current = null;
      lastSampleRef.current = null;
      setActiveMode(null);
    },
    [setActiveMode],
  );

  const reset = useCallback(() => {
    panRef.current = { x: 0, y: 0 };
    turnRef.current = 0;
    originRef.current = null;
    lastSampleRef.current = null;
    activePointers.current.clear();
    setActiveMode(null);
  }, [setActiveMode]);

  const settle = useCallback(() => {
    const last = lastSampleRef.current;

    if (modeRef.current === 'turn' && last && now() - last.time > STALE_MOVE_MS) {
      turnRef.current = 0;
    }
  }, [now]);

  return {
    panRef,
    turnRef,
    mode,
    handlers: { onPointerDown, onPointerMove, onPointerUp: end, onPointerCancel: end },
    settle,
    reset,
  };
}

function defaultNow(): number {
  return performance.now();
}

function clampUnit(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(-1, value)) : 0;
}

function clampTurn(radiansPerSecond: number): number {
  if (!Number.isFinite(radiansPerSecond)) {
    return 0;
  }

  const limit = MAX_TURNS_PER_SECOND * Math.PI * 2;

  return Math.min(limit, Math.max(-limit, radiansPerSecond));
}
