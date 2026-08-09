import { createChipSprites, type ChipSprites } from './chips';
import { drawMedia, isMediaReady, type MediaElement } from './media';
import { CHAMBER_RADIUS } from './chamber';
import { getPalette, type Palette } from './palettes';
import { DRAG_CELLS, drawChamber, type Scene } from './scene';
import { LIMITS, type Settings } from './settings';
import { coverWithHexagons, hexLattice, traceHexagon, traceTriangle } from './tiling';

/** Which source last painted the wedge, so a switch can clear it. */
type WedgeMode = 'shards' | 'media' | 'empty';

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
 * Side of the mirror triangle, as a fraction of the smaller viewport edge.
 *
 * A real three-mirror tube shows a handful of hexagons across the view rather
 * than one enormous one; this puts roughly two and a half across at zoom 1.
 */
const TRIANGLE_FRACTION = 0.24;

/**
 * Composites the kaleidoscope.
 *
 * The source — shard field, photo or camera — is painted once per frame into an
 * offscreen triangle, then that triangle is mirrored into a hexagon and the
 * hexagon stamped across the field. That keeps the per-frame cost proportional
 * to the source rather than to `source x triangles`, and it is what makes the
 * reflections line up exactly.
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
  readonly #hexagon: HTMLCanvasElement;
  readonly #hexagonCtx: CanvasRenderingContext2D | null;

  #vignette: CanvasGradient | null = null;
  #sprites: ChipSprites | null = null;
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
    this.#hexagon = createWedgeCanvas();
    this.#hexagonCtx = this.#hexagon.getContext('2d');
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
    // Cover the corners: the tiling has to reach past the circumscribed circle.
    this.#radius = Math.ceil(Math.hypot(width, height) / 2);

    this.#canvas.width = width;
    this.#canvas.height = height;
    // Sized for the largest triangle the zoom range can ask for, so a zoom
    // change never has to reallocate — and never overruns the surface either.
    // The margin around the apex is what lets the bled clip find painted pixels
    // there rather than empty canvas, which would leave the seam showing.
    const surface = Math.ceil(this.#maxTriangleSide()) + SEAM_BLEED * 2;
    this.#wedge.width = surface;
    this.#wedge.height = surface;

    this.#vignette = this.#createVignette();
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

    const triangle = this.#triangleSide(settings);

    const palette = getPalette(settings.paletteId);
    const sprites = this.#sprites?.palette === palette ? this.#sprites : createChipSprites(palette);
    this.#sprites = sprites;

    const frame = settings.source === 'shards' ? null : media;
    const mode: WedgeMode =
      settings.source === 'shards' ? 'shards' : isMediaReady(frame) ? 'media' : 'empty';

    this.#paintWedge(scene, settings, palette, sprites, mode, frame ?? null, triangle);
    this.#compositeTiling(scene, palette, triangle);
  }

  /** Side of the mirror triangle in device pixels. */
  #triangleSide(settings: Settings): number {
    return this.#sideAtZoom(settings.zoom);
  }

  /** The largest side the zoom slider can reach, for sizing the surfaces. */
  #maxTriangleSide(): number {
    return this.#sideAtZoom(LIMITS.zoom.max);
  }

  #sideAtZoom(zoom: number): number {
    return Math.max(24, Math.min(this.#width, this.#height) * TRIANGLE_FRACTION * zoom);
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
    sprites: ChipSprites,
    mode: WedgeMode,
    media: MediaElement | null,
    triangleSide: number,
  ): void {
    const ctx = this.#wedgeCtx;
    // Only the triangle is ever sampled, so the source is painted over its side
    // rather than the whole surface, which is sized for the largest zoom.
    const reach = Math.ceil(triangleSide);
    const size = reach + SEAM_BLEED * 2;

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
        size: reach,
        zoom: settings.zoom,
        rotation: scene.contents - scene.tube,
        pan: scene.drag,
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

    ctx.save();
    // Match the media path: the apex is the origin the chamber sits on.
    ctx.translate(SEAM_BLEED, SEAM_BLEED);
    drawChamber(ctx, scene, {
      // The chamber spans the triangle's side, so the mirrors cut the chips and
      // each one continues into its own reflection.
      scale: reach / CHAMBER_RADIUS,
      // Drawn at their physical size, so what collides is what you see.
      chipScale: settings.chipSize,
      // The chamber is bolted to the tube, so it does not turn within it. Only
      // media, which has no physics of its own, keeps the lag.
      rotation: 0,
      pan: {
        x: scene.drag.x * DRAG_CELLS,
        y: scene.drag.y * DRAG_CELLS,
      },
      sprites,
      glow: settings.glow,
    });
    ctx.restore();
  }

  /**
   * Tiles the field the way a three-mirror tube does.
   *
   * Six mirrored triangles are assembled into one hexagon, and that hexagon is
   * then stamped across the view on the translation lattice. Building the
   * hexagon once and stamping it keeps the per-frame cost at six clipped draws
   * plus one cheap blit per hexagon, however much of the field is on screen.
   */
  #compositeTiling(scene: Scene, palette: Palette, side: number): void {
    const ctx = this.#ctx;
    const hexagon = this.#buildHexagon(palette, side);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = palette.background;
    ctx.fillRect(0, 0, this.#width, this.#height);

    if (!hexagon) {
      return;
    }

    ctx.save();
    // Turning the tube turns the whole tiling with it.
    ctx.translate(this.#width / 2, this.#height / 2);
    ctx.rotate(scene.tube);

    const lattice = hexLattice(side);
    // A rotated rectangle fits inside the circle through its corners, so cover
    // that: cheaper than re-deriving the bounds for every angle.
    const reach = Math.hypot(this.#width, this.#height) / 2;
    const centres = coverWithHexagons(
      { minX: -reach, maxX: reach, minY: -reach, maxY: reach },
      lattice,
    );
    const offset = hexagon.width / 2;

    for (const centre of centres) {
      ctx.drawImage(hexagon, centre.x - offset, centre.y - offset);
    }

    ctx.restore();

    if (this.#vignette) {
      ctx.fillStyle = this.#vignette;
      ctx.fillRect(0, 0, this.#width, this.#height);
    }
  }

  /**
   * Assembles the six mirrored triangles into one hexagon.
   *
   * Kept transparent outside the hexagon so the stamps tile without their
   * rectangular corners painting over their neighbours.
   */
  #buildHexagon(palette: Palette, side: number): HTMLCanvasElement | null {
    const span = Math.ceil((side + SEAM_BLEED) * 2);
    const cell = this.#hexagon;

    if (cell.width !== span) {
      cell.width = span;
      cell.height = span;
    }

    const ctx = this.#hexagonCtx;

    if (!ctx) {
      return null;
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, span, span);
    ctx.save();
    ctx.translate(span / 2, span / 2);

    for (let index = 0; index < 6; index += 1) {
      ctx.save();
      traceTriangle(ctx, side, index, SEAM_BLEED);
      ctx.clip();
      // The wedge surface holds the source with its apex inside the margin.
      ctx.drawImage(this.#wedge, -SEAM_BLEED, -SEAM_BLEED);
      ctx.restore();
    }

    ctx.restore();

    // Trim the bleed back to the true hexagon, so neighbouring stamps meet
    // exactly rather than overlapping by a couple of pixels all round.
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.translate(span / 2, span / 2);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.fillStyle = palette.background;
    traceHexagon(ctx, side + SEAM_BLEED / 2);
    ctx.fill();
    ctx.restore();

    return cell;
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
