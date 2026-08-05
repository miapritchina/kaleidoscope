import type { SourceId } from './settings';

export interface PlaybackInput {
  source: SourceId;
  prefersReducedMotion: boolean;
  /** Explicit Play/Pause press; `null` means "follow the system preference". */
  override: boolean | null;
}

export interface Playback {
  /** Whether frames are drawn at all. */
  isPlaying: boolean;
  /** Whether the mirrors are held still while frames keep being drawn. */
  suppressSpin: boolean;
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
 * respectful; freezing a live camera on its first frame just breaks it. So a
 * live source keeps drawing, and the reduced-motion preference is honoured by
 * holding the mirrors still instead.
 *
 * An explicit Play or Pause always wins — a deliberate Pause on the camera is a
 * freeze-frame, which is a reasonable thing to want.
 */
export function resolvePlayback({
  source,
  prefersReducedMotion,
  override,
}: PlaybackInput): Playback {
  if (override !== null) {
    return { isPlaying: override, suppressSpin: false };
  }

  return {
    isPlaying: isLive(source) || !prefersReducedMotion,
    suppressSpin: prefersReducedMotion,
  };
}
