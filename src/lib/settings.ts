import { isCameraFacing, type CameraFacing } from './camera';
import { DEFAULT_OBJECTS, isObjectSetId } from './objectSets';
import { createSeedString } from './random';

/** What the mirrors repeat. */
export const SOURCES = ['objects', 'image', 'camera'] as const;

export type SourceId = (typeof SOURCES)[number];

export function isSourceId(value: unknown): value is SourceId {
  return typeof value === 'string' && (SOURCES as readonly string[]).includes(value);
}

/** Everything that describes a kaleidoscope. Serialisable by design. */
export interface Settings {
  /**
   * Where the pattern comes from. `image` and `camera` depend on data this app
   * never stores — a picked file, a live stream — so a restored `image` or
   * `camera` only means "reopen that panel", not "reopen that picture".
   */
  source: SourceId;
  /**
   * Which camera to ask for.
   *
   * The back one by default: a kaleidoscope is something you point at the
   * world, and a phone's front camera points at your face. Kept out of a shared
   * link for the same reason `source` is — it describes the recipient's
   * hardware, not the look being shared.
   */
  cameraFacing: CameraFacing;
  /** How many shards live in the source cell. */
  shards: number;
  /**
   * Size of the glass pieces, as a multiplier.
   *
   * Separate from the cell size, which sets how many chips land in view as well
   * as how big they are — so growing that to enlarge them thins them out.
   */
  chipSize: number;
  /**
   * Which set of objects the chamber is loaded with.
   *
   * A bundled set's id, `custom` for a picture the viewer supplies, or
   * `generated` for the drawn shapes. See `lib/objectSets.ts`. A picture cannot
   * travel in a shared link, so a restored `custom` only means "offer the
   * picker" — until one is chosen the pieces fall back to the drawn shapes.
   */
  objects: string;
  /** Magnification of the source cell. */
  zoom: number;
  /**
   * Turn the tube by turning the phone.
   *
   * Off by default, and not carried in a shared link: whether a device has the
   * sensor, and whether its owner has allowed it, is about the recipient rather
   * than about the look being shared.
   */
  tilt: boolean;
  /** Seed for the shard generator. */
  seed: string;
}

export interface NumericLimit {
  min: number;
  max: number;
  step: number;
}

/**
 * Single source of truth for the numeric ranges. The controls render from these
 * and every inbound value (storage, URL) is clamped to them, so an out-of-range
 * value can never reach the renderer.
 */
export const LIMITS = {
  shards: { min: 4, max: 60, step: 1 },
  chipSize: { min: 0.4, max: 2.5, step: 0.05 },
  zoom: { min: 0.5, max: 3, step: 0.05 },
} as const satisfies Record<string, NumericLimit>;

export const DEFAULT_SETTINGS: Settings = {
  source: 'objects',
  cameraFacing: 'environment',
  shards: 30,
  chipSize: 1,
  objects: DEFAULT_OBJECTS,
  zoom: 1.2,
  tilt: false,
  seed: 'kaleido',
};

/** Clamps to `[min, max]` and snaps to the nearest step. */
export function clampToLimit(value: number, limit: NumericLimit): number {
  if (!Number.isFinite(value)) {
    return limit.min;
  }

  const clamped = Math.min(limit.max, Math.max(limit.min, value));
  const snapped = limit.min + Math.round((clamped - limit.min) / limit.step) * limit.step;

  // Re-clamp: rounding up on the last step can overshoot `max`.
  return roundFloat(Math.min(limit.max, Math.max(limit.min, snapped)));
}

/**
 * Coerces arbitrary input into valid settings, falling back to the defaults
 * field by field. Used for anything crossing a trust boundary — `localStorage`,
 * the URL, or a hand-edited share link.
 */
export function sanitizeSettings(input: unknown): Settings {
  if (typeof input !== 'object' || input === null) {
    return { ...DEFAULT_SETTINGS };
  }

  const raw = input as Partial<Record<keyof Settings, unknown>>;

  return {
    source: isSourceId(raw.source) ? raw.source : DEFAULT_SETTINGS.source,
    cameraFacing: isCameraFacing(raw.cameraFacing)
      ? raw.cameraFacing
      : DEFAULT_SETTINGS.cameraFacing,
    shards: clampToLimit(toNumber(raw.shards, DEFAULT_SETTINGS.shards), LIMITS.shards),
    chipSize: clampToLimit(toNumber(raw.chipSize, DEFAULT_SETTINGS.chipSize), LIMITS.chipSize),
    objects: isObjectSetId(raw.objects) ? raw.objects : DEFAULT_SETTINGS.objects,
    zoom: clampToLimit(toNumber(raw.zoom, DEFAULT_SETTINGS.zoom), LIMITS.zoom),
    tilt: typeof raw.tilt === 'boolean' ? raw.tilt : DEFAULT_SETTINGS.tilt,
    seed: toSeed(raw.seed),
  };
}

/** Produces a fresh random look while keeping the structural settings intact. */
export function randomizeSeed(settings: Settings): Settings {
  return { ...settings, seed: createSeedString() };
}

/**
 * Encodes settings into a query string suitable for sharing.
 *
 * `source` and `tilt` are deliberately left out: a link cannot carry the
 * recipient's photo or camera, nor say anything useful about their hardware.
 */
export function settingsToSearchParams(settings: Settings): URLSearchParams {
  return new URLSearchParams({
    shards: String(settings.shards),
    chipSize: String(settings.chipSize),
    objects: settings.objects,
    zoom: String(settings.zoom),
    seed: settings.seed,
  });
}

/**
 * Every query parameter the decoder understands, legacy names included.
 *
 * Derived from the encoder's own output so the two cannot drift: a hand-kept
 * list silently stops recognising whatever is added next, and a parameter
 * missing from it is a shared link that quietly opens on the wrong settings.
 */
const KNOWN_PARAMS: readonly string[] = [
  ...settingsToSearchParams(DEFAULT_SETTINGS).keys(),
  // Settings this app once offered, tolerated so an old link still opens: the
  // mirror arrangement, back when there was a choice of one; the two names this
  // flag had while the pieces were transparent and lit from behind; and the
  // camera as a source for the pieces themselves; the motion trail, back when
  // each frame lingered into the next; the name the object set had while it was
  // a choice of three; the finish, under all three of its names, and the
  // palette — both of which described drawn pieces, which are gone.
  'segments',
  'mirrors',
  'geometry',
  'speed',
  'glow',
  'light',
  'trails',
  'skin',
  'metallic',
  'palette',
  'source', // Never encoded, but tolerated in a hand-written link.
];

/** True when a URL carries anything this module would read. */
export function hasSettingsParams(params: URLSearchParams): boolean {
  return KNOWN_PARAMS.some((name) => params.has(name));
}

/** Decodes a query string produced by {@link settingsToSearchParams}. */
export function settingsFromSearchParams(params: URLSearchParams): Settings {
  return sanitizeSettings({
    shards: params.get('shards'),
    chipSize: params.get('chipSize'),
    objects: params.get('objects'),
    zoom: params.get('zoom'),
    seed: params.get('seed'),
  });
}

function toNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return fallback;
}

function toSeed(value: unknown): string {
  if (typeof value !== 'string') {
    return DEFAULT_SETTINGS.seed;
  }

  const trimmed = value.trim().slice(0, 32);
  return trimmed === '' ? DEFAULT_SETTINGS.seed : trimmed;
}

/** Trims binary floating-point noise, e.g. `0.30000000000000004` -> `0.3`. */
function roundFloat(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
