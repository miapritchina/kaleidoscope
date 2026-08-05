import { useCallback, useRef, useState } from 'react';

import styles from './App.module.css';
import { ControlPanel } from './components/ControlPanel';
import { Kaleidoscope, type KaleidoscopeHandle } from './components/Kaleidoscope';
import { useCamera } from './hooks/useCamera';
import { useImageSource } from './hooks/useImageSource';
import { usePrefersReducedMotion } from './hooks/useMediaQuery';
import { useSettings } from './hooks/useSettings';
import { settingsToSearchParams } from './lib/settings';

export function App() {
  const { settings, set, randomize, reset } = useSettings();
  const prefersReducedMotion = usePrefersReducedMotion();
  const [status, setStatus] = useState('');
  const kaleidoscopeRef = useRef<KaleidoscopeHandle>(null);

  // `null` means "follow the system preference"; pressing Play or Pause pins an
  // explicit choice.
  const [playOverride, setPlayOverride] = useState<boolean | null>(null);
  const [lastPreference, setLastPreference] = useState(prefersReducedMotion);

  // Changing the OS preference mid-session hands control back to it, so turning
  // on "reduce motion" never leaves a canvas spinning. Adjusting state during
  // render (rather than in an effect) avoids a throwaway animated frame.
  if (lastPreference !== prefersReducedMotion) {
    setLastPreference(prefersReducedMotion);
    setPlayOverride(null);
  }

  const isPlaying = playOverride ?? !prefersReducedMotion;

  const image = useImageSource();
  // The video element lives here so it can sit in the document — Safari will
  // not play a detached one — while the hook owns the stream bound to it.
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  // Requesting the camera is a permission prompt, so it only happens while the
  // camera is actually the selected source.
  const camera = useCamera(settings.source === 'camera', video);

  const media = settings.source === 'image' ? image.image : video;

  const emptyState =
    settings.source === 'image' && !image.image
      ? 'Choose or drop a photo to mirror it.'
      : settings.source === 'camera' && camera.status !== 'active'
        ? (camera.message ?? 'Starting the camera…')
        : null;

  const announce = useCallback((message: string) => {
    setStatus(message);
  }, []);

  const handleSave = useCallback(() => {
    const dataUrl = kaleidoscopeRef.current?.capture();

    if (!dataUrl) {
      announce('Nothing to save yet.');
      return;
    }

    const link = document.createElement('a');
    link.href = dataUrl;
    // The seed names the pattern only when the shards are the pattern.
    link.download = `kaleidoscope-${settings.source === 'shards' ? settings.seed : settings.source}.png`;
    link.click();
    announce('Saved a PNG of the current frame.');
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
          set('source', 'image');
          announce(`Loaded ${file.name}.`);
        }}
      >
        <Kaleidoscope ref={kaleidoscopeRef} settings={settings} paused={!isPlaying} media={media} />

        {emptyState ? <p className={styles.emptyState}>{emptyState}</p> : null}

        {/* Hidden rather than absent: Safari refuses to play a video element
            that is not in the document, and display:none can pause playback. */}
        <video ref={setVideo} className={styles.hiddenVideo} muted playsInline aria-hidden="true" />

        <button
          type="button"
          className={styles.playToggle}
          aria-pressed={isPlaying}
          onClick={() => {
            setPlayOverride(!isPlaying);
          }}
        >
          {isPlaying ? 'Pause' : 'Play'}
        </button>
      </main>

      <aside className={styles.sidebar}>
        <header className={styles.header}>
          <h1 className={styles.title}>Kaleidoscope</h1>
          <p className={styles.subtitle}>
            A mirrored canvas toy. Feed it shards, a photo, or your camera, and move the pointer
            over the artwork to steer it.
          </p>
        </header>

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
        />

        {prefersReducedMotion && (
          <p className={styles.notice}>
            Motion is paused because your system asks for reduced motion. Press Play to animate
            anyway.
          </p>
        )}
      </aside>
    </div>
  );
}
