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
  unsupported: 'This device does not report which way up it is, so the tube turns by swiping.',
  idle: 'Hold the phone like the instrument it is: turn it, and the tube turns with it while the pieces keep falling downwards.',
  asking: 'Waiting for permission to read the device’s position…',
  active: 'On. Turn the phone and the tube turns with it, and the pieces fall the way they would.',
  denied: 'Motion access was blocked. Allow it in your browser settings, then switch this back on.',
};

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
        <legend className={styles.legend}>Source</legend>

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
          description="A chamber of objects, or a photo or the camera mirrored flat."
        />

        {settings.source === 'objects' && (
          <>
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
        <legend className={styles.legend}>Assembly</legend>

        <p className={styles.hint}>
          A triangular tube of three mirrors. Six triangles meet at every corner to make a hexagon,
          and those hexagons repeat across the field — which is what a real one does.
        </p>
        <p className={styles.hint}>
          Swipe across the artwork to turn it. Pinch, or scroll, to zoom; drag with two fingers to
          move the source.
        </p>

        {/* The state is the description rather than a line of its own: one
            control, one thing said about it, and nothing announcing itself from
            inside a panel that is usually off screen. */}
        <ToggleField
          label="Turn by tilting"
          checked={settings.tilt}
          onChange={(checked) => {
            onChange('tilt', checked);
          }}
          description={TILT_HINTS[tiltStatus]}
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
