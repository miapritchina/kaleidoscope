import { useEffect, useImperativeHandle, useMemo, useRef, type RefObject } from 'react';

import { useAnimationFrame } from '../hooks/useAnimationFrame';
import { useElementSize } from '../hooks/useElementSize';
import { KaleidoscopeRenderer } from '../lib/renderer';
import { createScene, updateScene } from '../lib/scene';
import type { Settings } from '../lib/settings';

import styles from './Kaleidoscope.module.css';

export interface KaleidoscopeHandle {
  /** Returns the current frame as a PNG data URL, or `null` before first paint. */
  capture: () => string | null;
}

export interface KaleidoscopeProps {
  settings: Settings;
  /** Pauses the simulation. The last frame stays on screen. */
  paused?: boolean;
  ref?: RefObject<KaleidoscopeHandle | null>;
}

/**
 * The canvas surface.
 *
 * Everything that changes per frame — the scene, the renderer, the pointer —
 * lives in refs. React owns the settings; the animation loop owns the pixels.
 * Re-rendering this component never restarts the animation.
 */
export function Kaleidoscope({ settings, paused = false, ref }: KaleidoscopeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<KaleidoscopeRenderer | null>(null);
  const pointerRef = useRef({ x: 0, y: 0 });
  const [containerRef, size] = useElementSize<HTMLDivElement>();

  // A new seed or shard count means a genuinely different scene; anything else
  // is applied to the running simulation without resetting it.
  const scene = useMemo(
    () => createScene(settings.seed, settings.shards),
    [settings.seed, settings.shards],
  );

  useImperativeHandle(ref, () => ({ capture: () => rendererRef.current?.toDataUrl() ?? null }), []);

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    try {
      rendererRef.current = new KaleidoscopeRenderer(canvas);
    } catch (error) {
      console.error('Unable to start the kaleidoscope renderer', error);
      rendererRef.current = null;
    }

    return () => {
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    const renderer = rendererRef.current;

    if (!renderer || size.width === 0 || size.height === 0) {
      return;
    }

    renderer.resize(size.width, size.height, window.devicePixelRatio);
    renderer.render(scene, settings);
  }, [size.width, size.height, scene, settings]);

  useAnimationFrame((deltaSeconds) => {
    const renderer = rendererRef.current;

    if (!renderer) {
      return;
    }

    // `updateScene` clamps the step, so a long frame cannot teleport the field.
    updateScene(scene, {
      dt: deltaSeconds,
      speed: settings.speed,
      pointer: pointerRef.current,
    });
    renderer.render(scene, settings);
  }, !paused);

  return (
    <div
      ref={containerRef}
      className={styles.stage}
      onPointerMove={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        pointerRef.current = {
          x: clampUnit(((event.clientX - bounds.left) / bounds.width) * 2 - 1),
          y: clampUnit(((event.clientY - bounds.top) / bounds.height) * 2 - 1),
        };
      }}
      onPointerLeave={() => {
        pointerRef.current = { x: 0, y: 0 };
      }}
    >
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        role="img"
        aria-label={`Kaleidoscope with ${String(settings.segments)} mirrored segments, seed ${settings.seed}`}
      />
    </div>
  );
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(-1, value));
}
