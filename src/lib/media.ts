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
  /**
   * What "covered" means, in device pixels.
   *
   * At zoom 1 the picture covers a `2 * size` square centred on the origin,
   * and a full drag moves it by this much on top of whatever hangs outside.
   * Two jobs for one number because they are the same judgement: how big the
   * picture is, and how far it may be pushed about.
   */
  size: number;
  /** Magnification, about covering that square at 1. */
  zoom: number;
  /** Rotation of the media about the origin, in radians. */
  rotation: number;
  /** Drag position, each axis in `[-1, 1]`. */
  pan: { x: number; y: number };
  /**
   * How far from the origin has to come out painted, in device pixels.
   *
   * What the caller will actually look at, which is not the same as how big
   * the picture is drawn: shrunk below cover, or dragged until an edge came
   * in, the surface would show bare ground past the picture — so the picture
   * is repeated in mirror out to here and there is no edge to fall off.
   * Left out, the covered square's own far corner.
   */
  reach?: number;
}

/**
 * Draws the media about the origin, covering a `2 * size` square.
 *
 * The caller decides what the origin is. In a kaleidoscope it is the middle of
 * the chamber, which is where the middle of a picture belongs — the optics are
 * built around that point, so a picture centred anywhere else is a picture seen
 * through the edge of the lens.
 */
export function drawMedia(
  ctx: CanvasRenderingContext2D,
  media: MediaElement,
  { size, zoom, rotation, pan, reach = size * Math.SQRT2 }: DrawMediaOptions,
): void {
  const { width, height } = getMediaSize(media);

  if (size <= 0 || width === 0 || height === 0) {
    return;
  }

  const span = size * 2;
  // The scale at which the media just covers the wedge, which is what zoom 1
  // means. The zoom used to be floored there — but that made half the pinch's
  // range do nothing at all, and where the picture sits is the viewer's
  // choice to make. Past its edges the picture continues as its own mirror
  // image — see the tiling below — so there is nothing to protect it from.
  const cover = Math.max(span / width, span / height);
  const scale = cover * Math.max(0.05, zoom);
  const drawWidth = width * scale;
  const drawHeight = height * scale;

  // The drag used to be bounded by the slack outside the covered square, so an
  // edge could never come into view — which at zoom 1 is no travel at all, and
  // read as the drag being broken. Now a full drag moves the picture by the
  // wedge's own reach, plus however much hangs outside it: an edge dragged in
  // simply continues as the picture's reflection.
  const slackX = Math.max(0, (drawWidth - span) / 2) + size;
  const slackY = Math.max(0, (drawHeight - span) / 2) + size;
  const offset = { x: clampUnit(pan.x) * slackX, y: clampUnit(pan.y) * slackY };

  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.translate(offset.x, offset.y);
  ctx.rotate(rotation);

  // The picture continues past its own edges as its mirror image, the way the
  // mirrors continue everything else. Shrunk below cover, or dragged until an
  // edge came in, the surface used to show bare ground past the picture — and
  // the bead, whose samples range over the whole mirrored disc, brought that
  // ground back as a pale hole at every rosette centre. Tiled in mirror there
  // is no edge to fall off, whatever the zoom, the drag and the bead ask for.
  //
  // How far the tiling has to reach from the picture's own centre: whatever
  // the caller says has to come out painted, plus however far the picture has
  // been dragged away from that. A circle, so the rotation cannot change the
  // answer.
  const covered = reach + Math.hypot(offset.x, offset.y);
  const across = Math.max(0, Math.ceil((covered - drawWidth / 2) / drawWidth));
  const down = Math.max(0, Math.ceil((covered - drawHeight / 2) / drawHeight));

  const stamp = (i: number, j: number) => {
    ctx.save();
    ctx.translate(i * drawWidth, j * drawHeight);
    // Odd neighbours are reflections, so every shared edge continues into its
    // neighbour without a seam — the same rule the mirror triangles follow.
    ctx.scale(i % 2 === 0 ? 1 : -1, j % 2 === 0 ? 1 : -1);
    ctx.drawImage(media, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
    ctx.restore();
  };

  // The picture itself first, then its reflections around it.
  stamp(0, 0);

  for (let j = -down; j <= down; j += 1) {
    for (let i = -across; i <= across; i += 1) {
      if (i !== 0 || j !== 0) {
        stamp(i, j);
      }
    }
  }

  ctx.restore();
}

function isVideo(media: MediaElement): media is HTMLVideoElement {
  return 'videoWidth' in media;
}

function clampUnit(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(-1, value)) : 0;
}
