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
  /** Magnification. Values below 1 are ignored — see the note in the body. */
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
  // Zooming out would shrink the media below the wedge and let the backdrop
  // show through the gaps, so cover is the floor. A photo has edges; the shard
  // field, which tiles, has none — that is why only this path clamps.
  const cover = Math.max(span / width, span / height);
  const scale = cover * Math.max(1, zoom);
  const drawWidth = width * scale;
  const drawHeight = height * scale;

  // Whatever hangs outside the covered square is how far the pointer can pan
  // before it would drag an edge into view.
  const slackX = Math.max(0, (drawWidth - span) / 2);
  const slackY = Math.max(0, (drawHeight - span) / 2);

  // The viewer drags in screen space, so the offset is applied there — before
  // the rotation — rather than along the media's own axes, which would send it
  // off at whatever angle the spin had reached.
  //
  // The slack, though, is defined along those axes, so the offset is clamped in
  // the media's frame and brought back. Clamping in screen space instead would
  // let a diagonal drag pull an edge into the wedge once rotated.
  const wanted = { x: clampUnit(pan.x) * slackX, y: clampUnit(pan.y) * slackY };
  const inMediaFrame = rotate(wanted, -rotation);
  const allowed = {
    x: clamp(inMediaFrame.x, slackX),
    y: clamp(inMediaFrame.y, slackY),
  };
  const offset = rotate(allowed, rotation);

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

function clamp(value: number, limit: number): number {
  return Math.min(limit, Math.max(-limit, value));
}

function rotate(vector: { x: number; y: number }, angle: number): { x: number; y: number } {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  return { x: vector.x * cos - vector.y * sin, y: vector.x * sin + vector.y * cos };
}
