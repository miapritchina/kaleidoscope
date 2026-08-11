import { useCallback, useRef, useState } from 'react';

import styles from './App.module.css';
import { ControlPanel } from './components/ControlPanel';
import { Kaleidoscope, type KaleidoscopeHandle } from './components/Kaleidoscope';
import { useCamera } from './hooks/useCamera';
import { useImageSource } from './hooks/useImageSource';
import { usePrefersReducedMotion } from './hooks/useMediaQuery';
import { useSettings } from './hooks/useSettings';
import { resolvePlayback } from './lib/playback';
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

  const { isPlaying } = resolvePlayback({
    source: settings.source,
    skin: settings.skin,
    prefersReducedMotion,
    override: playOverride,
  });

  const image = useImageSource();
  // The video element lives here so it can sit in the document — Safari will
  // not play a detached one — while the hook owns the stream bound to it.
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  // Requesting the camera is a permission prompt, so it only happens while
  // something actually wants the frames: either the mirrors repeat them, or the
  // pieces in the chamber are skinned with them.
  const wantsCamera = settings.source === 'camera' || settings.skin === 'camera';
  const camera = useCamera(wantsCamera, video, settings.cameraFacing);

  const media =
    settings.source === 'image' ? image.image : settings.source === 'camera' ? video : null;
  const skin = settings.skin === 'photo' ? image.image : settings.skin === 'camera' ? video : null;

  const wantsPhoto = settings.source === 'image' || settings.skin === 'photo';

  const emptyState =
    wantsPhoto && !image.image
      ? settings.source === 'image'
        ? 'Choose or drop a photo to mirror it.'
        : 'Choose or drop a photo to skin the pieces with it.'
      : wantsCamera && camera.status !== 'active'
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

          // A photo dropped while the pieces are being skinned with one is
          // meant for them, so the mirrors are left alone.
          if (settings.skin !== 'photo') {
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
        />

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
            A mirrored canvas toy. Feed it shards, a photo, or your camera, then swipe across the
            artwork to turn the tube.
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

        {prefersReducedMotion && playOverride === null && (
          <p className={styles.notice}>
            {isPlaying
              ? 'Your system asks for reduced motion. The camera feed is live; swiping still turns the tube.'
              : 'Motion is paused because your system asks for reduced motion. Swiping still turns the tube; press Play to animate.'}
          </p>
        )}
      </aside>
    </div>
  );
}
