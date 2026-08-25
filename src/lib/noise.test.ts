import { describe, expect, it } from 'vitest';

import { createNoise } from './noise';

describe('createNoise', () => {
  it('is deterministic for a seed, and different for another', () => {
    const a = createNoise(7);
    const b = createNoise(7);
    const c = createNoise(8);

    expect(a(1.3, 2.7, 0.5)).toBe(b(1.3, 2.7, 0.5));
    expect(a(1.3, 2.7, 0.5)).not.toBe(c(1.3, 2.7, 0.5));
  });

  it('stays in bounds', () => {
    const noise = createNoise(3);

    for (let i = 0; i < 500; i += 1) {
      const value = noise(i * 0.37, i * 0.73, i * 0.11);

      expect(value).toBeGreaterThanOrEqual(-1.5);
      expect(value).toBeLessThanOrEqual(1.5);
    }
  });

  it('is smooth: nearby points read nearby values', () => {
    const noise = createNoise(5);

    for (let i = 0; i < 200; i += 1) {
      const x = i * 0.61;
      const y = i * 0.29;
      const t = i * 0.07;

      expect(Math.abs(noise(x + 0.01, y, t) - noise(x, y, t))).toBeLessThan(0.1);
      expect(Math.abs(noise(x, y, t + 0.01) - noise(x, y, t))).toBeLessThan(0.1);
    }
  });

  it('varies: it is noise, not a constant', () => {
    const noise = createNoise(11);
    const seen = new Set<number>();

    for (let i = 0; i < 50; i += 1) {
      seen.add(noise(i * 1.7, i * 2.3, 0));
    }

    expect(seen.size).toBeGreaterThan(40);
  });
});
