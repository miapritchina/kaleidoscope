import { useState } from 'react';

import type { CameraStatus } from '../hooks/useCamera';
import type { TiltStatus } from '../hooks/useDeviceTilt';
import { CAMERA_FACINGS, type CameraFacing } from '../lib/camera';
import { CUSTOM, OBJECT_SETS } from '../lib/objectSets';
import { isSourceId, LIMITS, type Settings } from '../lib/settings';

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
  tiltStatus: TiltStatus;
}

/**
 * What the mirrors are pointed at — one list, not two.
 *
 * Two controls, one of which decided whether the other was even rendered, meant
 * the object sets could disappear from the panel entirely: leave the input on
 * Photo and there was nowhere left to choose a set, and nothing to say why. A
 * chamber of objects, a flat photograph and the live camera are three answers
 * to the same question, so they are asked as one.
 *
 * The values are prefixed because a set's id comes from a filename, and a file
 * called `camera.webp` would otherwise collide with the camera.
 */
const SOURCE_OPTIONS = [
  ...OBJECT_SETS.map((set) => ({ value: `set:${set.id}`, label: set.name })),
  { value: 'mirror:image', label: 'Mirror a photo' },
  { value: 'mirror:camera', label: 'Camera (teleidoscope)' },
];

/** The one option that stands for the current settings. */
function currentSource(settings: Settings): string {
  return settings.source === 'objects' ? `set:${settings.objects}` : `mirror:${settings.source}`;
}

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
const TILT_HINTS: Record<TiltStatus, string> = {
  unsupported: 'This device cannot tell which way up it is.',
  idle: 'Tip the phone and the pieces slide. The mirrors stay put.',
  asking: 'Waiting for permission…',
  active: 'On. The pieces fall towards whatever is lowest.',
  denied: 'Motion access is blocked. Allow it in your browser settings.',
};

const CAMERA_HINTS: Record<CameraStatus, string> = {
  idle: 'The camera is off.',
  starting: 'Waiting for permission…',
  active: 'Live. Frames stay in this browser.',
  denied: 'Camera access is blocked.',
  unavailable: 'No camera available.',
  error: 'The camera could not start.',
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
  tiltStatus,
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
        <legend className={styles.legend}>Contents</legend>

        <SelectField
          label="Source"
          value={currentSource(settings)}
          options={SOURCE_OPTIONS}
          onChange={(value) => {
            const [kind, name = ''] = value.split(':');

            if (kind === 'set') {
              onChange('source', 'objects');
              onChange('objects', name);
            } else if (isSourceId(name)) {
              onChange('source', name);
            }
          }}
        />

        {settings.source === 'objects' && (
          <RangeField
            label="Pieces"
            value={settings.shards}
            limit={LIMITS.shards}
            onChange={(value) => {
              onChange('shards', value);
            }}
          />
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
                ? 'A PNG of a few objects on a transparent background.'
                : 'Or drop one onto the artwork.'}
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

        {settings.source === 'objects' && (
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
        <legend className={styles.legend}>Mirrors</legend>

        <RangeField
          label="Mirror size"
          value={settings.zoom}
          limit={LIMITS.zoom}
          format={(value) => `${value.toFixed(2)}x`}
          onChange={(value) => {
            onChange('zoom', value);
          }}
        />

        <RangeField
          label="Mirror angle"
          value={settings.angle}
          limit={LIMITS.angle}
          format={(value) => `${String(value)}°`}
          onChange={(value) => {
            onChange('angle', value);
          }}
        />

        <p className={styles.hint}>
          Which way up you hold the tube. A third of a turn brings it back.
        </p>

        <p className={styles.hint}>
          Swipe to turn. Pinch or scroll to size the pieces; drag two fingers to move them.
        </p>

        {/* The state is the description rather than a line of its own: one
            control, one thing said about it, and nothing announcing itself from
            inside a panel that is usually off screen. */}
        <ToggleField
          label="Real gravity"
          checked={settings.tilt}
          onChange={(checked) => {
            onChange('tilt', checked);
          }}
          description={TILT_HINTS[tiltStatus]}
        />

        <ToggleField
          label="Show the mirrors"
          checked={settings.debug}
          onChange={(checked) => {
            onChange('debug', checked);
          }}
          description="Outlines the triangle everything is reflected from, and points at gravity."
        />
      </fieldset>

      <div className={styles.actions}>
        {settings.source === 'objects' && (
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
