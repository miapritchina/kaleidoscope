import { useEffect, useImperativeHandle, useMemo, useRef, useState, type RefObject } from 'react';

import { useAnimationFrame } from '../hooks/useAnimationFrame';
import { useElementSize } from '../hooks/useElementSize';
import { useStageGesture } from '../hooks/useStageGesture';
import { AIR, FRESH_LIQUID, liquidCell } from '../lib/physics';
import { createChime, readImpacts, type Chime, type Impact } from '../lib/chime';
import { cx } from '../lib/cx';
import type { MediaElement } from '../lib/media';
import { KaleidoscopeRenderer } from '../lib/body';
import { createScene, updateScene, type SceneCut } from '../lib/scene';
import type { Settings, SubstanceId } from '../lib/settings';
import { heldPoint, trackStir } from '../lib/stir';
import { frameworkRadians } from '../lib/tiling';

import styles from './Kaleidoscope.module.css';

/**
 * How much one notch of wheel changes the zoom, as an exponent.
 *
 * Exponential rather than linear, so a notch is the same proportion of the zoom
 * wherever it starts — the way a pinch is.
 */
const WHEEL_ZOOM = 0.0015;

/**
 * How long the piece size has to hold still before the glass is recut to it.
 *
 * Long enough that a pinch in progress never pays for a scene build, short
 * enough that the pile reappears at its new size as the fingers lift.
 */
const RECUT_DELAY_MS = 250;

export interface KaleidoscopeHandle {
  /** Returns the current frame as a PNG data URL, or `null` before first paint. */
  capture: () => string | null;
  /**
   * Returns a PNG of one period of the field, which repeats without a seam.
   * `null` before the first paint, or if the surfaces cannot be made.
   */
  capturePattern: () => Promise<Blob | null>;
}

export interface KaleidoscopeProps {
  settings: Settings;
  /** Pauses the simulation. The last frame stays on screen. */
  paused?: boolean;
  /** Photo or camera element to mirror, when `settings.source` selects one. */
  media?: MediaElement | null;
  /**
   * The chosen object sets' pictures, which the pieces are cut out of and
   * shared across. Any not loaded yet are left out of the mix.
   */
  skins?: readonly MediaElement[] | null;
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
  skins = null,
  tiltRef,
  onZoom,
  ref,
}: KaleidoscopeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<KaleidoscopeRenderer | null>(null);
  // A pinch sizes what is being looked at, not the tube it is looked at
  // through: the mirror triangle has a slider of its own. Read when the pinch
  // starts, so it scales from wherever it has got to rather than from whatever
  // it was when this render ran.
  const zoomRef = useRef(settings.sourceScale);
  useEffect(() => {
    zoomRef.current = settings.sourceScale;
  }, [settings.sourceScale]);
  const gesture = useStageGesture({ zoom: () => zoomRef.current, onZoom });
  const [containerRef, size] = useElementSize<HTMLDivElement>();

  // The finger on the stage, for stirring a cell of substance. The gesture
  // hook owns turning and panning; this only watches where the finger is, and
  // the frame loop folds that point into the cell — so a drag turns the tube
  // *and* stirs the fluid it is turning, which is what a finger in a real
  // cell would do.
  const stagePointerRef = useRef<{ x: number; y: number } | null>(null);
  const stirTrackerRef = useRef<{ last: { x: number; y: number } | null }>({ last: null });

  // The instrument's sound, built only while the switch is on — the switch is
  // the user gesture browsers demand before audio may start — and torn down
  // the moment it is off, so no context lingers making silence.
  const chimeRef = useRef<Chime | null>(null);
  const heardRef = useRef<{ velocities: Float32Array }>({ velocities: new Float32Array(0) });
  const impactsRef = useRef<Impact[]>([]);
  useEffect(() => {
    if (!settings.sound) {
      return;
    }

    chimeRef.current = createChime();

    return () => {
      chimeRef.current?.dispose();
      chimeRef.current = null;
    };
  }, [settings.sound]);

  // A new seed, count or piece size means a genuinely different scene; anything
  // else is applied to the running simulation without resetting it. Size counts
  // because it is geometry: bigger pieces displace their neighbours and settle
  // into a different pile, which cannot be done by scaling what is already
  // there.
  //
  // What the glass is suspended in. Six numbers, rebuilt whenever the slider
  // moves; the running simulation takes the new one on the very next frame, so
  // the fluid thickens under a pile that is already drifting.
  const liquid = settings.source === 'liquid';
  const medium = useMemo(
    () => (liquid ? liquidCell(settings.thickness) : AIR),
    [liquid, settings.thickness],
  );

  // How the glass is cut, which waits for the hand to stop. Building a scene
  // settles the pile, which takes an appreciable slice of a second at a full
  // chamber — and a pinch changes the size on every pointer move, so rebuilding
  // on each one froze the whole app mid-gesture, on every tab, whether or not
  // the chamber was even on screen. A photo and the camera read the live value;
  // only the glass is worth recutting, once, when the hand has come to rest.
  // The variety waits the same way and for the same reason: both of them say
  // what size each piece is cut to, which is geometry and not drawing.
  //
  // The fluid in here is the *kind* of cell and not the thickness — one of two
  // fixed objects, compared by identity — because what a fresh cell is settled
  // against is a dry cell or a wet one, and nothing finer. See FRESH_LIQUID.
  const fill = liquid ? FRESH_LIQUID : AIR;
  const wanted: SceneCut = {
    scale: settings.sourceScale,
    variety: settings.variety,
    medium: fill,
    holds: liquid ? 'substance' : 'glass',
    substance: settings.substance,
    amount: settings.amount,
  };
  const [cut, setCut] = useState<SceneCut>(wanted);
  useEffect(() => {
    const settled =
      cut.scale === wanted.scale &&
      cut.variety === wanted.variety &&
      cut.medium === wanted.medium &&
      cut.holds === wanted.holds &&
      cut.substance === wanted.substance &&
      cut.amount === wanted.amount;

    if (settled) {
      return;
    }

    // Switching tabs or substances is not a drag and does not wait: it should
    // hand back the other instrument at once. Only the sliders are held back,
    // because a hand on one of those asks for a rebuild on every pointer move.
    const dragged =
      cut.holds === wanted.holds &&
      cut.medium === wanted.medium &&
      cut.substance === wanted.substance;
    const timer = window.setTimeout(
      () => {
        setCut(wanted);
      },
      dragged ? RECUT_DELAY_MS : 0,
    );

    return () => {
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `wanted` is a
    // fresh object every render; its fields are the dependencies.
  }, [
    cut,
    wanted.scale,
    wanted.variety,
    wanted.medium,
    wanted.holds,
    wanted.substance,
    wanted.amount,
  ]);

  const scene = useMemo(
    () => createScene(settings.seed, settings.shards, cut),
    [settings.seed, settings.shards, cut],
  );

  useImperativeHandle(
    ref,
    () => ({
      capture: () => rendererRef.current?.toDataUrl() ?? null,
      // The tile is a period of the figure, so its size is the geometry's to
      // decide rather than the settings'.
      capturePattern: async () => (await rendererRef.current?.toPatternBlob()) ?? null,
    }),
    [],
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
    renderer.render(scene, settings, media, skins);
  }, [size.width, size.height, scene, settings, media, skins]);

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

      // A finger on a cell of substance stirs it. The point is folded fresh
      // every frame, and tracked in the framework's frame rather than the
      // cell's: the cell turns under a held finger, and a finger that has not
      // moved has not stirred anything. See `lib/stir.ts`.
      let stir = null;

      if (liquid && stagePointerRef.current && gesture.mode === 'turn') {
        const held = heldPoint(stagePointerRef.current, {
          width: size.width,
          height: size.height,
          zoom: settings.zoom,
          angleDegrees: settings.angle,
          cell: scene.cell,
          drag: scene.drag,
        });

        stir = trackStir(stirTrackerRef.current, held, scene.cell, deltaSeconds);
      } else {
        stirTrackerRef.current.last = null;
      }

      updateScene(scene, {
        dt: paused ? 0 : deltaSeconds,
        turn: gesture.turnRef.current,
        drag: gesture.panRef.current,
        tilt: tiltRef?.current ?? 0,
        medium,
        stir,
        // The one thing a cell of substance takes live: how much its fluid
        // resists whatever is moving through it. Which substance and how much
        // of it are geometry, and wait with the rest of the cut.
        thickness: settings.thickness,
        // The cell is drawn inside the framework, so the framework's angle has
        // to come off gravity's or the pile would lean with the instrument.
        // Derived by the same function the renderer uses, upright offset and
        // all — computed separately the pile leans by the difference.
        framework: frameworkRadians(settings.angle),
      });
      // What the frame sounded like: the glass's collisions, read off the
      // solver's own velocity changes, and the fluid's swirl as a wash.
      const chime = chimeRef.current;

      if (chime && !paused) {
        readImpacts(scene.shards, heardRef.current, impactsRef.current);

        for (const impact of impactsRef.current) {
          chime.clink(impact.strength, impact.size);
        }

        chime.wash(
          scene.substance ? Math.min(1, Math.abs(scene.flow - gesture.turnRef.current) / 2) : 0,
        );
      }

      renderer.render(scene, settings, media, skins);
    },
    !paused || gesture.mode !== null || tiltRef !== undefined,
  );

  return (
    <div
      ref={containerRef}
      className={cx(styles.stage, gesture.mode === 'pan' && styles.panning)}
      {...gesture.handlers}
      onPointerDownCapture={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect();

        stagePointerRef.current = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
        stirTrackerRef.current.last = null;
      }}
      onPointerMoveCapture={(event) => {
        if (stagePointerRef.current) {
          const bounds = event.currentTarget.getBoundingClientRect();

          stagePointerRef.current = {
            x: event.clientX - bounds.left,
            y: event.clientY - bounds.top,
          };
        }
      }}
      onPointerUpCapture={() => {
        stagePointerRef.current = null;
        stirTrackerRef.current.last = null;
      }}
      onPointerCancelCapture={() => {
        stagePointerRef.current = null;
        stirTrackerRef.current.last = null;
      }}
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

/** What a cell of liquid is holding, for a screen reader. */
const SUBSTANCE_NAMES: Record<SubstanceId, string> = {
  lava: 'a lava lamp',
  drops: 'a liquid timer, draining bead by bead',
  smoke: 'smoke',
  glitter: 'glitter',
  ink: 'watercolour in water',
  film: 'an oil film',
};

function describe({ source, seed, substance }: Settings): string {
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
    case 'liquid':
      return `${assembly}, a cell of ${SUBSTANCE_NAMES[substance]}, seed ${seed}`;
  }
}
