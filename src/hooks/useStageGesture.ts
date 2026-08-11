import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';

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

/**
 * Shortest pinch, in pixels, that is taken as one.
 *
 * Two fingers landing almost on top of each other give a tiny starting span, and
 * dividing by it turns a millimetre of movement into a wild change of scale.
 */
const MIN_PINCH_SPAN = 40;

/**
 * How far the span has to change before it counts as a pinch, as a fraction.
 *
 * Fingers dragging together are never perfectly parallel, so without a deadband
 * every two-finger pan would creep the zoom along with it.
 */
const PINCH_DEADBAND = 0.06;

export interface StageGestureOptions {
  /** Injectable clock, so a swipe's speed can be dictated in tests. */
  now?: (() => number) | undefined;
  /**
   * The current zoom, read when a pinch begins.
   *
   * Read rather than remembered, so the pinch scales from wherever the zoom has
   * got to — including a change made on the slider between two pinches.
   */
  zoom?: (() => number) | undefined;
  /** The pinched zoom. Clamping to the allowed range is the caller's business. */
  onZoom?: ((zoom: number) => void) | undefined;
}

interface Origin {
  x: number;
  y: number;
  startX: number;
  startY: number;
}

/** Where a pinch began: the span between the fingers, and the zoom then. */
interface Pinch {
  span: number;
  zoom: number;
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
 * and it coasts to a stop the way a real barrel does.
 *
 * Two fingers — or Shift, or a secondary button — move the source instead, so
 * both gestures live on the same surface without one stealing the other. With
 * two down it is the pair that is tracked rather than either finger: the point
 * midway between them drags the source, and the span between them zooms it, the
 * way every photo viewer on a phone behaves.
 */
export function useStageGesture(options: StageGestureOptions = {}): StageGesture {
  const panRef = useRef<Vector>({ x: 0, y: 0 });
  const turnRef = useRef(0);
  const originRef = useRef<Origin | null>(null);
  const lastSampleRef = useRef<Sample | null>(null);
  const pinchRef = useRef<Pinch | null>(null);
  // Which fingers have reported a new position since the pinch was last read.
  // Pointer events arrive one finger at a time, so between two of them the span
  // reflects one finger that has moved and one that has not — a transient the
  // hand never made. Waiting for both keeps every reading a coherent pair.
  const movedSincePinch = useRef(new Set<number>());
  const activePointers = useRef(new Map<number, Vector>());
  const [mode, setMode] = useState<GestureMode | null>(null);
  const modeRef = useRef<GestureMode | null>(null);

  // Held in a ref so a caller passing fresh closures every render — which is
  // the normal way to write them — does not invalidate every handler. Synced
  // after paint rather than during render; a pointer event cannot arrive before
  // the frame it belongs to has been painted.
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  const now = useCallback(() => (optionsRef.current.now ?? defaultNow)(), []);

  const setActiveMode = useCallback((next: GestureMode | null) => {
    modeRef.current = next;
    setMode(next);
  }, []);

  /**
   * Re-anchors the drag to whatever is on the surface now.
   *
   * Called whenever a finger arrives or leaves mid-gesture: without it the
   * origin still refers to a set of fingers that no longer exists, and the
   * source jumps by however far the tracked point moved.
   */
  const anchor = useCallback(() => {
    const middle = centroid(activePointers.current);

    if (!middle) {
      return;
    }

    originRef.current = {
      x: middle.x,
      y: middle.y,
      startX: panRef.current.x,
      startY: panRef.current.y,
    };

    const reach = span(activePointers.current);

    pinchRef.current =
      reach >= MIN_PINCH_SPAN ? { span: reach, zoom: optionsRef.current.zoom?.() ?? 1 } : null;
    movedSincePinch.current.clear();
  }, []);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0 && event.button !== 2) {
        return;
      }

      activePointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

      // A second finger switches an in-flight turn into a pan-and-pinch, which
      // is how two-finger gestures behave everywhere else.
      const wantsPan =
        activePointers.current.size > 1 || event.shiftKey || event.altKey || event.button === 2;

      anchor();
      lastSampleRef.current = { x: event.clientX, y: event.clientY, time: now() };
      turnRef.current = 0;
      event.currentTarget.setPointerCapture(event.pointerId);
      setActiveMode(wantsPan ? 'pan' : 'turn');
    },
    [anchor, now, setActiveMode],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const origin = originRef.current;
      const current = modeRef.current;

      if (!origin || !current) {
        return;
      }

      if (activePointers.current.has(event.pointerId)) {
        activePointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      }

      const bounds = event.currentTarget.getBoundingClientRect();

      if (bounds.width === 0 || bounds.height === 0) {
        return;
      }

      if (current === 'pan') {
        // The point midway between the fingers, so squeezing symmetrically
        // zooms without also shoving the source across the stage.
        const middle = centroid(activePointers.current) ?? { x: event.clientX, y: event.clientY };

        panRef.current = {
          x: clampUnit(origin.startX + ((middle.x - origin.x) / bounds.width) * PAN_SENSITIVITY),
          y: clampUnit(origin.startY + ((middle.y - origin.y) / bounds.height) * PAN_SENSITIVITY),
        };

        const pinch = pinchRef.current;
        movedSincePinch.current.add(event.pointerId);

        if (pinch && movedSincePinch.current.size >= 2) {
          movedSincePinch.current.clear();

          const reach = span(activePointers.current);
          const scale = reach > 0 ? reach / pinch.span : 1;

          // Outside the deadband the whole scale is applied, not the part past
          // it: a pinch that snapped to 1.06 the moment it was recognised would
          // read as a jolt.
          if (Math.abs(scale - 1) > PINCH_DEADBAND) {
            optionsRef.current.onZoom?.(pinch.zoom * scale);
          }
        }

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
        // Lifting one finger of a pinch leaves the other still dragging, so the
        // drag is re-anchored to it rather than jumping by the gap between them.
        anchor();
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
      pinchRef.current = null;
      movedSincePinch.current.clear();
      setActiveMode(null);
    },
    [anchor, now, setActiveMode],
  );

  const reset = useCallback(() => {
    panRef.current = { x: 0, y: 0 };
    turnRef.current = 0;
    originRef.current = null;
    lastSampleRef.current = null;
    pinchRef.current = null;
    movedSincePinch.current.clear();
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

/** The point midway between the fingers, or `null` if there are none. */
function centroid(pointers: ReadonlyMap<number, Vector>): Vector | null {
  if (pointers.size === 0) {
    return null;
  }

  let x = 0;
  let y = 0;

  for (const point of pointers.values()) {
    x += point.x;
    y += point.y;
  }

  return { x: x / pointers.size, y: y / pointers.size };
}

/**
 * How far apart the fingers are, in pixels. Zero for fewer than two.
 *
 * With more than two it is the widest pair, which is what the hand is doing:
 * a third finger resting in the middle should not shrink the span.
 */
function span(pointers: ReadonlyMap<number, Vector>): number {
  const points = [...pointers.values()];
  let widest = 0;

  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      widest = Math.max(
        widest,
        Math.hypot(points[j]!.x - points[i]!.x, points[j]!.y - points[i]!.y),
      );
    }
  }

  return widest;
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
