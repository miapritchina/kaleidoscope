import type { SourceId } from './settings';

export interface PlaybackInput {
  source: SourceId;
  prefersReducedMotion: boolean;
}

export interface Playback {
  /** Whether frames are drawn at all. */
  isPlaying: boolean;
}

/** Sources whose content is itself moving, rather than animated by this app. */
function isLive(source: SourceId): boolean {
  return source === 'camera';
}

/**
 * Decides how playback should behave.
 *
 * A reduced-motion preference is about animation this app invents, not about
 * content the viewer explicitly asked for. Pausing a generated shard field is
 * respectful; freezing a live camera on its first frame just breaks it, so a
 * live source keeps drawing.
 *
 * Turning the tube is not covered either way: it only happens while a swipe is
 * in progress, or while the instrument is being held at an angle, and motion
 * the viewer is producing with their own hand is not the kind a reduced-motion
 * preference is asking to remove.
 */
export function resolvePlayback({ source, prefersReducedMotion }: PlaybackInput): Playback {
  return { isPlaying: isLive(source) || !prefersReducedMotion };
}
