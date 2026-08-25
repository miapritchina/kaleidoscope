import { isCameraFacing, type CameraFacing } from './camera';
import { DEFAULT_OBJECTS, sanitizeObjectIds } from './objectSets';
import { createSeedString } from './random';

/** What the mirrors repeat. */
export const SOURCES = ['objects', 'liquid', 'image', 'camera'] as const;

export type SourceId = (typeof SOURCES)[number];

export function isSourceId(value: unknown): value is SourceId {
  return typeof value === 'string' && (SOURCES as readonly string[]).includes(value);
}

/**
 * What a cell of liquid is filled with.
 *
 * Not glass in a liquid — *instead* of glass. A kaleidoscope's object cell does
 * not have to hold loose pieces at all, and the ones that do not are a
 * different instrument entirely: a lava lamp's blobs climbing and sinking past
 * each other, smoke curling in a lit box, a cloud of glitter hanging in
 * clear fluid. The mirrors repeat whatever is in there, and what is in there is
 * the substance itself.
 */
export const SUBSTANCES = ['lava', 'smoke', 'glitter'] as const;

export type SubstanceId = (typeof SUBSTANCES)[number];

export function isSubstanceId(value: unknown): value is SubstanceId {
  return typeof value === 'string' && (SUBSTANCES as readonly string[]).includes(value);
}

/**
 * Whether the mirrors are looking at a cell of glass rather than out of the
 * tube altogether.
 *
 * Two of them are: a dry chamber and a liquid one. They are separate sources
 * and not one source with a switch, because what the glass is suspended in is
 * not a setting of a kaleidoscope — it is which kaleidoscope you are holding.
 * Everything that is true of a chamber is true of both, though, so the places
 * that only care whether there is one ask here rather than naming them.
 */
export function isChamberSource(source: SourceId): boolean {
  return source === 'objects' || source === 'liquid';
}

/** Whether the cell holds loose pieces rather than a substance. */
export function isGlassSource(source: SourceId): boolean {
  return source === 'objects';
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
   * How much the piece sizes differ from each other, from none to the widest.
   *
   * Nought is a cell of one size — every piece "normal", whatever the pinch has
   * set that to. Opening it spreads the sizes about that middle in proportion,
   * so the smallest get smaller as the biggest get bigger, and at the far end a
   * cell holds everything from grit to beads.
   *
   * It changes the variety and nothing else: the total area of glass is held
   * constant across the range, so a wider mix does not also fill the chamber
   * fuller. How full it is stays the piece count's business.
   */
  variety: number;
  /** What the liquid cell is filled with. See {@link SUBSTANCES}. */
  substance: SubstanceId;
  /**
   * How much of that substance there is, from a trace to a cell full.
   *
   * One slider for all three, because it is one question — how much of the
   * stuff is in there — and it only means a different noun each time: blobs of
   * lava, smoke in the air, flakes of glitter.
   */
  amount: number;
  /**
   * How thick the liquid cell's fluid is, from thin to gel.
   *
   * Only the liquid cell has one. Thin, the substance moves freely and settles
   * quickly; thick, everything slows and hangs, and the only thing that shifts
   * it is the swirl of turning the tube. It is the same question for all three:
   * how much the fluid resists what is moving through it.
   */
  thickness: number;

  /**
   * How much of a glass bead is in front of the mirrors, from none to all.
   *
   * A teleidoscope — the kind with an open end — has a solid glass sphere where
   * this one has a chamber, and its optics are specific: a sphere of ordinary
   * glass focuses just outside its own surface, so it packs the whole hemisphere
   * in front of it into a disc, upside down, squeezed hardest at the rim.
   *
   * An optic rather than a content, so it sits with the mirrors — but it never
   * touches the chamber. A real instrument with an object cell has no open end
   * to put a marble over, and applied anyway the sphere's inversion hung the
   * pile upside down against gravity. The bead is for a photograph and the
   * camera, where it is the teleidoscope it names.
   */
  bead: number;
  /**
   * How big the things in the source are, as a multiplier.
   *
   * The pieces in the chamber, or the magnification of a photo. Pinched and
   * scrolled rather than dragged on a slider: it belongs to what is being
   * looked at, and the hand is already on it.
   */
  sourceScale: number;
  /**
   * Which sets of objects the chamber is loaded with, mixed together.
   *
   * A list of bundled set ids, plus `custom` for a picture the viewer supplies.
   * See `lib/objectSets.ts`. The chamber holds them all at once — the pieces
   * are shared out across the chosen sets — so a pile can be gems and beads and
   * splinters together. Empty is not a state this carries: an input that names
   * no real set falls back to the one the app opens on. A picture cannot travel
   * in a shared link, so a restored `custom` only means "offer the picker" —
   * until one is chosen it simply adds nothing to the mix.
   */
  objects: string[];
  /**
   * How big the mirror triangle is, as a multiplier.
   *
   * The instrument rather than its contents — a wider tube shows fewer, larger
   * repeats — so this one is a slider and not a gesture.
   */
  zoom: number;
  /**
   * How far the whole mirror framework is turned, in degrees.
   *
   * Which way up you are holding the tube. It turns the figure and nothing
   * else: the pieces go on falling down the screen, because gravity does not
   * care how the instrument is held.
   *
   * A third of a turn brings the framework back onto itself — six triangles
   * around a point, alternately mirrored, are unchanged by 120 degrees — so
   * that is the whole range there is.
   */
  angle: number;
  /**
   * Let the phone's own position say which way is down.
   *
   * Off by default, and not carried in a shared link: whether a device has the
   * sensor, and whether its owner has allowed it, is about the recipient rather
   * than about the look being shared.
   */
  tilt: boolean;
  /** Draws the mirror triangle and the direction of gravity over the figure. */
  debug: boolean;
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
  // The cell is round and the mirror triangle sees 41% of it, so these are
  // counts for a disc, not the 4-60 the old triangular cell wore. The top end
  // is a measured ceiling, not a taste: at about three quarters packed the
  // pile still rests and still avalanches when turned, and by 160
  // default-sized pieces it wedges solid — nothing moves and the instrument
  // is a picture. So the cell comes as full as the mechanism affords, and the
  // slider only empties it; the low end is deliberately sparse, a few beads
  // tumbling being a look someone can choose.
  shards: { min: 30, max: 150, step: 1 },
  variety: { min: 0, max: 1, step: 0.05 },
  thickness: { min: 0, max: 1, step: 0.05 },
  amount: { min: 0.05, max: 1, step: 0.05 },
  bead: { min: 0, max: 1, step: 0.05 },
  sourceScale: { min: 0.4, max: 2.5, step: 0.05 },
  zoom: { min: 0.5, max: 3, step: 0.05 },
  // A third of a turn is the whole of it: the framework is unchanged by 120
  // degrees, so a wider slider would only repeat itself twice over.
  angle: { min: 0, max: 120, step: 1 },
} as const satisfies Record<string, NumericLimit>;

export const DEFAULT_SETTINGS: Settings = {
  source: 'objects',
  cameraFacing: 'environment',
  // Full: the most glass the mechanism affords, which is also what keeps the
  // mirror triangle covered. See LIMITS.
  shards: 150,
  // The middle of the range, which is about the spread the chamber has always
  // been cut at: a little over three to one between the smallest piece and the
  // biggest.
  variety: 0.5,
  // Oil rather than gel: the glass still sinks, visibly and slowly, which is
  // what says the cell is full of something. A gel is a look to choose and not
  // one to open on — nothing appears to be happening in it until the tube is
  // turned.
  thickness: 0.35,
  // A lamp of climbing blobs, which is the one everyone has watched.
  substance: 'lava',
  // Enough to fill the cell without crowding it.
  amount: 0.55,
  bead: 0.6,
  sourceScale: 1,
  objects: [DEFAULT_OBJECTS],
  zoom: 1.2,
  angle: 0,
  tilt: false,
  debug: false,
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
    variety: clampToLimit(toNumber(raw.variety, DEFAULT_SETTINGS.variety), LIMITS.variety),
    thickness: clampToLimit(toNumber(raw.thickness, DEFAULT_SETTINGS.thickness), LIMITS.thickness),
    substance: isSubstanceId(raw.substance) ? raw.substance : DEFAULT_SETTINGS.substance,
    amount: clampToLimit(toNumber(raw.amount, DEFAULT_SETTINGS.amount), LIMITS.amount),
    bead: clampToLimit(toNumber(raw.bead, DEFAULT_SETTINGS.bead), LIMITS.bead),
    sourceScale: clampToLimit(
      toNumber(raw.sourceScale, DEFAULT_SETTINGS.sourceScale),
      LIMITS.sourceScale,
    ),
    objects: sanitizeObjectIds(raw.objects),
    zoom: clampToLimit(toNumber(raw.zoom, DEFAULT_SETTINGS.zoom), LIMITS.zoom),
    angle: clampToLimit(toNumber(raw.angle, DEFAULT_SETTINGS.angle), LIMITS.angle),
    tilt: typeof raw.tilt === 'boolean' ? raw.tilt : DEFAULT_SETTINGS.tilt,
    debug: typeof raw.debug === 'boolean' ? raw.debug : DEFAULT_SETTINGS.debug,
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
 * `tilt` is deliberately left out: it says something about the recipient's
 * hardware rather than about the look being shared. `source` travels only when
 * it names a chamber. A link cannot carry the recipient's photo or camera, so
 * naming either of those would open a panel on an empty view — but which cell
 * the glass is suspended in is a property of the look, and a liquid one shared
 * as a dry one is not the thing that was shared.
 */
export function settingsToSearchParams(settings: Settings): URLSearchParams {
  const params = new URLSearchParams({
    shards: String(settings.shards),
    bead: String(settings.bead),
    sourceScale: String(settings.sourceScale),
    objects: settings.objects.join(','),
    zoom: String(settings.zoom),
    angle: String(settings.angle),
    variety: String(settings.variety),
    thickness: String(settings.thickness),
    substance: settings.substance,
    amount: String(settings.amount),
    seed: settings.seed,
  });

  if (isChamberSource(settings.source)) {
    params.set('source', settings.source);
  }

  return params;
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
  'chipSize',
  'metallic',
  'palette',
  // The two the liquid cell had while it still held glass: how much glitter was
  // sprinkled over the pile, and how much ink was poured around it. Both are
  // now the `substance` the cell is filled with instead of pieces.
  'glitter',
  'ink',
];

/** True when a URL carries anything this module would read. */
export function hasSettingsParams(params: URLSearchParams): boolean {
  return KNOWN_PARAMS.some((name) => params.has(name));
}

/** Decodes a query string produced by {@link settingsToSearchParams}. */
export function settingsFromSearchParams(params: URLSearchParams): Settings {
  const source = params.get('source');

  return sanitizeSettings({
    // Only a cell is taken from a link, however that link was written. A
    // hand-edited one asking for the camera would fire a permission prompt on
    // page load that nobody at this end asked for.
    source: isSourceId(source) && isChamberSource(source) ? source : DEFAULT_SETTINGS.source,
    shards: params.get('shards'),
    variety: params.get('variety'),
    thickness: params.get('thickness'),
    substance: params.get('substance'),
    amount: params.get('amount'),
    bead: params.get('bead'),
    sourceScale: params.get('sourceScale') ?? params.get('chipSize'),
    objects: params.get('objects'),
    zoom: params.get('zoom'),
    angle: params.get('angle'),
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
