import { describe, expect, it } from 'vitest';

import { resolvePlayback } from './playback';

describe('resolvePlayback', () => {
  describe('with no reduced-motion preference', () => {
    it('plays every source', () => {
      for (const source of ['shards', 'image', 'camera'] as const) {
        expect(resolvePlayback({ source, prefersReducedMotion: false })).toEqual({
          isPlaying: true,
        });
      }
    });
  });

  describe('with a reduced-motion preference', () => {
    it('pauses a generated shard field', () => {
      expect(resolvePlayback({ source: 'shards', prefersReducedMotion: true })).toEqual({
        isPlaying: false,
      });
    });

    it('pauses a still photo, which has nothing of its own to show', () => {
      expect(resolvePlayback({ source: 'image', prefersReducedMotion: true }).isPlaying).toBe(
        false,
      );
    });

    // Freezing the camera on its first frame does not reduce motion, it just
    // breaks the feature the viewer asked for.
    it('keeps a live camera drawing', () => {
      expect(resolvePlayback({ source: 'camera', prefersReducedMotion: true })).toEqual({
        isPlaying: true,
      });
    });
  });
});
