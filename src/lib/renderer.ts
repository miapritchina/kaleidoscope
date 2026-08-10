import { createChipSprites, type ChipSprites } from './chips';
import { drawMedia, isMediaReady, type MediaElement } from './media';
import { CHAMBER_RADIUS } from './chamber';
import { getPalette, rgbToCss, type Palette } from './palettes';
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
 * What one bounce off a mirror leaves of the light, per channel.
 *
 * Silvered behind glass the light crosses twice, so a few percent goes each
 * time and the red goes fastest — which is why a corridor of mirrors turns
 * green rather than merely grey.
 */
const MIRROR_TINT = { r: 0.958, g: 0.983, b: 0.975 };

/** Stops in the falloff gradient. Enough that the curve reads as smooth. */
const FALLOFF_STOPS = 8;

/**
 * How far each of the six cells in a hexagon strays from the average exposure.
 *
 * Signed: some cells come back brighter than the mean and some dimmer. Fixed
 * rather than random per frame — the mirrors do not move.
 */
const FACET_EXPOSURE = [0.045, -0.03, 0.02, -0.05, 0.035, -0.015];

/** How much a whole hexagon may be lightened relative to its neighbours. */
const CELL_EXPOSURE = 0.06;

/** Width of a mirror join, as a fraction of the triangle's side. */
const SEAM_WIDTH = 0.004;

/** How dark a join is. A cut edge, not a drawn border. */
const SEAM_ALPHA = 0.22;

/** Fraction of the smaller edge the barrel leaves completely clear. */
const VIGNETTE_CLEAR = 0.16;

/** How dark the barrel is at the very corner of the view. */
const VIGNETTE_DEPTH = 0.62;

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

  #falloff: CanvasGradient | null = null;
  #falloffSide = 0;
  #vignetteCache: CanvasGradient | null = null;
  #sprites: ChipSprites | null = null;
  #mode: WedgeMode | null = null;

  /** This frame alone, before it is blended into the trail. */
  readonly #frame: HTMLCanvasElement;
  readonly #frameCtx: CanvasRenderingContext2D | null;

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
    this.#frame = createWedgeCanvas();
    this.#frameCtx = this.#frame.getContext('2d');
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
    this.#frame.width = surface;
    this.#frame.height = surface;

    this.#falloff = null;
    this.#vignetteCache = null;
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
    this.#compositeTiling(palette, triangle);
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
    const ctx = this.#frameCtx;
    // Only the triangle is ever sampled, so the source is painted over its side
    // rather than the whole surface, which is sized for the largest zoom.
    const reach = Math.ceil(triangleSide);
    const size = reach + SEAM_BLEED * 2;

    if (!ctx) {
      return;
    }

    // This frame on its own, painted from scratch over the light. The trail
    // cannot be made by fading this surface part-way back and painting over it
    // again, the way it could when the glass was drawn additively: `multiply`
    // is not idempotent, so the same still pile stamped over its own remains
    // every frame converges on something far darker than one pass of it.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = palette.background;
    ctx.fillRect(0, 0, size, size);

    if (mode === 'media' && media) {
      ctx.save();
      // drawMedia centres on the apex, which sits inside the margin.
      ctx.translate(SEAM_BLEED, SEAM_BLEED);
      drawMedia(ctx, media, {
        size: reach,
        zoom: settings.zoom,
        // A photo has no physics of its own, so it simply turns with the cell,
        // a little behind it.
        rotation: scene.contents,
        pan: scene.drag,
        alpha: 1,
      });
      ctx.restore();
    } else if (mode === 'shards') {
      ctx.save();
      ctx.translate(SEAM_BLEED, SEAM_BLEED);
      // The mirror triangle is inscribed in the object cell, the way a real
      // tube's mirrors span the round chamber at the end of it. Hanging the cell
      // off the corner the six triangles are assembled around instead leaves
      // most of the simulation outside the view, and turning sweeps the pile
      // clean out of it.
      ctx.translate(reach / 2, (reach * Math.sqrt(3)) / 6);
      drawChamber(ctx, scene, {
        // The triangle's circumradius: the cell reaches all three corners and no
        // further, so every chip that is simulated has a chance of being seen.
        scale: reach / Math.sqrt(3) / CHAMBER_RADIUS,
        chipScale: settings.chipSize,
        // The cell turns inside the fixed mirrors. What the glass does within it
        // is the physics' business, not this rotation's.
        rotation: scene.cell,
        pan: {
          x: scene.drag.x * DRAG_CELLS,
          y: scene.drag.y * DRAG_CELLS,
        },
        sprites,
        light: settings.light,
      });
      ctx.restore();
    }

    // Blend it into the surface the mirrors sample. Each frame keeps a share of
    // the ones before it, which is the whole of the trail; at `trails: 0` this
    // is a plain copy. The first frame after a switch of source goes on opaque,
    // since there is nothing underneath worth keeping — and blending onto a
    // surface that has never been painted would leave it half transparent.
    const wedge = this.#wedgeCtx;
    const fresh = mode !== this.#mode;
    this.#mode = mode;

    wedge.setTransform(1, 0, 0, 1, 0, 0);
    wedge.globalCompositeOperation = 'source-over';
    wedge.globalAlpha = fresh ? 1 : 1 - settings.trails;
    wedge.drawImage(this.#frame, 0, 0);
  }

  /**
   * Tiles the field the way a three-mirror tube does.
   *
   * Six mirrored triangles are assembled into one hexagon, and that hexagon is
   * then stamped across the view on the translation lattice. Building the
   * hexagon once and stamping it keeps the per-frame cost at six clipped draws
   * plus one cheap blit per hexagon, however much of the field is on screen.
   */
  #compositeTiling(palette: Palette, side: number): void {
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
    // The mirror framework does not move. Plenty of real kaleidoscopes are built
    // this way: the mirrors are fixed in the barrel and the chamber of glass
    // turns against them on its own bearing. Rotating the whole tiling instead
    // sweeps the figure around the screen, which reads as a picture being spun
    // and drowns the thing actually worth watching — the glass falling.
    ctx.translate(this.#width / 2, this.#height / 2);

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
      // And each hexagon differs from its neighbours as well, or the field
      // would be exactly periodic — six distinct cells, repeated verbatim
      // forever, which is the same tell one step up. Laid down a little
      // transparent lets that cell's share of the light behind it through.
      ctx.globalAlpha = 1 - cellNoise(centre.i, centre.j) * CELL_EXPOSURE;
      ctx.drawImage(hexagon, centre.x - offset, centre.y - offset);
    }

    ctx.globalAlpha = 1;

    this.#drawSeams(side);
    ctx.restore();

    // What the mirrors themselves cost, applied last because it applies to the
    // whole view — the light coming through the gaps as much as the glass.
    const falloff = this.#mirrorFalloff(side);

    if (falloff) {
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = falloff;
      ctx.fillRect(0, 0, this.#width, this.#height);
      ctx.globalCompositeOperation = 'source-over';
    }

    // The throat of the tube, last of all: it is in front of the optics rather
    // than part of them.
    const vignette = this.#vignette();

    if (vignette) {
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, this.#width, this.#height);
    }
  }

  /**
   * The joins between the mirrors.
   *
   * Three mirrors meeting in a tube have edges, and you can see them: a hairline
   * at every triangle boundary, where the silvering stops and the glass is cut.
   * Without them the reflections run into each other so cleanly that the figure
   * reads as a printed pattern rather than something assembled out of parts.
   *
   * Every triangle edge in the tiling lies on one of three families of parallel
   * lines, sixty degrees apart and spaced `side * sqrt(3) / 2` — the height of
   * the triangle. Drawing the three families straight is both exact and cheaper
   * than outlining the triangles, which would stroke every edge twice, once from
   * each side, and leave the joins twice as dark as the rest.
   *
   * Called inside the tiling's own transform, so the joins turn with it.
   */
  #drawSeams(side: number): void {
    const ctx = this.#ctx;
    const spacing = (side * Math.sqrt(3)) / 2;

    if (spacing <= 0) {
      return;
    }

    const reach = Math.hypot(this.#width, this.#height) / 2 + spacing;
    const lines = Math.ceil(reach / spacing);

    ctx.save();
    ctx.lineWidth = Math.max(1, side * SEAM_WIDTH);
    ctx.strokeStyle = `rgb(0 0 0 / ${String(SEAM_ALPHA)})`;
    ctx.beginPath();

    for (let family = 0; family < 3; family += 1) {
      // A rotated copy of the same set of parallel lines. The families meet at
      // sixty degrees, which is what makes the cells triangles.
      const angle = (family * Math.PI) / 3;
      const alongX = Math.cos(angle);
      const alongY = Math.sin(angle);
      // Perpendicular to them, which is the direction they step in.
      const stepX = -alongY;
      const stepY = alongX;

      for (let line = -lines; line <= lines; line += 1) {
        const offsetX = stepX * line * spacing;
        const offsetY = stepY * line * spacing;

        ctx.moveTo(offsetX - alongX * reach, offsetY - alongY * reach);
        ctx.lineTo(offsetX + alongX * reach, offsetY + alongY * reach);
      }
    }

    ctx.stroke();
    ctx.restore();
  }

  /**
   * The throat of the tube.
   *
   * A kaleidoscope is a barrel with an eyehole at one end, so the field of view
   * is a circle and it does not end abruptly — the further off the axis you
   * look, the more of the barrel is in the way. This is that, and it is a
   * separate thing from what the mirrors cost: those dim the light on its way
   * through, this one is in front of them.
   */
  #vignette(): CanvasGradient | null {
    if (this.#vignetteCache) {
      return this.#vignetteCache;
    }

    const centerX = this.#width / 2;
    const centerY = this.#height / 2;

    try {
      const gradient = this.#ctx.createRadialGradient(
        centerX,
        centerY,
        Math.min(this.#width, this.#height) * VIGNETTE_CLEAR,
        centerX,
        centerY,
        this.#radius,
      );
      gradient.addColorStop(0, 'rgb(0 0 0 / 0)');
      gradient.addColorStop(0.55, 'rgb(0 0 0 / 0.11)');
      gradient.addColorStop(0.82, 'rgb(0 0 0 / 0.32)');
      gradient.addColorStop(1, `rgb(0 0 0 / ${String(VIGNETTE_DEPTH)})`);

      this.#vignetteCache = gradient;

      return gradient;
    } catch {
      // jsdom and other partial canvas implementations may not support gradients.
      return null;
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

      // Each cell gets its own exposure. Three mirrors cut and glued by hand
      // are never at exactly sixty degrees to one another and never equally
      // silvered, and the light behind the chamber is not even either — so no
      // two reflections come back at quite the same brightness. Photographs
      // down a real tube show this plainly: the tessellation reads as the
      // facets of a shallow dome, and it is visible in the empty ground
      // between the glass, not only on the glass. Identical cells are most of
      // what makes a rendered one read as a printed pattern.
      const exposure = FACET_EXPOSURE[index]!;

      ctx.fillStyle = exposure > 0 ? 'rgb(255 255 255)' : 'rgb(0 0 0)';
      ctx.globalAlpha = Math.abs(exposure);
      ctx.fillRect(-span, -span, span * 2, span * 2);
      ctx.globalAlpha = 1;
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

  /**
   * What the mirrors take out of the light, as a gradient to multiply the view
   * by.
   *
   * A mirror is not free. Each bounce loses a few percent, and it loses it
   * unevenly: a household mirror is silvered behind a sheet of glass the light
   * has to cross twice, and glass absorbs red, which is why the far end of a
   * corridor of mirrors is green. The cell you are looking straight down has
   * taken no bounces; every cell further out has taken more, so the view is
   * brightest and truest on the axis and goes progressively dimmer and greener
   * towards the rim.
   *
   * That count is what sets the shape of this. Neighbouring cells sit one
   * lattice step apart and a step is two reflections, so a point `r` out from
   * the middle has been through about `2r / (side * sqrt(3))` of them.
   *
   * Cached: the stops only move when the triangle or the viewport does.
   */
  #mirrorFalloff(side: number): CanvasGradient | null {
    if (this.#falloff && this.#falloffSide === side) {
      return this.#falloff;
    }

    const centerX = this.#width / 2;
    const centerY = this.#height / 2;

    try {
      const gradient = this.#ctx.createRadialGradient(
        centerX,
        centerY,
        0,
        centerX,
        centerY,
        this.#radius,
      );
      const step = side * Math.sqrt(3);

      for (let stop = 0; stop <= FALLOFF_STOPS; stop += 1) {
        const at = stop / FALLOFF_STOPS;
        const bounces = step > 0 ? (2 * at * this.#radius) / step : 0;

        gradient.addColorStop(
          at,
          rgbToCss({
            r: 255 * MIRROR_TINT.r ** bounces,
            g: 255 * MIRROR_TINT.g ** bounces,
            b: 255 * MIRROR_TINT.b ** bounces,
          }),
        );
      }

      this.#falloff = gradient;
      this.#falloffSide = side;

      return gradient;
    } catch {
      // jsdom and other partial canvas implementations may not support gradients.
      return null;
    }
  }
}

/**
 * A fixed, evenly spread value in `[0, 1)` for the hexagon at `(i, j)`.
 *
 * An integer hash rather than a seeded generator: this is wanted per hexagon
 * per frame, in any order, and it has to give the same answer for the same cell
 * every time or the field would shimmer as it is panned across.
 */
function cellNoise(i: number, j: number): number {
  let hash = Math.imul(i, 0x27d4eb2d) ^ Math.imul(j, 0x165667b1);
  hash = Math.imul(hash ^ (hash >>> 15), 0x2545f491);
  hash ^= hash >>> 13;

  return (hash >>> 0) / 4294967296;
}

function defaultCanvas(): HTMLCanvasElement {
  return document.createElement('canvas');
}
