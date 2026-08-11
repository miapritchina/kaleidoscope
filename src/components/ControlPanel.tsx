import { useState } from 'react';

import type { CameraStatus } from '../hooks/useCamera';
import { CAMERA_FACINGS, type CameraFacing } from '../lib/camera';
import { CUSTOM, OBJECT_SETS } from '../lib/objectSets';
import { LIMITS, type Settings, type SourceId } from '../lib/settings';

import { FileField } from './controls/FileField';
import { RangeField } from './controls/RangeField';
import { SelectField } from './controls/SelectField';
import { TextField } from './controls/TextField';
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

const SOURCE_OPTIONS: { value: SourceId; label: string }[] = [
  { value: 'shards', label: 'Objects' },
  { value: 'image', label: 'Photo' },
  { value: 'camera', label: 'Camera' },
];

const OBJECT_OPTIONS = OBJECT_SETS.map((set) => ({ value: set.id, label: set.name }));

const CAMERA_LABELS: Record<CameraFacing, string> = {
  environment: 'Back',
  user: 'Front',
};

const CAMERA_OPTIONS = CAMERA_FACINGS.map((facing) => ({
  value: facing,
  label: CAMERA_LABELS[facing],
}));

/**
 * Pointing it at the world is a kaleidoscope with an open end — a teleidoscope,
 * which has a lens or a glass ball where this one has a chamber of objects.
 */
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

        {settings.source === 'shards' && (
          <>
            <SelectField
              label="Objects"
              value={settings.objects}
              options={OBJECT_OPTIONS}
              onChange={(value) => {
                onChange('objects', value);
              }}
              description="What the chamber is loaded with. The pieces are the things in the picture, cut out one per object."
            />
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
              description="How big each piece is. Bigger pieces crowd each other, so the pile settles differently."
            />
          </>
        )}

        {/* One photo, wanted either to mirror or to cut the pieces out of. */}
        {(settings.source === 'image' || settings.objects === CUSTOM) && (
          <>
            <FileField
              label="Photo"
              accept="image/*"
              fileName={imageName}
              buttonLabel={imageName ? 'Replace photo' : 'Choose photo'}
              onSelect={onSelectImage}
            />
            <p className={styles.hint}>
              {settings.objects === CUSTOM
                ? 'A PNG of a few objects on a transparent background. It stays in this browser — nothing is uploaded.'
                : 'Or drop a photo onto the artwork. It stays in this browser — nothing is uploaded.'}
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
          <>
            <SelectField
              label="Camera"
              value={settings.cameraFacing}
              options={CAMERA_OPTIONS}
              onChange={(value) => {
                onChange('cameraFacing', value);
              }}
            />
            <p className={cameraStatus === 'active' ? styles.hint : styles.error} role="status">
              {cameraMessage ?? CAMERA_HINTS[cameraStatus]}
            </p>
          </>
        )}

        {settings.source === 'shards' && (
          <>
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
          </>
        )}
      </fieldset>

      <fieldset className={styles.group}>
        <legend className={styles.legend}>Assembly</legend>

        <p className={styles.hint}>
          A triangular tube of three mirrors. Six triangles meet at every corner to make a hexagon,
          and those hexagons repeat across the field — which is what a real one does.
        </p>
        <p className={styles.hint}>
          Swipe across the artwork to turn it. Pinch, or scroll, to zoom; drag with two fingers to
          move the source.
        </p>
      </fieldset>

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

      {/* Shown, but not announced: the app owns a live region of its own, so
          that a message still reaches a viewer with this panel closed. */}
      <p className={styles.status} aria-hidden="true">
        {status}
      </p>
    </form>
  );
}
