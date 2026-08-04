import { describe, expect, it } from 'vitest';

import {
  createSeedString,
  hashSeed,
  mulberry32,
  randomBetween,
  randomInt,
  randomItem,
} from './random';

describe('mulberry32', () => {
  it('produces the same sequence for the same seed', () => {
    const first = mulberry32(42);
    const second = mulberry32(42);

    const a = Array.from({ length: 8 }, () => first());
    const b = Array.from({ length: 8 }, () => second());

    expect(a).toEqual(b);
  });

  it('produces different sequences for different seeds', () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });

  it('stays within [0, 1)', () => {
    const rng = mulberry32(7);

    for (let i = 0; i < 500; i += 1) {
      const value = rng();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('hashSeed', () => {
  it('is stable and case sensitive', () => {
    expect(hashSeed('kaleido')).toBe(hashSeed('kaleido'));
    expect(hashSeed('kaleido')).not.toBe(hashSeed('Kaleido'));
  });

  it('returns an unsigned 32-bit integer', () => {
    for (const input of ['', 'a', 'a much longer seed string']) {
      const hash = hashSeed(input);
      expect(Number.isInteger(hash)).toBe(true);
      expect(hash).toBeGreaterThanOrEqual(0);
      expect(hash).toBeLessThanOrEqual(0xffffffff);
    }
  });
});

describe('range helpers', () => {
  it('keeps randomBetween within bounds', () => {
    const rng = mulberry32(3);

    for (let i = 0; i < 200; i += 1) {
      const value = randomBetween(rng, -2, 5);
      expect(value).toBeGreaterThanOrEqual(-2);
      expect(value).toBeLessThan(5);
    }
  });

  it('makes randomInt inclusive of both ends', () => {
    const rng = mulberry32(11);
    const seen = new Set<number>();

    for (let i = 0; i < 400; i += 1) {
      seen.add(randomInt(rng, 0, 3));
    }

    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
  });

  it('picks items from the list and rejects empty input', () => {
    const rng = mulberry32(5);
    const items = ['a', 'b', 'c'] as const;

    expect(items).toContain(randomItem(rng, items));
    expect(() => randomItem(rng, [])).toThrow(RangeError);
  });
});

describe('createSeedString', () => {
  it('is non-empty and url safe', () => {
    expect(createSeedString(mulberry32(9))).toMatch(/^[0-9a-z]+$/);
  });
});
