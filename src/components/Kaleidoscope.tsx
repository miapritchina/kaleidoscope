import { useEffect, useImperativeHandle, useMemo, useRef, useState, type RefObject } from 'react';

import { useAnimationFrame } from '../hooks/useAnimationFrame';
import { useElementSize } from '../hooks/useElementSize';
import { useStageGesture } from '../hooks/useStageGesture';
import { KaleidoscopeBody } from '../lib/body';
import type { Chamber } from '../lib/chamber';
import {
  chamberCut,
  createChamber,
  isSameInstrument,
  sameCut,
  type ChamberCut,
} from '../lib/chambers';
import { createChime, type Chime } from '../lib/chime';
import { cx } from '../lib/cx';
import type { MediaElement } from '../lib/media';
import type { Settings, SubstanceId } from '../lib/settings';
import { trackStir } from '../lib/stir';

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
 * The canvas surface: a body, a chamber, and a frame loop that turns one.
 *
 * Everything that changes per frame — the body, the chamber, the pointer —
 * lives in refs. React owns the settings; the animation loop owns the pixels.
 * Re-rendering this component never restarts the animation.
 *
 * Notice how little of this file knows what is in the chamber. One `useMemo`
 * builds one, and after that it is a thing with an `update` and a `paint`. A
 * chamber that showed a video would not add a line here.
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
  const bodyRef = useRef<KaleidoscopeBody | null>(null);
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

  // Every input the chamber reads live rather than being rebuilt for, in one
  // box behind one ref, so that a new photograph, a loaded object set or a
  // moved slider costs nothing. A chamber outlives all of them, and holding
  // them together is what lets it be built from `cut` alone.
  //
  // A plain box rather than a ref, deliberately: a ref is for something React
  // is expected to leave alone between renders, and this is a letterbox the
  // frame loop reads out of. Kept stable by the state initialiser and written
  // to in an effect, so nothing is mutated while rendering.
  const [live] = useState(() => ({ settings, media, skins, tiltRef }));
  useEffect(() => {
    Object.assign(live, { settings, media, skins, tiltRef });
  }, [live, settings, media, skins, tiltRef]);

  // A new seed, count, substance or piece size means a genuinely different
  // chamber; anything else is applied to the running one without resetting it.
  // Size counts because it is geometry: bigger pieces displace their
  // neighbours and settle into a different pile, which cannot be done by
  // scaling what is already there.
  //
  // Rebuilding waits for the hand to stop. Building a chamber settles a pile
  // of a hundred and fifty pieces, which takes an appreciable slice of a
  // second — and a pinch changes the size on every pointer move, so rebuilding
  // on each one froze the whole app mid-gesture, on every tab, whether or not
  // the glass was even on screen.
  const wanted = chamberCut(settings);
  const [cut, setCut] = useState<ChamberCut>(wanted);
  useEffect(() => {
    if (sameCut(cut, wanted)) {
      return;
    }

    // Switching tabs or substances is not a drag and does not wait: it should
    // hand back the other instrument at once. Only the sliders are held back,
    // because a hand on one of those asks for a rebuild on every pointer move.
    const timer = window.setTimeout(
      () => {
        setCut(wanted);
      },
      isSameInstrument(cut, wanted) ? RECUT_DELAY_MS : 0,
    );

    return () => {
      window.clearTimeout(timer);
    };
    // `wanted` is a fresh object every render; its fields are the dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    cut,
    wanted.source,
    wanted.seed,
    wanted.shards,
    wanted.scale,
    wanted.variety,
    wanted.substance,
    wanted.amount,
  ]);

  // Whatever is in the far end of the tube. The one line in this component
  // that knows there is more than one kind — and it does not know which.
  const chamber: Chamber = useMemo(
    () =>
      createChamber(cut, {
        settings: () => live.settings,
        media: () => live.media,
        skins: () => live.skins ?? [],
        tilt: () => live.tiltRef?.current ?? 0,
      }),
    [cut, live],
  );

  useImperativeHandle(
    ref,
    () => ({
      capture: () => bodyRef.current?.toDataUrl() ?? null,
      // The tile is a period of the figure, so its size is the geometry's to
      // decide rather than the settings'.
      capturePattern: async () => (await bodyRef.current?.toPatternBlob()) ?? null,
    }),
    [],
  );

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    try {
      bodyRef.current = new KaleidoscopeBody(canvas);
    } catch (error) {
      console.error('Unable to start the kaleidoscope body', error);
      bodyRef.current = null;
    }

    return () => {
      bodyRef.current = null;
    };
  }, []);

  useEffect(() => {
    const body = bodyRef.current;

    if (!body || size.width === 0 || size.height === 0) {
      return;
    }

    body.resize(size.width, size.height, window.devicePixelRatio);
    // Repaint on any of these even while paused, so a newly picked photo or a
    // changed setting shows up without needing the animation to be running.
    body.render(chamber, settings);
  }, [size.width, size.height, chamber, settings, media, skins]);

  useAnimationFrame(
    (deltaSeconds) => {
      const body = bodyRef.current;

      if (!body) {
        return;
      }

      // Paused freezes the simulation, not the interaction: a zero step still
      // takes the new drag position and repaints, so the contents can be moved
      // around while the animation is stopped. A finger held still fires no
      // move events, so the rate has to be expired here rather than waiting
      // for one — and a flick coasts down here too.
      gesture.settle(deltaSeconds);

      // A finger on the figure stirs whatever is in the chamber. The point is
      // folded fresh every frame, and tracked in the body's frame rather than
      // the chamber's: the chamber turns under a held finger, and a finger
      // that has not moved has not stirred anything. The body does the
      // folding — it owns the mirrors that make it necessary — and hands over
      // its bearing so the reading can be carried across at the end. See
      // `lib/stir.ts`.
      let touch = null;

      if (stagePointerRef.current && gesture.mode === 'turn') {
        const held = body.probe(stagePointerRef.current, settings);

        touch = trackStir(stirTrackerRef.current, held, body.bearing, deltaSeconds);
      } else {
        stirTrackerRef.current.last = null;
      }

      body.step(chamber, {
        dt: paused ? 0 : deltaSeconds,
        turn: gesture.turnRef.current,
        drag: gesture.panRef.current,
        tilt: tiltRef?.current ?? 0,
        angle: settings.angle,
        touch,
      });

      // What the frame sounded like, asked of the chamber rather than read out
      // of it: only the chamber knows whether it holds anything that can knock.
      const chime = chimeRef.current;

      if (chime && !paused) {
        const sound = chamber.listen?.() ?? { impacts: [], wash: 0 };

        for (const impact of sound.impacts) {
          chime.clink(impact.strength, impact.size);
        }

        chime.wash(sound.wash);
      }

      body.render(chamber, settings);
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
