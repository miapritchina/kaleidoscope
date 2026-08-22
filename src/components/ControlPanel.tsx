import { useState } from 'react';

import type { CameraStatus } from '../hooks/useCamera';

import { buildLine } from '../lib/build';
import { CAMERA_FACINGS, type CameraFacing } from '../lib/camera';
import { CUSTOM, OBJECT_SETS } from '../lib/objectSets';
import { LIMITS, type Settings, type SourceId } from '../lib/settings';

import { FileField } from './controls/FileField';
import { Icon, type IconName } from './controls/Icon';
import { RangeField } from './controls/RangeField';
import { PictureField } from './controls/PictureField';
import { SelectField } from './controls/SelectField';
import { TextField } from './controls/TextField';
import { ToggleField } from './controls/ToggleField';
import styles from './ControlPanel.module.css';

export interface ControlPanelProps {
  settings: Settings;
  onChange: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  onReset: () => void;
  /** Saves the frame as it stands, which is not the seamless tile the toolbar saves. */
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

/**
 * The two kinds of kaleidoscope, as tabs.
 *
 * They were a dropdown of every object set and both mirror sources in one list,
 * which asked the wrong question. "A chamber of glass, or something from
 * outside it" is a choice between instruments; which picture the chamber is
 * loaded with is one you only make once you are holding the first. Flattening
 * the two made the important choice look like a detail among nine.
 *
 * A still and a live feed are not two of those instruments. Both are the
 * mirrors pointed at something that is not in the tube, differing only in
 * whether it moves — so they share a tab and a switch, and the two most similar
 * choices in the app are no longer the two furthest apart.
 *
 * Tabs carry their own settings, so a seed and a piece count are not on screen
 * while a photograph is being mirrored.
 */
const KINDS: { id: SourceId; label: string; icon: IconName }[] = [
  { id: 'objects', label: 'Shards', icon: 'shards' },
  { id: 'image', label: 'View', icon: 'photo' },
];

/** The tab a source belongs to. Both mirror sources share one. */
function tabFor(source: SourceId): SourceId {
  return source === 'objects' ? 'objects' : 'image';
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
 * What is worth saying about the state of a permission, and nothing more.
 *
 * These used to be sentences of explanation under every control. A panel of
 * paragraphs is a panel nobody reads, and the ones that mattered — a blocked
 * permission, a camera that will not start — were lost among the ones that
 * merely described what the control obviously did.
 */
const CAMERA_HINTS: Partial<Record<CameraStatus, string>> = {
  starting: 'Waiting for permission…',
  denied: 'Camera access is blocked.',
  unavailable: 'No camera available.',
  error: 'The camera could not start.',
};

export function ControlPanel({
  settings,
  onChange,
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

  // A still and a live feed are the same instrument pointed at two things, so
  // they share a tab and a switch rather than each having a tab of its own.
  // Separating them put the two most similar choices furthest apart.
  const kind = tabFor(settings.source);
  const live = settings.source === 'camera';
  const cameraHint = cameraMessage ?? CAMERA_HINTS[cameraStatus];

  return (
    <form
      className={styles.panel}
      onSubmit={(event) => {
        event.preventDefault();
      }}
    >
      <div className={styles.tabs} role="tablist" aria-label="Kind">
        {KINDS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            id={`kind-${entry.id}`}
            aria-selected={kind === entry.id}
            aria-controls={`panel-${entry.id}`}
            // Only the chosen tab is in the tab order; the arrows move between
            // them, which is what a tablist is expected to do.
            tabIndex={kind === entry.id ? 0 : -1}
            className={kind === entry.id ? `${styles.tab} ${styles.here}` : styles.tab}
            onClick={() => {
              onChange('source', entry.id);
            }}
            onKeyDown={(event) => {
              const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;

              if (step === 0) {
                return;
              }

              event.preventDefault();
              const at = KINDS.findIndex((other) => other.id === kind);
              const next = KINDS[(at + step + KINDS.length) % KINDS.length];

              if (next) {
                onChange('source', next.id);
                document.getElementById(`kind-${next.id}`)?.focus();
              }
            }}
          >
            <Icon name={entry.icon} size={1.4} />
            <span className={styles.tabLabel}>{entry.label}</span>
          </button>
        ))}
      </div>

      <div
        className={styles.group}
        role="tabpanel"
        id={`panel-${kind}`}
        aria-labelledby={`kind-${kind}`}
      >
        {kind === 'objects' && (
          <>
            <PictureField
              label="Glass"
              value={settings.objects}
              options={OBJECT_SETS.map((set) => ({
                value: set.id,
                label: set.name,
                picture: set.thumbnail,
              }))}
              onChange={(value) => {
                onChange('objects', value);
              }}
            />

            {settings.objects === CUSTOM && (
              <>
                <FileField
                  label="Picture"
                  accept="image/*"
                  fileName={imageName}
                  buttonLabel={imageName ? 'Replace picture' : 'Choose picture'}
                  onSelect={onSelectImage}
                />
                <p className={styles.hint}>A PNG of a few objects on a transparent background.</p>
              </>
            )}

            <RangeField
              label="Pieces"
              value={settings.shards}
              limit={LIMITS.shards}
              onChange={(value) => {
                onChange('shards', value);
              }}
            />

            <RangeField
              label="Glitter"
              value={settings.glitter}
              limit={LIMITS.glitter}
              format={(value) => (value === 0 ? 'none' : `${String(Math.round(value * 100))}%`)}
              onChange={(value) => {
                onChange('glitter', value);
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
          </>
        )}

        {kind === 'image' && (
          <>
            <ToggleField
              label="Live camera"
              checked={live}
              onChange={(checked) => {
                onChange('source', checked ? 'camera' : 'image');
              }}
            />

            {live ? (
              <>
                <SelectField
                  label="Facing"
                  value={settings.cameraFacing}
                  options={CAMERA_OPTIONS}
                  onChange={(value) => {
                    onChange('cameraFacing', value);
                  }}
                />
                {cameraHint ? (
                  <p className={styles.error} role="status">
                    {cameraHint}
                  </p>
                ) : null}
              </>
            ) : (
              <>
                <FileField
                  label="Picture"
                  accept="image/*"
                  fileName={imageName}
                  buttonLabel={imageName ? 'Replace picture' : 'Choose picture'}
                  onSelect={onSelectImage}
                />
                <p className={styles.hint}>Or drop one onto the artwork.</p>
                {imageName ? (
                  <button type="button" className={styles.ghost} onClick={onClearImage}>
                    Remove picture
                  </button>
                ) : null}
                {imageError ? (
                  <p className={styles.error} role="alert">
                    {imageError}
                  </p>
                ) : null}
              </>
            )}
          </>
        )}
      </div>

      <div className={styles.group}>
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

        <RangeField
          label="Bead"
          value={settings.bead}
          limit={LIMITS.bead}
          format={(value) => (value === 0 ? 'none' : `${String(Math.round(value * 100))}%`)}
          onChange={(value) => {
            onChange('bead', value);
          }}
        />

        {/* Real gravity is not here: its switch lives on the artwork's own
            toolbar, because switching it on is the tap iOS demands before the
            sensor may even be asked for. */}
        <ToggleField
          label="Show the mirrors"
          checked={settings.debug}
          onChange={(checked) => {
            onChange('debug', checked);
          }}
        />
      </div>

      {/* Three verbs, as icons: named for a screen reader and titled for a
          pointer, so nothing is lost by not spelling them out.

          Reshuffling used to be here too. It is on the toolbar over the
          artwork, where a hand already is, and having it in both places put two
          buttons with the same name on screen at once — ambiguous to a screen
          reader and clutter to everyone else. Saving stays, because the two
          saves are different: the toolbar writes the seamless tile, this one
          writes the frame as you are looking at it. */}
      <div className={styles.actions}>
        <button type="button" title="Save this frame" aria-label="Save this frame" onClick={onSave}>
          <Icon name="save" />
        </button>
        <button type="button" title="Copy link" aria-label="Copy link" onClick={onShare}>
          <Icon name="link" />
        </button>
        <button type="button" title="Reset" aria-label="Reset" onClick={onReset}>
          <Icon name="reset" />
        </button>
      </div>

      {/* Shown, but not announced: the app owns a live region of its own, so
          that a message still reaches a viewer with this panel closed. */}
      <p className={styles.status} aria-hidden="true">
        {status}
      </p>

      {/* Which build this is. A cached page looks exactly like a fresh one, and
          this app is a picture — there is otherwise nothing on screen that
          would tell you the phone is still running last week's copy. */}
      <p className={styles.build}>{buildLine()}</p>
    </form>
  );
}
