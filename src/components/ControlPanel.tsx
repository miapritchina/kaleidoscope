import { useState } from 'react';

import type { CameraStatus } from '../hooks/useCamera';
import { PALETTES } from '../lib/palettes';
import { LIMITS, type Settings, type SourceId } from '../lib/settings';

import { FileField } from './controls/FileField';
import { RangeField } from './controls/RangeField';
import { SelectField } from './controls/SelectField';
import { TextField } from './controls/TextField';
import { ToggleField } from './controls/ToggleField';
import styles from './ControlPanel.module.css';

export interface ControlPanelProps {
  settings: Settings;
  onChange: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  onRandomize: () => void;
  onReset: () => void;
  onSave: () => void;
  onShare: () => void;
  /** Feedback for the most recent action, announced politely. */
  status?: string;
  /** Name of the chosen photo, if any. */
  imageName?: string | null;
  imageError?: string | null;
  onSelectImage: (file: File) => void;
  onClearImage: () => void;
  cameraStatus: CameraStatus;
  cameraMessage?: string | null;
}

const PALETTE_OPTIONS = PALETTES.map((palette) => ({
  value: palette.id,
  label: palette.name,
}));

const SOURCE_OPTIONS: { value: SourceId; label: string }[] = [
  { value: 'shards', label: 'Shards' },
  { value: 'image', label: 'Photo' },
  { value: 'camera', label: 'Camera' },
];

const CAMERA_HINTS: Record<CameraStatus, string> = {
  idle: 'The camera is off.',
  starting: 'Waiting for camera permission…',
  active: 'Live. Nothing is uploaded — frames stay in this browser.',
  denied: 'Camera access was blocked.',
  unavailable: 'No camera available.',
  error: 'The camera could not be started.',
};

export function ControlPanel({
  settings,
  onChange,
  onRandomize,
  onReset,
  onSave,
  onShare,
  status,
  imageName,
  imageError,
  onSelectImage,
  onClearImage,
  cameraStatus,
  cameraMessage,
}: ControlPanelProps) {
  // The seed input keeps its own draft so the field can be emptied while typing
  // without the sanitiser snapping it back mid-keystroke. When the seed changes
  // from the outside (Randomize, Reset) the draft is re-synced during render.
  const [seedDraft, setSeedDraft] = useState(settings.seed);
  const [lastSeed, setLastSeed] = useState(settings.seed);

  if (lastSeed !== settings.seed) {
    setLastSeed(settings.seed);
    setSeedDraft(settings.seed);
  }

  return (
    <form
      className={styles.panel}
      onSubmit={(event) => {
        event.preventDefault();
      }}
    >
      <fieldset className={styles.group}>
        <legend className={styles.legend}>Source</legend>

        <SelectField
          label="Input"
          value={settings.source}
          options={SOURCE_OPTIONS}
          onChange={(value) => {
            onChange('source', value);
          }}
        />

        {settings.source === 'image' && (
          <>
            <FileField
              label="Photo"
              accept="image/*"
              fileName={imageName}
              buttonLabel={imageName ? 'Replace photo' : 'Choose photo'}
              onSelect={onSelectImage}
            />
            <p className={styles.hint}>
              Or drop a photo onto the artwork. It stays in this browser — nothing is uploaded.
            </p>
            {imageName ? (
              <button type="button" className={styles.ghost} onClick={onClearImage}>
                Remove photo
              </button>
            ) : null}
            {imageError ? (
              <p className={styles.error} role="alert">
                {imageError}
              </p>
            ) : null}
          </>
        )}

        {settings.source === 'camera' && (
          <p className={cameraStatus === 'active' ? styles.hint : styles.error} role="status">
            {cameraMessage ?? CAMERA_HINTS[cameraStatus]}
          </p>
        )}
      </fieldset>

      <fieldset className={styles.group}>
        <legend className={styles.legend}>Assembly</legend>

        <p className={styles.hint}>
          A triangular tube of three mirrors. Six triangles meet at every corner to make a hexagon,
          and those hexagons repeat across the field — which is what a real one does. Swipe across
          the artwork to turn it.
        </p>

        <RangeField
          label="Zoom"
          value={settings.zoom}
          limit={LIMITS.zoom}
          format={(value) => `${value.toFixed(2)}x`}
          onChange={(value) => {
            onChange('zoom', value);
          }}
          {...(settings.source === 'shards'
            ? {}
            : { description: 'A photo cannot zoom below 1x without exposing its edges.' })}
        />
        <RangeField
          label="Trails"
          value={settings.trails}
          limit={LIMITS.trails}
          format={(value) => `${String(Math.round(value * 100))}%`}
          onChange={(value) => {
            onChange('trails', value);
          }}
          description="How long each frame lingers."
        />
      </fieldset>

      {settings.source === 'shards' && (
        <fieldset className={styles.group}>
          <legend className={styles.legend}>Shards</legend>

          <RangeField
            label="Count"
            value={settings.shards}
            limit={LIMITS.shards}
            onChange={(value) => {
              onChange('shards', value);
            }}
          />
          <RangeField
            label="Chip size"
            value={settings.chipSize}
            limit={LIMITS.chipSize}
            format={(value) => `${value.toFixed(2)}x`}
            onChange={(value) => {
              onChange('chipSize', value);
            }}
            description="How big each piece of glass is, without changing how many there are."
          />
          <SelectField
            label="Palette"
            value={settings.paletteId}
            options={PALETTE_OPTIONS}
            onChange={(value) => {
              onChange('paletteId', value);
            }}
          />
          <ToggleField
            label="Glow"
            checked={settings.glow}
            onChange={(checked) => {
              onChange('glow', checked);
            }}
          />
          <TextField
            label="Seed"
            value={seedDraft}
            maxLength={32}
            placeholder="kaleido"
            onChange={(value) => {
              setSeedDraft(value);
              onChange('seed', value);
            }}
          />
        </fieldset>
      )}

      <div className={styles.actions}>
        {settings.source === 'shards' && (
          <button type="button" className={styles.primary} onClick={onRandomize}>
            Randomize
          </button>
        )}
        <button type="button" className={styles.secondary} onClick={onSave}>
          Save PNG
        </button>
        <button type="button" className={styles.secondary} onClick={onShare}>
          Copy link
        </button>
        <button type="button" className={styles.ghost} onClick={onReset}>
          Reset
        </button>
      </div>

      <p className={styles.status} role="status">
        {status}
      </p>
    </form>
  );
}
