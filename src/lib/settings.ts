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
   * Number of mirror lines through the centre.
   *
   * Each mirror produces a reflected pair, so the pattern repeats `2 x mirrors`
   * times around the circle — a 3-mirror kaleidoscope gives the familiar
   * hexagonal figure. Counting mirrors rather than wedges is both what the
   * physical instrument has and what keeps the wedge count even, which the
   * alternating reflections require in order to meet edge to edge.
   */
  mirrors: number;
  /** How many shards live in the source cell. */
  shards: number;
  /** Magnification of the source cell. */
  zoom: number;
  /** Motion-trail persistence, `0` = none, `0.95` = long smear. */
  trails: number;
  /** Additive blending, which makes overlaps bloom. */
  glow: boolean;
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
  mirrors: { min: 2, max: 18, step: 1 },
  shards: { min: 4, max: 60, step: 1 },
  zoom: { min: 0.5, max: 3, step: 0.05 },
  trails: { min: 0, max: 0.95, step: 0.05 },
} as const satisfies Record<string, NumericLimit>;

export const DEFAULT_SETTINGS: Settings = {
  source: 'shards',
  mirrors: 6,
  shards: 24,
  zoom: 1.2,
  trails: 0.35,
  glow: true,
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
    mirrors: clampToLimit(readMirrors(raw), LIMITS.mirrors),
    shards: clampToLimit(toNumber(raw.shards, DEFAULT_SETTINGS.shards), LIMITS.shards),
    zoom: clampToLimit(toNumber(raw.zoom, DEFAULT_SETTINGS.zoom), LIMITS.zoom),
    trails: clampToLimit(toNumber(raw.trails, DEFAULT_SETTINGS.trails), LIMITS.trails),
    glow: typeof raw.glow === 'boolean' ? raw.glow : DEFAULT_SETTINGS.glow,
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
    mirrors: String(settings.mirrors),
    shards: String(settings.shards),
    zoom: String(settings.zoom),
    trails: String(settings.trails),
    glow: settings.glow ? '1' : '0',
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
  'segments', // Superseded by `mirrors`.
  'speed', // The tube is turned by swiping now; tolerated in an old link.
  'source', // Never encoded, but tolerated in a hand-written link.
];

/** True when a URL carries anything this module would read. */
export function hasSettingsParams(params: URLSearchParams): boolean {
  return KNOWN_PARAMS.some((name) => params.has(name));
}

/** Decodes a query string produced by {@link settingsToSearchParams}. */
export function settingsFromSearchParams(params: URLSearchParams): Settings {
  const glow = params.get('glow');

  return sanitizeSettings({
    mirrors: params.get('mirrors'),
    // Accepted for links made before this was counted in mirrors.
    segments: params.get('segments'),
    shards: params.get('shards'),
    zoom: params.get('zoom'),
    trails: params.get('trails'),
    glow: glow === null ? undefined : glow === '1' || glow === 'true',
    paletteId: params.get('palette'),
    seed: params.get('seed'),
  });
}

/**
 * Reads the mirror count, accepting the wedge count this setting used to be.
 *
 * Links and stored settings from before the change carry `segments`, which was
 * twice the mirror count. Halving it reproduces the same figure rather than
 * silently snapping an old link to the default.
 */
function readMirrors(raw: Partial<Record<string, unknown>>): number {
  if (raw.mirrors !== undefined && raw.mirrors !== null) {
    return toNumber(raw.mirrors, DEFAULT_SETTINGS.mirrors);
  }

  if (raw.segments !== undefined && raw.segments !== null) {
    return toNumber(raw.segments, DEFAULT_SETTINGS.mirrors * 2) / 2;
  }

  return DEFAULT_SETTINGS.mirrors;
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
