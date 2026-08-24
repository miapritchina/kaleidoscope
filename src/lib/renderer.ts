import { createChipSprites, type ChipSprites } from './chips';
import { Compositor } from './compositor';
import { drawMedia, isMediaReady, type MediaElement } from './media';
import { CHAMBER_RADIUS } from './chamber';
import { GROUND, rgbToCss } from './color';
import {
  applyCutShape,
  DRAG_CELLS,
  drawChamber,
  SKIN_PATCH,
  type Glass,
  type Scene,
} from './scene';
import { createSkinPatches, measureSource, type SkinPatches } from './skin';
import { isChamberSource, LIMITS, type Settings } from './settings';
import {
  coverWithHexagons,
  frameworkRadians,
  hexLattice,
  traceHexagon,
  traceTriangle,
  triangleCentre,
} from './tiling';

/** Which source last painted the wedge, so a switch can clear it. */
type WedgeMode = 'chamber' | 'media' | 'empty';

/**
 * Everything the wedge is painted from.
 *
 * Kept after a frame so the same source can be painted again at a different
 * size — which is what an exported tile needs, since its size is fixed and the
 * triangle on screen is whatever the viewport and the slider make it.
 */
interface WedgeSource {
  scene: Scene;
  settings: Settings;
  sprites: ChipSprites;
  mode: WedgeMode;
  media: MediaElement | null;
  /** The sets of glass loaded into the chamber, each scored once. */
  glasses: readonly Glass[];
}

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
 * Where the triangle's apex sits on the wedge surface, for a given side.
 *
 * The seam bleed on every edge, plus headroom *above* the apex for the bead.
 * The bead samples by inversion about the triangle's centre, so the point it
 * asks for on behalf of the top corner is that corner reflected through the
 * centre — which lands above the apex by exactly the centre's own height, the
 * inradius. Without painted ground there, every rosette centre grew a blank
 * patch: all the pixels around the apex clamped onto the same unpainted spot
 * and came back as one flat hole. Only the top needs the room — the inverted
 * triangle's other reaches stay within the old square.
 */
function wedgeApex(side: number): { x: number; y: number } {
  return { x: SEAM_BLEED, y: SEAM_BLEED + Math.ceil(triangleCentre(side).y) };
}

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

/**
 * How far apart the channels are pulled at the very rim, in device pixels.
 *
 * Glass disperses, and a tube of it disperses most where the light crosses it
 * most steeply, which is why the outer reflections in a photograph down a real
 * kaleidoscope have coloured edges and the middle does not. Small on purpose:
 * enough to see at the rim of a phone and never enough to read as a fault.
 *
 * Costs two extra folds on every pixel that shows it, so it is a shader-only
 * effect — the 2D path leaves it out rather than faking it.
 */
const RIM_DISPERSION = 1.4;

/**
 * How far apart the flakes of glitter are, as a fraction of the triangle.
 *
 * One flake to a square of this side. Fine enough that a hexagon holds a few
 * hundred, coarse enough that two never land on the same pixel — and tied to
 * the triangle rather than to the screen, so zooming in magnifies the glitter
 * along with everything else instead of leaving it a constant screen-sized
 * speckle, which is the tell of an effect laid over a picture.
 */
const GLITTER_GRAIN = 0.035;

/**
 * How far the room's light tips away from straight ahead.
 *
 * A phone lying flat under a ceiling light is looking straight up it; held over
 * at an angle, the light arrives across the glass. This is how much of that
 * travel a full tip is worth, and it is what turns a tilt into a wave of
 * flashes rather than a uniform brightening.
 */
const LIGHT_THROW = 0.55;

/** How dark the barrel is at the very corner of the view. */
const VIGNETTE_DEPTH = 0.62;

/** Ink for the mirror triangle in debug mode. */
const DEBUG_INK = 'rgb(230 20 20)';

/** Ink for the gravity arrow. */
const DEBUG_GRAVITY = 'rgb(20 90 255)';

/** What every debug stroke is underlaid with, so it reads over any picture. */
const DEBUG_HALO_INK = 'rgb(255 255 255 / 0.85)';

/** Width of a debug line, as a fraction of the triangle's side. */
const DEBUG_WIDTH = 0.022;

/**
 * How much wider the pale underlay is than the line it carries.
 *
 * The overlay lies over a picture that could be any colour, including its own,
 * so every stroke is drawn twice: once broad and pale, once narrow and
 * coloured. A hairline in one ink is legible over half the pictures it might
 * land on, which is no use in a thing whose only job is to be seen.
 */
const DEBUG_HALO = 2.6;

/** Length of the gravity arrow, as a fraction of the smaller viewport edge. */
const DEBUG_ARROW = 0.18;

/**
 * Pixel size of the exported tile: one period of the figure.
 *
 * The proportions have to be `sqrt(3)` to 1 — see `latticePeriod` — and pixels
 * are whole numbers, so the closest useful rational is used instead. 1351/780
 * is out by two parts in ten million, which over the whole width comes to three
 * ten-thousandths of a pixel.
 */
export const TILE = { width: 1351, height: 780 };

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

  readonly #createCanvas: () => HTMLCanvasElement;
  #tile: HTMLCanvasElement | null = null;
  #source: WedgeSource | null = null;

  // One score per picture, kept until the picture itself changes. Keyed by the
  // element so several sets can be scored at once and each is only worked once,
  // however the chosen mix is toggled about.
  readonly #patchCache = new Map<
    CanvasImageSource,
    { patches: SkinPatches | null; stamp: string }
  >();

  /**
   * The shader, where there is one.
   *
   * Built on the first frame rather than in the constructor: a renderer is
   * made before it has a size, and asking for a WebGL context costs a real
   * allocation on the GPU that a test which never draws should not pay.
   */
  #shader: Compositor | null = null;
  #shaderTried = false;

  /** Which glass and which scene the pieces were last sized against. */
  #girthGlasses: readonly Glass[] = [];
  #girthOn: Scene | null = null;

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
    this.#createCanvas = createWedgeCanvas;
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
    // there rather than empty canvas, which would leave the seam showing; the
    // extra height above is the bead's headroom — see wedgeApex.
    const largest = Math.ceil(this.#maxTriangleSide());

    this.#resizeWedge(largest + SEAM_BLEED * 2, largest + SEAM_BLEED + wedgeApex(largest).y);

    this.#falloff = null;
    this.#vignetteCache = null;
  }

  /**
   * Draws one frame. Call after {@link resize} and after advancing the scene.
   *
   * @param media Photo or camera element to mirror instead of the shard field.
   *   Ignored unless `settings.source` selects it, and skipped until it has
   *   pixels — a source that is chosen but not ready renders as the backdrop.
   * @param skins The chosen object sets' pictures, which the pieces are cut out
   *   of and shared across — see `lib/skin.ts`. Any that are not loaded yet are
   *   left out of the mix; none loaded, the chamber comes up empty. Separate
   *   from `media`, which the mirrors repeat: the two are independent, so the
   *   objects can come out of one picture while the mirrors repeat another.
   */
  render(
    scene: Scene,
    settings: Settings,
    media?: MediaElement | null,
    skins?: readonly MediaElement[] | null,
  ): void {
    if (this.#width === 0 || this.#height === 0) {
      return;
    }

    const triangle = this.#triangleSide(settings);

    // Shapes and lighting only, and neither depends on a setting, so they are
    // built once and kept.
    this.#sprites ??= createChipSprites();
    const sprites = this.#sprites;

    const chamber = isChamberSource(settings.source);
    const frame = chamber ? null : media;
    const mode: WedgeMode = chamber ? 'chamber' : isMediaReady(frame) ? 'media' : 'empty';

    // Every chosen set that has pixels yet, scored once each and kept — see
    // #patchesOf. A set still loading is simply not in the mix until it lands,
    // and none loaded leaves the chamber empty rather than full of shapes
    // nobody chose.
    const glasses: Glass[] = (skins ?? [])
      .filter((item): item is MediaElement => isMediaReady(item))
      .map((skin) => ({ skin, patches: this.#patchesOf(skin) }));

    // What each piece is cut to is what it should collide on, and that is
    // settled by the glass rather than by the frame. Applied here because
    // this is where the two meet: the scene knows nothing about pictures and
    // the pictures know nothing about the scene.
    if (this.#girthOn !== scene || !sameGlasses(this.#girthGlasses, glasses)) {
      this.#girthGlasses = glasses;
      this.#girthOn = scene;
      applyCutShape(scene.shards, glasses);
    }

    const source: WedgeSource = {
      scene,
      settings,
      sprites,
      mode,
      media: frame ?? null,
      glasses,
    };

    const framework = frameworkRadians(settings.angle);

    this.#source = source;
    this.#paintWedge(source, triangle);
    this.#compositeTiling(triangle, framework, settings, scene.tilt);

    if (settings.debug) {
      this.#drawDebug(triangle, scene.tilt, framework);
    }
  }

  /**
   * Where in the skin each piece is cut from, scored once per picture.
   *
   * Kept until the picture itself changes. A camera frame changes every frame
   * and is not rescored for each one: reading a canvas back is a pipeline stall,
   * and a live feed is interesting all over anyway — the scoring is there for a
   * still of a subject on a plain backdrop, which is what a picked photo
   * usually is.
   */
  #patchesOf(skin: CanvasImageSource): SkinPatches | null {
    const size = measureSource(skin);
    const stamp = `${String(size.width)}x${String(size.height)}`;
    const cached = this.#patchCache.get(skin);

    if (cached?.stamp === stamp) {
      return cached.patches;
    }

    const patches = createSkinPatches(skin, { patch: SKIN_PATCH });
    this.#patchCache.set(skin, { patches, stamp });

    return patches;
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

  /**
   * Renders a tile that repeats without a seam: one period of the field.
   *
   * It is a rectangle cut straight out of the figure, the way you would cut one
   * out of the screen. Nothing is mirrored and no edges are blended — a
   * `sqrt(3)`-to-1 rectangle is a translation period of a hexagonal tiling, so
   * a copy laid beside it continues the pattern because it is the pattern. See
   * `latticePeriod` for why those proportions and no others.
   *
   * Three things the screen has are left out, all of them for the same reason:
   * each one varies across the view, so baked into a tile it would come back at
   * every repeat as a visible grid.
   *
   * - The barrel and the mirror falloff, which are radial. They describe
   *   looking down a tube, not the pattern, and would put a dark blot in the
   *   middle of every copy.
   * - The per-hexagon exposure, which is deliberately aperiodic on screen — it
   *   is there to stop the field reading as a printed pattern. Here a printed
   *   pattern is the point, and it is the one thing standing between the field
   *   and an exact repeat. The variation between the six cells of a hexagon
   *   stays, so the tile still has facets; only the difference between one
   *   hexagon and the next goes.
   *
   * The source is painted again at the tile's own size rather than scaled up
   * from the screen, so the tile is as sharp as the pieces themselves are.
   * Returns `null` before the first frame, since there is nothing to cut.
   */
  toPatternBlob(type = 'image/png'): Promise<Blob | null> {
    const source = this.#source;

    if (!source) {
      return Promise.resolve(null);
    }

    this.#tile ??= this.#createCanvas();

    const tile = this.#tile;

    tile.width = TILE.width;
    tile.height = TILE.height;

    const tileCtx = tile.getContext('2d');

    if (!tileCtx) {
      return Promise.resolve(null);
    }

    // The triangle whose period is exactly the tile.
    const side = TILE.width / 3;
    const painted = { width: this.#wedge.width, height: this.#wedge.height };

    // Grown for this one painting and put back after: the screen's surface is
    // sized for the largest triangle the slider can ask for, which on a small
    // window is smaller than the tile wants.
    this.#resizeWedge(
      Math.ceil(side) + SEAM_BLEED * 2,
      Math.ceil(side) + SEAM_BLEED + wedgeApex(side).y,
    );
    this.#paintWedge(source, side);
    // Squarely upright, whatever angle the instrument is being held at: the
    // period is a rectangle of the lattice's own, and a rotated one does not
    // line up with the sides of a picture. How you are holding the tube is not
    // a property of the pattern.
    this.#stampField(tileCtx, TILE.width, TILE.height, side, 0, true);
    this.#resizeWedge(painted.width, painted.height);

    // A blob rather than a data URL: it is what the share sheet wants, and it
    // saves encoding a megabyte of base64 only to decode it again.
    return new Promise((resolve) => {
      tile.toBlob(resolve, type);
    });
  }

  /**
   * Resizes the wedge surface, which clears it.
   *
   * Safe to do between frames because the wedge is painted from scratch every
   * frame anyway — it has to be, since the pieces composite with `multiply` and
   * `lighter` and neither survives being stamped over its own remains.
   */
  #resizeWedge(width: number, height: number): void {
    if (this.#wedge.width !== width || this.#wedge.height !== height) {
      this.#wedge.width = width;
      this.#wedge.height = height;
    }
  }

  /** Paints the chosen source into the offscreen wedge surface. */
  #paintWedge(source: WedgeSource, triangleSide: number): void {
    const { scene, settings, sprites, mode, media, glasses } = source;
    const ctx = this.#wedgeCtx;
    const reach = Math.ceil(triangleSide);

    // Painted from scratch every frame. It cannot be built up by fading what is
    // already there and drawing over it: the pieces composite with `multiply`
    // and `lighter`, neither of which is idempotent, so a still pile stamped
    // over its own remains walks away from a single pass of it.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = GROUND;
    // The whole surface, not just the part this triangle uses. The bead samples
    // outside the triangle's own reach, and anything it finds unpainted comes
    // back as transparent black — which showed up as holes punched through the
    // figure. Painting the surface costs nothing and has no such edge.
    ctx.fillRect(0, 0, this.#wedge.width, this.#wedge.height);

    const apex = wedgeApex(triangleSide);

    if (mode === 'media' && media) {
      ctx.save();
      // drawMedia centres on the apex, which sits inside the margin.
      ctx.translate(apex.x, apex.y);
      drawMedia(ctx, media, {
        size: reach,
        // The source's own magnification, not the tube's: the mirror triangle
        // is sized separately, and conflating the two meant a wider tube also
        // enlarged the picture inside it.
        zoom: settings.sourceScale,
        // A photo has no physics of its own, so it simply turns with the cell,
        // a little behind it.
        rotation: scene.contents,
        pan: scene.drag,
      });
      ctx.restore();
    } else if (mode === 'chamber') {
      ctx.save();
      ctx.translate(apex.x, apex.y);
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
        // A pinch in progress, seen live: the glass is only recut once the
        // size rests, so until then the sprites run ahead of the cut by the
        // gap between the live setting and the scale the scene was cut at.
        magnify: Math.max(0.05, settings.sourceScale) / scene.chipScale,
        // The cell turns inside the fixed mirrors. What the glass does within it
        // is the physics' business, not this rotation's.
        rotation: scene.cell,
        pan: {
          x: scene.drag.x * DRAG_CELLS,
          y: scene.drag.y * DRAG_CELLS,
        },
        sprites,
        glasses,
      });
      ctx.restore();
    }
  }

  /**
   * Tiles the field the way a three-mirror tube does.
   *
   * Six mirrored triangles are assembled into one hexagon, and that hexagon is
   * then stamped across the view on the translation lattice. Building the
   * hexagon once and stamping it keeps the per-frame cost at six clipped draws
   * plus one cheap blit per hexagon, however much of the field is on screen.
   */
  #compositeTiling(side: number, angle: number, settings: Settings, tilt: number): void {
    const ctx = this.#ctx;

    if (this.#compositeWithShader(side, angle, settings, tilt)) {
      return;
    }

    this.#stampField(ctx, this.#width, this.#height, side, angle);

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
   * Draws the whole figure with the shader, if there is one.
   *
   * Returns `false` when there is not — no WebGL2, or a context that has been
   * lost — and the caller falls back to stamping hexagons. The two paths make
   * the same figure; where they differ is written up in the README, and every
   * difference is the shader being able to answer per pixel something the 2D
   * path can only approximate over the whole view.
   *
   * The result is blitted onto the visible 2D canvas rather than drawn straight
   * to the screen. That keeps one surface holding the finished frame, which is
   * what the debug overlay draws onto and what the PNG save reads back.
   */
  /** The shader, made on first asking, or `null` where there is none to have. */
  #theShader(): Compositor | null {
    if (!this.#shaderTried) {
      this.#shaderTried = true;
      // Its own surface, not one from the wedge factory: that factory makes
      // the 2D surfaces this class draws onto, and a canvas that has been
      // given a WebGL context can never be given a 2D one.
      this.#shader = Compositor.create();
    }

    if (this.#shader?.lost) {
      // A lost context does not come back on its own, and re-creating one on
      // a machine that has just dropped its GPU is how you lose it again.
      this.#shader = null;
    }

    return this.#shader;
  }

  #compositeWithShader(side: number, angle: number, settings: Settings, tilt: number): boolean {
    const shader = this.#theShader();

    if (!shader) {
      return false;
    }

    shader.resize(this.#width, this.#height);

    const drawn = shader.draw({
      source: this.#wedge,
      apex: wedgeApex(side),
      side,
      angle,
      centre: triangleCentre(side),
      facets: FACET_EXPOSURE,
      cell: CELL_EXPOSURE,
      // Half, because the shader shades outwards from the middle of a join
      // while the 2D path strokes a line of this width across it.
      seamWidth: Math.max(1, side * SEAM_WIDTH) / 2,
      seamAlpha: SEAM_ALPHA,
      tint: MIRROR_TINT,
      vignette: {
        // The 2D gradient runs from a fraction of the shorter edge out to the
        // corner; the shader works in fractions of that same reach.
        clear:
          this.#radius > 0
            ? (Math.min(this.#width, this.#height) * VIGNETTE_CLEAR) / this.#radius
            : 0,
        depth: VIGNETTE_DEPTH,
      },
      dispersion: RIM_DISPERSION,
      glitter: settings.glitter,
      grain: Math.max(1, side * GLITTER_GRAIN),
      // Where the room's light is, seen from a phone being held at `tilt`. The
      // light stays where it is and the instrument turns under it, so this is
      // the tilt read back into the screen's own axes — which is why the flakes
      // fire in waves as the phone moves and sit still when it does not.
      light: {
        x: Math.sin(tilt) * LIGHT_THROW,
        y: Math.cos(tilt) * LIGHT_THROW,
        z: 1,
      },
      // Never over the chamber. The bead is a marble over the objective, and a
      // real instrument with an object cell has no objective to put one over —
      // the cell caps the tube. It was tried applying to everything, and over
      // the chamber it inverted gravity: the pile hung opposite the arrow,
      // with every avalanche crushed into the rings around the apex corners.
      // A half-turn of the painted cell cancelled that, but the owner's call
      // is simpler and truer: the bead does not touch the glass, ever. It
      // remains the teleidoscope optic, for a photograph and the camera.
      bead: this.#source?.mode === 'chamber' ? 0 : settings.bead,
      // The triangle's middle, for both kinds of source.
      //
      // Not right for a photograph, and known not to be: `drawMedia` centres a
      // picture on the apex, so the lens axis sits off the picture and a photo
      // is seen through the edge of the marble rather than its centre — which
      // a grid photograph shows plainly. Centring on the apex instead was
      // tried and is worse: the apex sits two pixels into the surface, most of
      // the picture is clipped away off-canvas around it, and inverting about
      // it samples nothing at all — the whole figure goes black. Fixing it
      // properly means giving the media somewhere to be drawn around that is
      // actually on the surface, which is a change to the wedge and not to
      // this line.
      beadAt: triangleCentre(side),
      // The bead's rim is the triangle's circumcircle — the circle through
      // its corners — so the whole of the view sits inside the glass. The
      // height of the triangle was tried as the diameter first and read as a
      // ball floating in the figure, its rim visibly indoors; the owner drew
      // the circle wanted, and it was this one.
      beadReach: side / Math.sqrt(3),
    });

    if (!drawn) {
      return false;
    }

    this.#ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.#ctx.globalCompositeOperation = 'source-over';
    this.#ctx.globalAlpha = 1;
    this.#ctx.drawImage(shader.canvas, 0, 0);

    return true;
  }

  /**
   * The two things worth seeing that the figure hides.
   *
   * One triangle of the mirror framework, drawn where the source is painted
   * before anything is reflected — everything on screen is that triangle and
   * its images. And an arrow for gravity, which points down the screen until
   * the instrument is tilted and then follows the room instead. Over the top of
   * the barrel, since it is an instrument laid on the picture rather than part
   * of the optics, and left out of an exported tile entirely.
   */
  #drawDebug(side: number, tilt: number, angle: number): void {
    const ctx = this.#ctx;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    const width = Math.max(2, side * DEBUG_WIDTH);

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Placed exactly as the field is, so it outlines the real triangle rather
    // than one drawn where the mirrors used to be.
    ctx.save();
    this.#placeField(ctx, this.#width, this.#height, side, angle);
    traceTriangle(ctx, side, 0);
    ctx.restore();
    this.#strokeTwice(width, DEBUG_INK);

    ctx.translate(this.#width / 2, this.#height / 2);

    // Gravity, in the plane of the screen: straight down when the phone is
    // upright, and turned by however far it is being held over. Not turned by
    // the framework's angle — the floor is where it is however the instrument
    // is held, and seeing the arrow stay put while the figure turns under it is
    // the whole point of drawing it.
    const reach = Math.min(this.#width, this.#height) * DEBUG_ARROW;
    const x = Math.sin(tilt) * reach;
    const y = Math.cos(tilt) * reach;

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(x, y);
    // The head: two barbs back along the shaft, a sixth of a turn either way.
    for (const barb of [-1, 1]) {
      const angle = Math.atan2(y, x) + Math.PI + (barb * Math.PI) / 6;
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(angle) * reach * 0.22, y + Math.sin(angle) * reach * 0.22);
    }

    this.#strokeTwice(width, DEBUG_GRAVITY);
    ctx.restore();
  }

  /** A pale underlay, then the ink: legible over a picture of any colour. */
  #strokeTwice(width: number, ink: string): void {
    const ctx = this.#ctx;

    ctx.lineWidth = width * DEBUG_HALO;
    ctx.strokeStyle = DEBUG_HALO_INK;
    ctx.stroke();
    ctx.lineWidth = width;
    ctx.strokeStyle = ink;
    ctx.stroke();
  }

  /**
   * Lays the hexagons across a surface, with their joins. The field itself,
   * without the optics in front of it.
   *
   * Taken apart from {@link #compositeTiling} because the seamless tile wants
   * the field and nothing else: the barrel and the mirror falloff are radial,
   * so baking either into a tile puts a dark blot at every repeat.
   *
   * @param angle How far the framework is turned, in radians — which way up the
   *   tube is being held.
   * @param uniform Stamps every hexagon at the same exposure, making the field
   *   exactly periodic. For an exported tile, where a repeat is what is wanted.
   */
  #stampField(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    side: number,
    angle: number,
    uniform = false,
  ): void {
    const hexagon = this.#buildHexagon(side);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = GROUND;
    ctx.fillRect(0, 0, width, height);

    if (!hexagon) {
      return;
    }

    ctx.save();
    this.#placeField(ctx, width, height, side, angle);

    const lattice = hexLattice(side);
    // A rotated rectangle fits inside the circle through its corners, so cover
    // that: cheaper than re-deriving the bounds for every angle.
    const reach = Math.hypot(width, height) / 2;
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
      ctx.globalAlpha = uniform ? 1 : 1 - cellNoise(centre.i, centre.j) * CELL_EXPOSURE;
      ctx.drawImage(hexagon, centre.x - offset, centre.y - offset);
    }

    ctx.globalAlpha = 1;

    this.#drawSeams(ctx, width, height, side);
    ctx.restore();
  }

  /**
   * Puts the field where it belongs on a surface, ready to be drawn into.
   *
   * Three steps, and both the field and the debug overlay take all three or
   * they would disagree about where the mirrors are:
   *
   * 1. To the middle of the view.
   * 2. Turned by the framework's angle — which way up the tube is being held.
   *    The framework does not move on its own; plenty of real kaleidoscopes are
   *    built with the mirrors fixed in the barrel and the chamber of glass
   *    turning against them on its own bearing. Turning the whole tiling as the
   *    cell turns instead sweeps the figure around the screen, which reads as a
   *    picture being spun and drowns the thing worth watching — the glass
   *    falling.
   * 3. Back by the source triangle's own centre, so that triangle lands in the
   *    middle rather than the corner where six of them meet. It is the one the
   *    source is actually painted into and every other is a reflection of it;
   *    having it off to one side while the middle of the screen is a junction
   *    puts the interesting part where nobody is looking.
   */
  #placeField(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    side: number,
    angle: number,
  ): void {
    const centre = triangleCentre(side);

    ctx.translate(width / 2, height / 2);
    ctx.rotate(angle);
    ctx.translate(-centre.x, -centre.y);
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
  #drawSeams(ctx: CanvasRenderingContext2D, width: number, height: number, side: number): void {
    const spacing = (side * Math.sqrt(3)) / 2;

    if (spacing <= 0) {
      return;
    }

    const reach = Math.hypot(width, height) / 2 + spacing;
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
  #buildHexagon(side: number): HTMLCanvasElement | null {
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

    const apex = wedgeApex(side);

    for (let index = 0; index < 6; index += 1) {
      ctx.save();
      traceTriangle(ctx, side, index, SEAM_BLEED);
      ctx.clip();
      // The wedge surface holds the source with its apex inside the margin.
      ctx.drawImage(this.#wedge, -apex.x, -apex.y);

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
    ctx.fillStyle = GROUND;
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

/**
 * Whether two lists of glass are the same sets in the same order.
 *
 * The list is rebuilt every frame, so it cannot be compared by reference; but
 * its members are stable — the same picture elements and their cached scores —
 * so a shallow compare tells a genuine change of mix from a fresh array of the
 * same thing, and keeps the pieces from being re-sized every frame.
 */
function sameGlasses(a: readonly Glass[], b: readonly Glass[]): boolean {
  return (
    a.length === b.length &&
    a.every((glass, index) => {
      const other = b[index]!;

      return glass.skin === other.skin && glass.patches === other.patches;
    })
  );
}

function defaultCanvas(): HTMLCanvasElement {
  return document.createElement('canvas');
}
