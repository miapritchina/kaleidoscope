import { isCameraFacing, type CameraFacing } from './camera';
import { DEFAULT_PALETTE_ID, isPaletteId, type PaletteId } from './palettes';
import { createSeedString } from './random';

/** What the mirrors repeat. */
export const SOURCES = ['shards', 'image', 'camera'] as const;

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
  /** Magnification of the source cell. */
  zoom: number;
  /** Motion-trail persistence, `0` = none, `0.95` = long smear. */
  trails: number;
  /**
   * A strong light behind the glass rather than a soft one.
   *
   * You look through a kaleidoscope at a light, so how bright that light is
   * changes everything: held up to a lamp the glass thins out and goes
   * brilliant, against a diffuse window it stays deep and saturated.
   */
  light: boolean;
  paletteId: PaletteId;
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
  trails: { min: 0, max: 0.95, step: 0.05 },
} as const satisfies Record<string, NumericLimit>;

export const DEFAULT_SETTINGS: Settings = {
  source: 'shards',
  cameraFacing: 'environment',
  shards: 30,
  chipSize: 1,
  zoom: 1.2,
  trails: 0.35,
  light: false,
  paletteId: DEFAULT_PALETTE_ID,
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
    zoom: clampToLimit(toNumber(raw.zoom, DEFAULT_SETTINGS.zoom), LIMITS.zoom),
    trails: clampToLimit(toNumber(raw.trails, DEFAULT_SETTINGS.trails), LIMITS.trails),
    light: typeof raw.light === 'boolean' ? raw.light : DEFAULT_SETTINGS.light,
    paletteId: isPaletteId(raw.paletteId) ? raw.paletteId : DEFAULT_SETTINGS.paletteId,
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
 * `source` is deliberately left out: a link cannot carry the recipient's photo
 * or camera, so it always opens on the shard field.
 */
export function settingsToSearchParams(settings: Settings): URLSearchParams {
  return new URLSearchParams({
    shards: String(settings.shards),
    chipSize: String(settings.chipSize),
    zoom: String(settings.zoom),
    trails: String(settings.trails),
    light: settings.light ? '1' : '0',
    palette: settings.paletteId,
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
  // mirror arrangement, back when there was a choice of one, and the additive
  // blending that made sense while the backdrop was a void rather than a light.
  'segments',
  'mirrors',
  'geometry',
  'speed',
  'glow',
  'source', // Never encoded, but tolerated in a hand-written link.
];

/** True when a URL carries anything this module would read. */
export function hasSettingsParams(params: URLSearchParams): boolean {
  return KNOWN_PARAMS.some((name) => params.has(name));
}

/** Decodes a query string produced by {@link settingsToSearchParams}. */
export function settingsFromSearchParams(params: URLSearchParams): Settings {
  // `glow` is what this flag was called while it meant additive blending. Both
  // asked for the more brilliant of the two looks, so an old link keeps its.
  const light = params.get('light') ?? params.get('glow');

  return sanitizeSettings({
    shards: params.get('shards'),
    chipSize: params.get('chipSize'),
    zoom: params.get('zoom'),
    trails: params.get('trails'),
    light: light === null ? undefined : light === '1' || light === 'true',
    paletteId: params.get('palette'),
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
