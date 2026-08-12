import { useEffect, useImperativeHandle, useMemo, useRef, type RefObject } from 'react';

import { useAnimationFrame } from '../hooks/useAnimationFrame';
import { useElementSize } from '../hooks/useElementSize';
import { useStageGesture } from '../hooks/useStageGesture';
import { cx } from '../lib/cx';
import type { MediaElement } from '../lib/media';
import { KaleidoscopeRenderer } from '../lib/renderer';
import { createScene, updateScene } from '../lib/scene';
import type { Settings } from '../lib/settings';

import styles from './Kaleidoscope.module.css';

/**
 * How much one notch of wheel changes the zoom, as an exponent.
 *
 * Exponential rather than linear, so a notch is the same proportion of the zoom
 * wherever it starts — the way a pinch is.
 */
const WHEEL_ZOOM = 0.0015;

export interface KaleidoscopeHandle {
  /** Returns the current frame as a PNG data URL, or `null` before first paint. */
  capture: () => string | null;
  /**
   * Returns a square PNG that repeats without a seam. `null` before the first
   * paint, or if the surfaces cannot be made.
   */
  capturePattern: () => Promise<Blob | null>;
}

export interface KaleidoscopeProps {
  settings: Settings;
  /** Pauses the simulation. The last frame stays on screen. */
  paused?: boolean;
  /** Photo or camera element to mirror, when `settings.source` selects one. */
  media?: MediaElement | null;
  /** Picture to cut the pieces out of, when `settings.skin` asks for one. */
  skin?: MediaElement | null;
  /**
   * How far the instrument is tilted, in radians, or `null` for not knowing.
   * It moves gravity rather than the figure: the mirrors are fixed in the tube
   * and the tube is the phone, so tipping it changes which way the pieces fall
   * and turns nothing on screen.
   */
  tiltRef?: { current: number | null };
  /**
   * Applies a pinched zoom. Left out, pinching does nothing.
   *
   * Zoom is a setting rather than a piece of gesture state, so the clamping and
   * the slider that has to agree with it both belong to the owner of it.
   */
  onZoom?: ((zoom: number) => void) | undefined;
  ref?: RefObject<KaleidoscopeHandle | null>;
}

/**
 * The canvas surface.
 *
 * Everything that changes per frame — the scene, the renderer, the pointer —
 * lives in refs. React owns the settings; the animation loop owns the pixels.
 * Re-rendering this component never restarts the animation.
 */
export function Kaleidoscope({
  settings,
  paused = false,
  media = null,
  skin = null,
  tiltRef,
  onZoom,
  ref,
}: KaleidoscopeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<KaleidoscopeRenderer | null>(null);
  // The pinch reads the zoom when it starts, so it scales from wherever the
  // zoom has got to rather than from whatever it was when this render ran.
  const zoomRef = useRef(settings.zoom);
  useEffect(() => {
    zoomRef.current = settings.zoom;
  }, [settings.zoom]);
  const gesture = useStageGesture({ zoom: () => zoomRef.current, onZoom });
  const [containerRef, size] = useElementSize<HTMLDivElement>();

  // A new seed, count or piece size means a genuinely different scene; anything
  // else is applied to the running simulation without resetting it. Size counts
  // because it is geometry: bigger pieces displace their neighbours and settle
  // into a different pile, which cannot be done by scaling what is already
  // there.
  const scene = useMemo(
    () => createScene(settings.seed, settings.shards, settings.chipSize),
    [settings.seed, settings.shards, settings.chipSize],
  );

  useImperativeHandle(
    ref,
    () => ({
      capture: () => rendererRef.current?.toDataUrl() ?? null,
      capturePattern: async () => (await rendererRef.current?.toPatternBlob(settings)) ?? null,
    }),
    [settings],
  );

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
    // Repaint on any of these even while paused, so a newly picked photo or a
    // changed setting shows up without needing the animation to be running.
    renderer.render(scene, settings, media, skin);
  }, [size.width, size.height, scene, settings, media, skin]);

  useAnimationFrame(
    (deltaSeconds) => {
      const renderer = rendererRef.current;

      if (!renderer) {
        return;
      }

      // Paused freezes the simulation, not the interaction: a zero step still
      // takes the new drag position and repaints, so the source can be moved
      // around while the animation is stopped.
      // `updateScene` clamps the step, so a long frame cannot teleport the field.
      // A finger held still fires no move events, so the rate has to be expired
      // here rather than waiting for one — and a flick coasts down here too.
      gesture.settle(deltaSeconds);
      updateScene(scene, {
        dt: paused ? 0 : deltaSeconds,
        turn: gesture.turnRef.current,
        drag: gesture.panRef.current,
        tilt: tiltRef?.current ?? 0,
      });
      renderer.render(scene, settings, media, skin);
    },
    !paused || gesture.mode !== null || tiltRef !== undefined,
  );

  return (
    <div
      ref={containerRef}
      className={cx(styles.stage, gesture.mode === 'pan' && styles.panning)}
      {...gesture.handlers}
      onWheel={(event) => {
        if (!onZoom) {
          return;
        }

        // What a pinch does, for a hand that has not got two fingers on glass.
        // A trackpad's pinch arrives here as a ctrl-wheel, so the two paths are
        // the same gesture and take the same sensitivity.
        event.preventDefault();
        onZoom(zoomRef.current * Math.exp(-event.deltaY * WHEEL_ZOOM));
      }}
      onContextMenu={(event) => {
        // A secondary-button drag pans; the menu would interrupt it.
        event.preventDefault();
      }}
    >
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        role="img"
        aria-label={describe(settings)}
      />
    </div>
  );
}

function describe({ source, seed }: Settings): string {
  // The mirror count is not a setting: a tube has three, and there is nothing
  // to announce about it that the word "kaleidoscope" does not already say.
  const assembly = 'Kaleidoscope';

  switch (source) {
    case 'image':
      return `${assembly}, mirroring an uploaded photo`;
    case 'camera':
      return `${assembly}, mirroring the live camera`;
    case 'objects':
      return `${assembly}, seed ${seed}`;
  }
}
