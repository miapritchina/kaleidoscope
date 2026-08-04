/**
 * Deterministic pseudo-random helpers.
 *
 * The scene generator is seeded so that a given seed always produces the same
 * kaleidoscope. That keeps renders reproducible, shareable via the URL, and
 * testable without snapshotting pixels.
 */

/** A pseudo-random number generator returning values in `[0, 1)`. */
export type Rng = () => number;

/**
 * Mulberry32 — a small, fast, well-distributed 32-bit PRNG.
 *
 * @param seed Any 32-bit integer. Equal seeds yield identical sequences.
 */
export function mulberry32(seed: number): Rng {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hashes an arbitrary string into a 32-bit integer usable as a seed (FNV-1a). */
export function hashSeed(input: string): number {
  let hash = 0x811c9dc5;

  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }

  return hash >>> 0;
}

/** Returns a random float in `[min, max)`. */
export function randomBetween(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min);
}

/** Returns a random integer in `[min, max]`. */
export function randomInt(rng: Rng, min: number, max: number): number {
  return Math.floor(randomBetween(rng, min, max + 1));
}

/** Picks a uniformly random element. Throws on an empty list. */
export function randomItem<T>(rng: Rng, items: readonly T[]): T {
  if (items.length === 0) {
    throw new RangeError('randomItem() requires a non-empty array');
  }

  return items[Math.floor(rng() * items.length)]!;
}

/** Creates a short human-friendly seed string, e.g. `"3f9k2a"`. */
export function createSeedString(rng: Rng = Math.random): string {
  return Math.floor(rng() * 0xffffff)
    .toString(36)
    .padStart(5, '0');
}
