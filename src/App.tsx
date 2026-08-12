import { useCallback, useEffect, useRef, useState } from 'react';

import styles from './App.module.css';
import { ControlPanel } from './components/ControlPanel';
import { Kaleidoscope, type KaleidoscopeHandle } from './components/Kaleidoscope';
import { useCamera } from './hooks/useCamera';
import { useImageSource } from './hooks/useImageSource';
import { useImageUrl } from './hooks/useImageUrl';
import { useDeviceTilt } from './hooks/useDeviceTilt';
import { useDeviceReadings } from './hooks/useDeviceReadings';
import { useShake } from './hooks/useShake';
import { readoutLines } from './lib/readings';
import { usePrefersReducedMotion } from './hooks/useMediaQuery';
import { useSettings } from './hooks/useSettings';
import { CUSTOM, objectSetUrl } from './lib/objectSets';
import { sharePicture } from './lib/share';
import { resolvePlayback } from './lib/playback';
import { clampToLimit, LIMITS, settingsToSearchParams } from './lib/settings';

export function App() {
  const { settings, set, randomize, reset } = useSettings();
  const prefersReducedMotion = usePrefersReducedMotion();
  const [status, setStatus] = useState('');
  const kaleidoscopeRef = useRef<KaleidoscopeHandle>(null);

  // The artwork has the whole window; the controls are behind a button, and
  // start out of the way. Closed by default because the point of the thing is
  // the picture, not the panel.
  const [controlsOpen, setControlsOpen] = useState(false);
  const controlsRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  const { isPlaying } = resolvePlayback({ source: settings.source, prefersReducedMotion });

  const tilt = useDeviceTilt(settings.tilt);
  const readings = useDeviceReadings(settings.debug);
  const image = useImageSource();
  // The video element lives here so it can sit in the document — Safari will
  // not play a detached one — while the hook owns the stream bound to it.
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  // Requesting the camera is a permission prompt, so it only happens while the
  // camera is actually the selected source.
  const camera = useCamera(settings.source === 'camera', video, settings.cameraFacing);

  const media =
    settings.source === 'image' ? image.image : settings.source === 'camera' ? video : null;
  // The chosen set's picture, if it is one of the bundled ones.
  const preset = useImageUrl(settings.objects === CUSTOM ? null : objectSetUrl(settings.objects));

  // What the pieces are cut out of, which is a different question from what the
  // mirrors repeat: the objects can come out of one picture while the mirrors
  // go on repeating another.
  const skin = settings.objects === CUSTOM ? image.image : preset;

  // One picker, wanted by either. Whichever asks, the same photo answers.
  const wantsPhoto = settings.source === 'image' || settings.objects === CUSTOM;

  const emptyState =
    wantsPhoto && !image.image
      ? settings.source === 'image'
        ? 'Choose or drop a photo to mirror it.'
        : 'Choose or drop a PNG of objects on a transparent background.'
      : settings.source === 'camera' && camera.status !== 'active'
        ? (camera.message ?? 'Starting the camera…')
        : null;

  // Escape closes the panel wherever the focus is, which is what a viewer
  // reaches for when something has covered the thing they were looking at.
  useEffect(() => {
    if (!controlsOpen) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setControlsOpen(false);
        toggleRef.current?.focus();
      }
    };

    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [controlsOpen]);

  // Opening it moves the focus in, so a keyboard reaches the controls without
  // tabbing back through the artwork.
  useEffect(() => {
    if (controlsOpen) {
      const panel = controlsRef.current;

      if (panel) {
        // From the top, not from wherever it was left: a panel that opens
        // half-scrolled looks like it has rendered wrong.
        panel.scrollTop = 0;
        panel.focus();
      }
    }
  }, [controlsOpen]);

  const announce = useCallback((message: string) => {
    setStatus(message);
  }, []);

  const reshuffle = useCallback(() => {
    randomize();
    announce('A new arrangement of the pieces.');
  }, [announce, randomize]);

  // Shaking a kaleidoscope is what a hand does with one, and what it does to
  // the glass is not a tip or a turn — it throws the pile up and lets it come
  // down somewhere else entirely.
  useShake(reshuffle, tilt.status === 'active');

  const handleZoom = useCallback(
    (scale: number) => {
      set('sourceScale', clampToLimit(scale, LIMITS.sourceScale));
    },
    [set],
  );

  const handleSave = useCallback(() => {
    const dataUrl = kaleidoscopeRef.current?.capture();

    if (!dataUrl) {
      announce('Nothing to save yet.');
      return;
    }

    const link = document.createElement('a');
    link.href = dataUrl;
    // The seed names the pattern only when the shards are the pattern.
    link.download = `kaleidoscope-${settings.source === 'objects' ? settings.seed : settings.source}.png`;
    link.click();
    announce('Saved a PNG of the current frame.');
  }, [announce, settings.seed, settings.source]);

  const handleSavePattern = useCallback(() => {
    const name = `kaleidoscope-pattern-${settings.source === 'objects' ? settings.seed : settings.source}.png`;

    void (async () => {
      const blob = await kaleidoscopeRef.current?.capturePattern();

      if (!blob) {
        announce('Nothing to save yet.');
        return;
      }

      const outcome = await sharePicture(new File([blob], name, { type: blob.type }));

      // Dismissing the sheet is an answer, not an event worth narrating.
      if (outcome === 'dismissed') {
        return;
      }

      announce(
        outcome === 'failed'
          ? 'Could not save the pattern.'
          : 'One repeat of the pattern, which tiles without a seam.',
      );
    })();
  }, [announce, settings.seed, settings.source]);

  const handleShare = useCallback(() => {
    const url = new URL(window.location.href);
    url.search = settingsToSearchParams(settings).toString();

    void navigator.clipboard
      .writeText(url.toString())
      .then(() => {
        announce('Link copied to the clipboard.');
      })
      .catch(() => {
        announce(`Copy failed. Share this URL: ${url.toString()}`);
      });
  }, [announce, settings]);

  return (
    <div className={styles.layout}>
      {/* The visible heading lives in the drawer, which is not always on
          screen, so the document keeps one of its own. */}
      <h1 className={styles.pageTitle}>Kaleidoscope</h1>

      <main
        className={styles.stage}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes('Files')) {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
          }
        }}
        onDrop={(event) => {
          const file = event.dataTransfer.files[0];

          if (!file) {
            return;
          }

          event.preventDefault();
          image.select(file);

          // Dropped while the pieces are being cut out of a photo, it is meant
          // for them, so the mirrors are left on whatever they were repeating.
          if (settings.objects !== CUSTOM) {
            set('source', 'image');
          }

          announce(`Loaded ${file.name}.`);
        }}
      >
        <Kaleidoscope
          ref={kaleidoscopeRef}
          settings={settings}
          paused={!isPlaying}
          media={media}
          skin={skin}
          {...(settings.tilt ? { tiltRef: tilt.angleRef } : {})}
          onZoom={handleZoom}
        />

        {emptyState ? <p className={styles.emptyState}>{emptyState}</p> : null}

        {/* What the instrument is being told, next to what it has decided.
            The overlay on the canvas says where it thinks down is; this says
            what the sensors actually read, and the difference between the two
            is where a bug would be. */}
        {settings.debug && (
          <pre className={styles.readout} aria-label="Device readings">
            {readoutLines(readings, settings.tilt ? (tilt.angleRef.current ?? 0) : null).join('\n')}
          </pre>
        )}

        {/* Hidden rather than absent: Safari refuses to play a video element
            that is not in the document, and display:none can pause playback. */}
        <video ref={setVideo} className={styles.hiddenVideo} muted playsInline aria-hidden="true" />
      </main>

      {/* The three things worth reaching without opening anything. Named for a
          screen reader and drawn for everyone else: a word beside each would be
          three labels laid over the artwork, and the artwork is the point. */}
      <div className={styles.toolbar}>
        <button
          type="button"
          className={styles.tool}
          aria-label="Save pattern"
          onClick={handleSavePattern}
        >
          <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 3v10.2l3.6-3.6 1.4 1.4-6 6-6-6 1.4-1.4 3.6 3.6V3h2Z" />
            <path d="M4 19h16v2H4z" />
          </svg>
        </button>

        <button
          type="button"
          className={styles.tool}
          aria-label="New arrangement"
          onClick={reshuffle}
        >
          <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 5V2L8 6l4 4V7a5 5 0 0 1 4.6 7l1.5 1.5A7 7 0 0 0 12 5Z" />
            <path d="M12 17v3l4-4-4-4v3a5 5 0 0 1-4.6-7L5.9 8.5A7 7 0 0 0 12 19Z" />
          </svg>
        </button>

        <button
          ref={toggleRef}
          type="button"
          className={styles.tool}
          aria-label="Controls"
          aria-expanded={controlsOpen}
          aria-controls="controls"
          onClick={() => {
            setControlsOpen((open) => !open);
          }}
        >
          <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0 6.2a2.2 2.2 0 1 1 0-4.4 2.2 2.2 0 0 1 0 4.4Z" />
            <path d="m21 13.6-.1-1.6.1-1.6-2.1-.5a7 7 0 0 0-.7-1.7l1.1-1.8-2.3-2.3-1.8 1.1a7 7 0 0 0-1.7-.7L13 2.7h-2l-.5 2.1a7 7 0 0 0-1.7.7L7 4.4 4.7 6.7l1.1 1.8a7 7 0 0 0-.7 1.7l-2.1.5.1 1.6-.1 1.6 2.1.5c.16.6.4 1.17.7 1.7l-1.1 1.8 2.3 2.3 1.8-1.1c.53.3 1.1.54 1.7.7l.5 2.1h2l.5-2.1a7 7 0 0 0 1.7-.7l1.8 1.1 2.3-2.3-1.1-1.8c.3-.53.54-1.1.7-1.7l2.1-.5Z" />
          </svg>
        </button>
      </div>

      {/* Announcements reach a viewer whether or not the panel is on screen,
          so this lives out here rather than inside it. */}
      <p className={styles.liveRegion} role="status">
        {status}
      </p>

      {controlsOpen && (
        <aside id="controls" ref={controlsRef} tabIndex={-1} className={styles.drawer}>
          <div className={styles.drawerHeader}>
            <h2 className={styles.title}>Controls</h2>
            <button
              type="button"
              className={styles.close}
              onClick={() => {
                setControlsOpen(false);
                toggleRef.current?.focus();
              }}
            >
              Close
            </button>
          </div>

          <p className={styles.subtitle}>
            Three mirrors and a chamber of objects. Swipe the artwork to turn it.
          </p>

          <ControlPanel
            settings={settings}
            onChange={set}
            onRandomize={randomize}
            onReset={reset}
            onSave={handleSave}
            onShare={handleShare}
            status={status}
            imageName={image.fileName}
            imageError={image.error}
            onSelectImage={image.select}
            onClearImage={image.clear}
            cameraStatus={camera.status}
            cameraMessage={camera.message}
            tiltStatus={tilt.status}
          />

          {prefersReducedMotion && (
            <p className={styles.notice}>
              {isPlaying
                ? 'Your system asks for reduced motion. The camera feed is live; swiping still turns the tube.'
                : 'Motion is held still because your system asks for reduced motion. Swiping still turns the tube.'}
            </p>
          )}
        </aside>
      )}
    </div>
  );
}
