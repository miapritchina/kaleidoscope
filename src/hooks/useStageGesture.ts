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
   * Call once a frame, with the frame's length in seconds.
   *
   * Does two jobs, both of which need a clock rather than a pointer event: a
   * finger held still fires no `pointermove`, so the rate has to be expired
   * here; and once the finger lifts, a flick coasts to a stop here.
   */
  settle: (deltaSeconds: number) => void;
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

/**
 * How quickly a flicked tube slows, per second.
 *
 * A real barrel keeps turning after your hand leaves it and is stopped by the
 * friction of its own fittings within a second or so — it is not a bearing, and
 * it does not stop dead either. The coast matters more than it sounds: the glass
 * only moves while the tube is turning, so a turn that ends the instant the
 * finger lifts gives the pile a fraction of a second to avalanche in, which is
 * not long enough to see it happen at all.
 */
const COAST_FRICTION = 1.8;

/** Turning rate below which a coasting tube is simply stopped, in radians/sec. */
const COAST_MINIMUM = 0.12;

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
 * A plain swipe turns the tube: left-to-right or top-to-bottom goes
 * anticlockwise, and the swipe's speed sets the turning rate. Let go mid-swipe
 * and it coasts to a stop the way a real barrel does. Holding a second finger
 * down — or Shift, or a secondary button — pans the source instead, so both
 * gestures live on the same surface without one stealing the other.
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
      // Rightwards and downwards both read as anticlockwise, so the two axes
      // add. They have to agree: pushing the rim of a wheel from below sends it
      // anticlockwise whether you push right or push down, and splitting them
      // would leave a diagonal swipe cancelling itself out.
      const sweeps = -(
        (event.clientX - previous.x) / bounds.width +
        (event.clientY - previous.y) / bounds.height
      );
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

      // Whatever it was doing at the moment of release is kept, and `settle`
      // coasts it down from there — unless the finger had come to a rest first,
      // in which case there is nothing to carry and letting go stops it.
      const last = lastSampleRef.current;

      if (modeRef.current !== 'turn' || !last || now() - last.time > STALE_MOVE_MS) {
        turnRef.current = 0;
      }

      originRef.current = null;
      lastSampleRef.current = null;
      setActiveMode(null);
    },
    [now, setActiveMode],
  );

  const reset = useCallback(() => {
    panRef.current = { x: 0, y: 0 };
    turnRef.current = 0;
    originRef.current = null;
    lastSampleRef.current = null;
    activePointers.current.clear();
    setActiveMode(null);
  }, [setActiveMode]);

  const settle = useCallback(
    (deltaSeconds: number) => {
      const last = lastSampleRef.current;

      if (modeRef.current === 'turn') {
        // Holding still holds the tube still, which is what a real one does.
        if (last && now() - last.time > STALE_MOVE_MS) {
          turnRef.current = 0;
        }

        return;
      }

      if (modeRef.current !== null || turnRef.current === 0) {
        return;
      }

      const step = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0;
      const coasting = turnRef.current * Math.exp(-COAST_FRICTION * step);

      turnRef.current = Math.abs(coasting) < COAST_MINIMUM ? 0 : coasting;
    },
    [now],
  );

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
