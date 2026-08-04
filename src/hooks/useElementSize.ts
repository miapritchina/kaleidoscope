import { useCallback, useEffect, useRef, useState, type RefCallback } from 'react';

export interface ElementSize {
  width: number;
  height: number;
}

/**
 * Observes an element's content-box size.
 *
 * Returns a ref callback rather than a ref object so the observer attaches as
 * soon as the node mounts, including when it is swapped out by a re-render.
 */
export function useElementSize<T extends Element>(): [RefCallback<T>, ElementSize] {
  const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 });
  const observerRef = useRef<ResizeObserver | null>(null);

  useEffect(() => {
    return () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
    };
  }, []);

  const ref = useCallback<RefCallback<T>>((node) => {
    observerRef.current?.disconnect();

    if (!node) {
      return;
    }

    if (typeof ResizeObserver === 'undefined') {
      const { width, height } = node.getBoundingClientRect();
      setSize({ width, height });
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];

      if (!entry) {
        return;
      }

      const box = entry.contentBoxSize.at(0);
      const width = box ? box.inlineSize : entry.contentRect.width;
      const height = box ? box.blockSize : entry.contentRect.height;

      setSize((current) =>
        current.width === width && current.height === height ? current : { width, height },
      );
    });

    observer.observe(node);
    observerRef.current = observer;
  }, []);

  return [ref, size];
}
