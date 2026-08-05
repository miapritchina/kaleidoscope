import { createColorRamp, type ColorRamp } from './colorRamp';
import { drawMedia, isMediaReady, type MediaElement } from './media';
import { getPalette, type Palette } from './palettes';
import { drawCell, type Scene } from './scene';
import type { Settings } from './settings';

/** Which source last painted the wedge, so a switch can clear it. */
type WedgeMode = 'shards' | 'media' | 'empty';

/**
 * Size of the object cell relative to the mirror length, at `zoom: 1`.
 *
 * Real kaleidoscopes hold a small chamber of chips against long mirrors, so the
 * wedge shows the cell several times over. A cell as large as the wedge would
 * leave a few oversized shapes floating in empty space instead of a pattern.
 */
const BASE_CELL_FRACTION = 0.32;

/**
 * How far each wedge's clip is bled outwards, in device pixels.
 *
 * Two antialiased clip edges meeting at a seam each cover the boundary pixel
 * about halfway, and compositing them one after another reaches only ~75% —
 * the backdrop shows through as a dark spoke. Bleeding past the seam lets a
 * neighbour cover it completely.
 */
const SEAM_BLEED = 2;

/**
 * Composites the kaleidoscope.
 *
 * The source — shard field, photo or camera — is painted once per frame into an
 * offscreen wedge, then the wedge is blitted around the centre with alternating
 * mirrors. That keeps the per-frame cost proportional to the source rather than
 * to `source x segments`, and it is what makes the reflections line up exactly.
 *
 * All geometry is in device pixels; the canvas backing store is sized by
 * {@link KaleidoscopeRenderer.resize} and never scaled by the DPR, which avoids
 * compounding transforms.
 */
export class KaleidoscopeRenderer {
  readonly #canvas: HTMLCanvasElement;
  readonly #ctx: CanvasRenderingContext2D;
  readonly #wedge: HTMLCanvasElement;
  readonly #wedgeCtx: CanvasRenderingContext2D;

  #width = 0;
  #height = 0;
  #radius = 0;
  #vignette: CanvasGradient | null = null;
  #ramp: ColorRamp | null = null;
  #mode: WedgeMode | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    createWedgeCanvas: () => HTMLCanvasElement = defaultCanvas,
  ) {
    const ctx = canvas.getContext('2d', { alpha: false });
    const wedge = createWedgeCanvas();
    const wedgeCtx = wedge.getContext('2d');

    if (!ctx || !wedgeCtx) {
      throw new Error('Canvas 2D context is unavailable in this environment');
    }

    this.#canvas = canvas;
    this.#ctx = ctx;
    this.#wedge = wedge;
    this.#wedgeCtx = wedgeCtx;
  }

  /** Backing-store size in device pixels. */
  get size(): { width: number; height: number } {
    return { width: this.#width, height: this.#height };
  }

  /**
   * Resizes the backing stores.
   *
   * @param cssWidth Layout width in CSS pixels.
   * @param cssHeight Layout height in CSS pixels.
   * @param dpr Device pixel ratio, clamped internally to keep large displays
   *   from quadrupling the fill cost for no visible gain.
   */
  resize(cssWidth: number, cssHeight: number, dpr = 1): void {
    const ratio = Math.min(Math.max(dpr, 1), 2);
    const width = Math.max(1, Math.round(cssWidth * ratio));
    const height = Math.max(1, Math.round(cssHeight * ratio));

    if (width === this.#width && height === this.#height) {
      return;
    }

    this.#width = width;
    this.#height = height;
    // Cover the corners: the wedges have to reach past the circumscribed circle.
    this.#radius = Math.ceil(Math.hypot(width, height) / 2);

    this.#canvas.width = width;
    this.#canvas.height = height;
    // The wedge surface carries a margin around its apex so that the bled clip
    // finds painted pixels there rather than empty canvas, which would defeat
    // the whole point and leave the seam showing.
    this.#wedge.width = this.#radius + SEAM_BLEED * 2;
    this.#wedge.height = this.#radius + SEAM_BLEED * 2;

    this.#vignette = this.#createVignette();
    this.#ramp = null; // The gradient cache is tied to the old geometry.
  }

  /**
   * Draws one frame. Call after {@link resize} and after advancing the scene.
   *
   * @param media Photo or camera element to mirror instead of the shard field.
   *   Ignored unless `settings.source` selects it, and skipped until it has
   *   pixels — a source that is chosen but not ready renders as the backdrop.
   */
  render(scene: Scene, settings: Settings, media?: MediaElement | null): void {
    if (this.#width === 0 || this.#height === 0) {
      return;
    }

    const palette = getPalette(settings.paletteId);
    const ramp = this.#ramp?.palette === palette ? this.#ramp : createColorRamp(palette);
    this.#ramp = ramp;

    const frame = settings.source === 'shards' ? null : media;
    const mode: WedgeMode =
      settings.source === 'shards' ? 'shards' : isMediaReady(frame) ? 'media' : 'empty';

    this.#paintWedge(scene, settings, palette, ramp, mode, frame ?? null);
    this.#composite(scene, settings, palette);
  }

  /** Serialises the current frame, e.g. for a download link. */
  toDataUrl(type = 'image/png'): string {
    return this.#canvas.toDataURL(type);
  }

  /** Paints the chosen source into the offscreen wedge surface. */
  #paintWedge(
    scene: Scene,
    settings: Settings,
    palette: Palette,
    ramp: ColorRamp,
    mode: WedgeMode,
    media: MediaElement | null,
  ): void {
    const ctx = this.#wedgeCtx;
    // Paint the whole surface, margin included.
    const size = this.#radius + SEAM_BLEED * 2;

    // Switching sources would otherwise leave the previous one ghosting under
    // the new frames, since neither path clears unconditionally.
    if (mode !== this.#mode) {
      this.#mode = mode;
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.fillStyle = palette.background;
      ctx.fillRect(0, 0, size, size);
      ctx.restore();
    }

    if (mode === 'media' && media) {
      // Media covers the surface opaquely, so trails come from drawing each
      // frame semi-transparently over its predecessors rather than from fading
      // towards the backdrop.
      ctx.save();
      // drawMedia centres on the apex, which sits inside the margin.
      ctx.translate(SEAM_BLEED, SEAM_BLEED);
      drawMedia(ctx, media, {
        size: this.#radius,
        zoom: settings.zoom,
        pan: scene.pointer,
        alpha: 1 - settings.trails,
      });
      ctx.restore();
      return;
    }

    // Fading instead of clearing is what produces motion trails; at `trails: 0`
    // the fill is fully opaque and this is an ordinary clear.
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1 - settings.trails;
    ctx.fillStyle = palette.background;
    ctx.fillRect(0, 0, size, size);
    ctx.restore();

    if (mode === 'empty') {
      return;
    }

    drawCell(ctx, scene, {
      size,
      cellSize: size * BASE_CELL_FRACTION * settings.zoom,
      ramp,
      glow: settings.glow,
    });
  }

  /** Mirrors the wedge around the centre. */
  #composite(scene: Scene, settings: Settings, palette: Palette): void {
    const ctx = this.#ctx;
    const segments = Math.max(4, Math.round(settings.segments / 2) * 2);
    const step = (Math.PI * 2) / segments;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = palette.background;
    ctx.fillRect(0, 0, this.#width, this.#height);

    ctx.save();
    ctx.translate(this.#width / 2, this.#height / 2);
    ctx.rotate(scene.rotation);

    for (let i = 0; i < segments; i += 1) {
      ctx.save();

      // Even wedges are rotated copies; odd wedges are mirrored across the
      // shared edge, so neighbouring wedges always meet edge to edge.
      if (i % 2 === 0) {
        ctx.rotate(i * step);
      } else {
        ctx.rotate((i + 1) * step);
        ctx.scale(1, -1);
      }

      this.#clipWedge(step);
      // Line the surface's apex up with the centre, discounting the margin.
      ctx.drawImage(this.#wedge, -SEAM_BLEED, -SEAM_BLEED);

      ctx.restore();
    }

    ctx.restore();

    if (this.#vignette) {
      ctx.fillStyle = this.#vignette;
      ctx.fillRect(0, 0, this.#width, this.#height);
    }
  }

  /**
   * Clips to one wedge, bled outwards by {@link SEAM_BLEED} pixels.
   *
   * Two antialiased edges meeting at the same angle each cover the boundary
   * pixel partially, and compositing them one after another leaves a visible
   * dark spoke. Pulling the apex back along the bisector offsets both straight
   * edges outwards by a constant pixel amount — unlike widening the angle,
   * which bleeds generously at the rim and not at all near the centre, where
   * the seams converge and show most. Neighbouring wedges are mirror images, so
   * the sliver of overlap matches what it covers.
   */
  #clipWedge(step: number): void {
    const ctx = this.#ctx;
    const half = step / 2;
    const apex = SEAM_BLEED / Math.sin(half);
    const angleBleed = SEAM_BLEED / this.#radius;

    ctx.beginPath();
    ctx.moveTo(-Math.cos(half) * apex, -Math.sin(half) * apex);
    ctx.arc(0, 0, this.#radius + SEAM_BLEED, -angleBleed, step + angleBleed);
    ctx.closePath();
    ctx.clip();
  }

  #createVignette(): CanvasGradient | null {
    const centerX = this.#width / 2;
    const centerY = this.#height / 2;
    const inner = Math.min(this.#width, this.#height) * 0.25;

    try {
      const gradient = this.#ctx.createRadialGradient(
        centerX,
        centerY,
        inner,
        centerX,
        centerY,
        this.#radius,
      );
      gradient.addColorStop(0, 'rgb(0 0 0 / 0)');
      gradient.addColorStop(0.65, 'rgb(0 0 0 / 0.18)');
      gradient.addColorStop(1, 'rgb(0 0 0 / 0.6)');

      return gradient;
    } catch {
      // jsdom and other partial canvas implementations may not support gradients.
      return null;
    }
  }
}

function defaultCanvas(): HTMLCanvasElement {
  return document.createElement('canvas');
}
