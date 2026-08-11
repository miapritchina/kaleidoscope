import { describe, expect, it } from 'vitest';

import { resolvePlayback } from './playback';

describe('resolvePlayback', () => {
  describe('with no reduced-motion preference', () => {
    it('plays every source', () => {
      for (const source of ['shards', 'image', 'camera'] as const) {
        expect(resolvePlayback({ source, prefersReducedMotion: false, override: null })).toEqual({
          isPlaying: true,
        });
      }
    });
  });

  describe('with a reduced-motion preference', () => {
    it('pauses a generated shard field', () => {
      expect(
        resolvePlayback({ source: 'shards', prefersReducedMotion: true, override: null }),
      ).toEqual({ isPlaying: false });
    });

    it('pauses a still photo, which has nothing of its own to show', () => {
      expect(
        resolvePlayback({ source: 'image', prefersReducedMotion: true, override: null }).isPlaying,
      ).toBe(false);
    });

    // Freezing the camera on its first frame does not reduce motion, it just
    // breaks the feature the viewer asked for.
    it('keeps a live camera drawing', () => {
      expect(
        resolvePlayback({ source: 'camera', prefersReducedMotion: true, override: null }),
      ).toEqual({ isPlaying: true });
    });

    // The camera is just as live wherever it is plugged in: skinning the
    // pieces with it freezes on the first frame exactly as mirroring it would.
    it('keeps drawing when the camera only skins the pieces', () => {
      expect(
        resolvePlayback({
          source: 'shards',
          skin: 'camera',
          prefersReducedMotion: true,
          override: null,
        }),
      ).toEqual({ isPlaying: true });
    });

    it('still pauses a photo skin, which is not going anywhere', () => {
      expect(
        resolvePlayback({
          source: 'shards',
          skin: 'photo',
          prefersReducedMotion: true,
          override: null,
        }).isPlaying,
      ).toBe(false);
    });
  });

  describe('with an explicit choice', () => {
    it('honours Pause on a live camera, as a freeze-frame', () => {
      expect(
        resolvePlayback({ source: 'camera', prefersReducedMotion: false, override: false }),
      ).toEqual({ isPlaying: false });
    });

    it('honours Pause on the camera even under a reduced-motion preference', () => {
      expect(
        resolvePlayback({ source: 'camera', prefersReducedMotion: true, override: false })
          .isPlaying,
      ).toBe(false);
    });

    it('honours Play against the preference', () => {
      expect(
        resolvePlayback({ source: 'shards', prefersReducedMotion: true, override: true }),
      ).toEqual({ isPlaying: true });
    });
  });
});
