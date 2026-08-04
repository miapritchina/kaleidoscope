import { useCallback, useRef, useState } from 'react';

import styles from './App.module.css';
import { ControlPanel } from './components/ControlPanel';
import { Kaleidoscope, type KaleidoscopeHandle } from './components/Kaleidoscope';
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
    link.download = `kaleidoscope-${settings.seed}.png`;
    link.click();
    announce('Saved a PNG of the current frame.');
  }, [announce, settings.seed]);

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
      <main className={styles.stage}>
        <Kaleidoscope ref={kaleidoscopeRef} settings={settings} paused={!isPlaying} />
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
            A mirrored canvas toy. Move the pointer over the artwork to nudge the shards.
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
