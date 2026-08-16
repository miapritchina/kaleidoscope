/**
 * Photo and camera input.
 *
 * A media source replaces the generated shard field as the thing the mirrors
 * repeat. Everything downstream — the wedge, the mirroring, the spin — is
 * unchanged, so a photo and a camera feed run through exactly the same pipeline
 * the shards do.
 */

export type MediaElement = HTMLImageElement | HTMLVideoElement;

export interface MediaSize {
  width: number;
  height: number;
}

/** Intrinsic pixel size of the element, or zeros before it has loaded. */
export function getMediaSize(media: MediaElement): MediaSize {
  if (isVideo(media)) {
    return { width: media.videoWidth, height: media.videoHeight };
  }

  return { width: media.naturalWidth, height: media.naturalHeight };
}

/** True once there are actual pixels to draw. */
export function isMediaReady(media: MediaElement | null | undefined): media is MediaElement {
  if (!media) {
    return false;
  }

  const { width, height } = getMediaSize(media);

  if (width === 0 || height === 0) {
    return false;
  }

  // HAVE_CURRENT_DATA: drawing a video below this paints nothing.
  return !isVideo(media) || media.readyState >= 2;
}

export interface DrawMediaOptions {
  /** Side of the square wedge surface, in device pixels. */
  size: number;
  /** Magnification, about covering the wedge at 1. */
  zoom: number;
  /** Rotation of the media about the wedge apex, in radians. */
  rotation: number;
  /** Drag position, each axis in `[-1, 1]`. */
  pan: { x: number; y: number };
}

/**
 * Draws the media across the wedge surface, centred on the wedge apex.
 *
 * The apex sits at the origin and the sector reaches `size` pixels along both
 * axes, so the media has to cover a `2 * size` square centred there for the
 * wedge to be full whatever the segment count. Centring on the apex also puts
 * the middle of the photo at the middle of the kaleidoscope, which is where a
 * viewer expects to find it.
 *
 * The caller must have translated the context so the apex is at `(0, 0)`.
 */
export function drawMedia(
  ctx: CanvasRenderingContext2D,
  media: MediaElement,
  { size, zoom, rotation, pan }: DrawMediaOptions,
): void {
  const { width, height } = getMediaSize(media);

  if (size <= 0 || width === 0 || height === 0) {
    return;
  }

  const span = size * 2;
  // The scale at which the media just covers the wedge, which is what zoom 1
  // means. The zoom used to be floored there — a photo shrunk below the wedge
  // lets the ground show through — but that made half the pinch's range do
  // nothing at all, and where the picture sits is the viewer's choice to make,
  // edges and all. The mirrors fold whatever is there; bare ground folds too.
  const cover = Math.max(span / width, span / height);
  const scale = cover * Math.max(0.05, zoom);
  const drawWidth = width * scale;
  const drawHeight = height * scale;

  // The drag used to be bounded by the slack outside the covered square, so an
  // edge could never come into view — which at zoom 1 is no travel at all, and
  // read as the drag being broken. Now a full drag moves the picture by the
  // wedge's own reach, plus however much hangs outside it: the edges may come
  // in, and some of the picture always remains over the wedge.
  const slackX = Math.max(0, (drawWidth - span) / 2) + size;
  const slackY = Math.max(0, (drawHeight - span) / 2) + size;
  const offset = { x: clampUnit(pan.x) * slackX, y: clampUnit(pan.y) * slackY };

  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.translate(offset.x, offset.y);
  // Rotating about the apex still covers the wedge: the covered square's
  // inscribed circle has radius `size`, which is the sector's reach.
  ctx.rotate(rotation);
  ctx.drawImage(media, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
  ctx.restore();
}

function isVideo(media: MediaElement): media is HTMLVideoElement {
  return 'videoWidth' in media;
}

function clampUnit(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(-1, value)) : 0;
}
