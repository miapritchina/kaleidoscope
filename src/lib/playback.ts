import type { SkinId, SourceId } from './settings';

export interface PlaybackInput {
  source: SourceId;
  /** What the pieces are skinned with. Defaults to the palette's own colours. */
  skin?: SkinId;
  prefersReducedMotion: boolean;
  /** Explicit Play/Pause press; `null` means "follow the system preference". */
  override: boolean | null;
}

export interface Playback {
  /** Whether frames are drawn at all. */
  isPlaying: boolean;
}

/**
 * Whether the content is itself moving, rather than animated by this app.
 *
 * The camera counts wherever it is plugged in: skinning the pieces with it
 * makes the frame just as live as mirroring it does.
 */
function isLive(source: SourceId, skin: SkinId): boolean {
  return source === 'camera' || skin === 'camera';
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
 * in progress, and motion the viewer is producing with their own finger is not
 * the kind a reduced-motion preference is asking to remove.
 *
 * An explicit Play or Pause always wins — a deliberate Pause on the camera is a
 * freeze-frame, which is a reasonable thing to want.
 */
export function resolvePlayback({
  source,
  skin = 'palette',
  prefersReducedMotion,
  override,
}: PlaybackInput): Playback {
  if (override !== null) {
    return { isPlaying: override };
  }

  return { isPlaying: isLive(source, skin) || !prefersReducedMotion };
}
