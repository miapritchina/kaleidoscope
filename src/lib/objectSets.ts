/**
 * The object sets a chamber can be loaded with.
 *
 * A set is a picture of objects on a transparent background, which `lib/skin.ts`
 * takes apart into one piece per object. The bundled ones are discovered from
 * the files themselves rather than listed here: dropping a PNG into
 * `src/assets/objects/` adds a preset, and removing it takes one away. No
 * registry to keep in step, and no way for the list and the files to disagree.
 *
 * One entry is not a file: `custom`, whatever picture the viewer supplies.
 * There is nothing else — a chamber is loaded with objects out of a picture or
 * it is empty.
 *
 * Each set has a thumbnail beside it, from `assets/objects/thumbs/`, matched by
 * filename. Those are a hundred and twenty pixels across and a few kilobytes;
 * showing the sets themselves would download a megabyte to draw seven pictures
 * the size of a postage stamp.
 */

/** A picture the viewer supplies. */
export const CUSTOM = 'custom';

export interface ObjectSet {
  readonly id: string;
  readonly name: string;
  /** Where the picture is, or `null` for the one that is not a file. */
  readonly url: string | null;
  /** A postage stamp of it, for the control. `null` when there is none. */
  readonly thumbnail: string | null;
}

// `eager` so the list is known at module load: the control has to render it
// before anything has been chosen, and a promise per preset would mean a panel
// that fills in a moment late.
const files: Record<string, string> = import.meta.glob('../assets/objects/*.{png,webp}', {
  eager: true,
  query: '?url',
  import: 'default',
});

const thumbs: Record<string, string> = import.meta.glob('../assets/objects/thumbs/*.{png,webp}', {
  eager: true,
  query: '?url',
  import: 'default',
});

const THUMBNAILS = new Map(
  Object.entries(thumbs).map(([path, url]) => [describe(path).id, url] as const),
);

/** `../assets/objects/rough-quartz.png` -> `rough-quartz`, `Rough quartz`. */
function describe(path: string): { id: string; name: string } {
  const id =
    path
      .split('/')
      .pop()
      ?.replace(/\.\w+$/, '') ?? path;
  const words = id.replace(/[-_]+/g, ' ').trim();

  return { id, name: words.charAt(0).toUpperCase() + words.slice(1) };
}

/** The bundled sets, in a stable order whatever the filesystem hands back. */
export const PRESET_SETS: readonly ObjectSet[] = Object.entries(files)
  .map(([path, url]) => {
    const { id, name } = describe(path);

    return { id, name, url, thumbnail: THUMBNAILS.get(id) ?? null };
  })
  .sort((a, b) => a.id.localeCompare(b.id));

export const OBJECT_SETS: readonly ObjectSet[] = [
  ...PRESET_SETS,
  { id: CUSTOM, name: 'Upload a photo…', url: null, thumbnail: null },
];

const BY_ID = new Map(OBJECT_SETS.map((set) => [set.id, set]));

/**
 * The set a chamber opens on.
 *
 * One name rather than a registry, and it still cannot disagree with the files:
 * if the picture it names is not there, the first bundled set is used instead,
 * and a build with no pictures at all opens on the upload prompt, because there
 * is nothing else it could honestly show.
 */
const OPENS_ON = 'cut-gems';

export const DEFAULT_OBJECTS: string =
  PRESET_SETS.find((set) => set.id === OPENS_ON)?.id ?? PRESET_SETS[0]?.id ?? CUSTOM;

export function isObjectSetId(value: unknown): value is string {
  return typeof value === 'string' && BY_ID.has(value);
}

/** The picture for a set, or `null` when it has none of its own. */
export function objectSetUrl(id: string): string | null {
  return BY_ID.get(id)?.url ?? null;
}
