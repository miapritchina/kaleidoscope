import { useEffect, useRef } from 'react';

export type FrameCallback = (deltaSeconds: number, elapsedSeconds: number) => void;

/**
 * Runs `callback` once per animation frame while `active` is true.
 *
 * The callback is held in a ref, so callers may pass a fresh closure on every
 * render without restarting the loop — only `active` does that.
 */
export function useAnimationFrame(callback: FrameCallback, active = true): void {
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!active) {
      return;
    }

    let frameId = 0;
    const start = performance.now();
    let previous = start;

    const tick = (now: number) => {
      frameId = requestAnimationFrame(tick);
      const deltaSeconds = (now - previous) / 1000;
      previous = now;
      callbackRef.current(deltaSeconds, (now - start) / 1000);
    };

    frameId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frameId);
    };
  }, [active]);
}
