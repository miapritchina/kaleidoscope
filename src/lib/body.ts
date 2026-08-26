import {
  CHAMBER_DRAG,
  CHAMBER_RADIUS,
  MAX_STEP_SECONDS,
  type Chamber,
  type ChamberTouch,
  type ChamberView,
} from './chamber';
import { GROUND, rgbToCss } from './color';
import { Compositor } from './compositor';
import { foldIntoTriangle } from './fold';
import { LIMITS } from './settings';
import {
  coverWithHexagons,
  frameworkRadians,
  hexLattice,
  traceHexagon,
  traceTriangle,
  triangleCentre,
  type Vector,
} from './tiling';

/**
 * The body of the instrument: three mirrors, a barrel, and an eyehole.
 *
 * Nothing in this file knows what is in the chamber. It knows there is one,
 * that it is round, that it is {@link CHAMBER_RADIUS} across, and that asking
 * it to paint itself produces a picture — and that is the whole of the
 * acquaintance. Glass, oil, a photograph, a video: the arithmetic below does
 * not branch on any of it, which is what makes the figure something that can
 * be got right once. See `lib/chamber.ts` for the bargain the two sides keep.
 */

/**
 * What the figure was last painted from.
 *
 * Kept after a frame so the same thing can be painted again at a different
 * size — which is what an exported tile needs, since its size is fixed and the
 * triangle on screen is whatever the viewport and the slider make it.
 */
interface WedgeSource {
  chamber: Chamber;
  optics: BodyOptics;
}

/**
 * The settings the body reads. Everything here is about the tube.
 *
 * Deliberately not `Settings`: what is in the chamber, how big its pieces are
 * and how thick its fluid is are none of the body's business, and a body that
 * took the whole object would drift back into reading them. An app-wide
 * `Settings` satisfies this by having the four fields, so nothing at the call
 * site has to be taken apart.
 */
export interface BodyOptics {
  /** How large the mirror triangle is, as a multiplier. */
  zoom: number;
  /** How far the mirror framework is set, in degrees. */
  angle: number;
  /** How much glass bead is over the open end, 0 to 1. */
  bead: number;
  /** Whether to draw the mirrors and gravity over the top. */
  debug?: boolean;
}

/** What one frame does to the instrument. */
export interface BodyStep {
  /** Seconds since the previous frame. Clamped here, once, for everyone. */
  dt: number;
  /**
   * How fast the chamber is being turned in its bearing, in radians per second.
   *
   * The chamber alone. Plenty of real kaleidoscopes are built this way: the
   * mirrors are fixed in the barrel and the chamber of glass turns against
   * them on its own bearing. Turning the whole tiling as the chamber turns
   * instead sweeps the figure around the screen, which reads as a picture
   * being spun and drowns the thing worth watching.
   */
  turn: number;
  /** Where the viewer has dragged the contents, each axis in `[-1, 1]`. */
  drag: { x: number; y: number };
  /**
   * How far the instrument itself is tilted, in radians.
   *
   * This moves gravity, not the figure. The mirrors and the chamber are both
   * fixed in the tube and the tube is the phone, so tilting it turns nothing on
   * screen — what changes is which way the contents fall, exactly as it does
   * when you tip a real one in your hand.
   */
  tilt: number;
  /** How far the mirror framework is set, in degrees. */
  angle: number;
  /** A finger in the chamber, already folded there by {@link KaleidoscopeBody.probe}. */
  touch?: ChamberTouch | null;
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
 * Side of the mirror triangle for a view of this size, at this zoom.
 *
 * Exported for whoever has to reason about the view without a body in hand,
 * which in practice is a test. The body itself has exactly this one formula
 * and no other, so there is nothing for it to disagree with.
 */
export function triangleSideFor(width: number, height: number, zoom: number): number {
  return Math.max(24, Math.min(width, height) * TRIANGLE_FRACTION * zoom);
}

/**
 * The tube, its mirrors, and the optics in front of them.
 *
 * The chamber is asked to paint itself once per frame into an offscreen
 * triangle; that triangle is then mirrored into a hexagon and the hexagon
 * stamped across the field. Once, not six times — which keeps the per-frame
 * cost proportional to the chamber rather than to `chamber x triangles`, and is
 * what makes the reflections line up exactly rather than nearly.
 *
 * It never asks what it is painting. See `lib/chamber.ts`.
 *
 * All geometry is in device pixels; the canvas backing store is sized by
 * {@link KaleidoscopeBody.resize} and never scaled by the DPR, which avoids
 * compounding transforms.
 */
export class KaleidoscopeBody {
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

  readonly #createCanvas: () => HTMLCanvasElement;
  #tile: HTMLCanvasElement | null = null;
  #source: WedgeSource | null = null;

  /**
   * How the instrument is being held: the pose, and nothing about the picture.
   *
   * The bearing is the body's rather than the chamber's because the bearing is
   * part of the tube — a chamber dropped into a different instrument does not
   * bring its own idea of how far it has been turned. The drag and the tilt are
   * here for the same reason, and because the debug arrow and the fold both
   * want them.
   */
  #bearing = 0;
  #drag = { x: 0, y: 0 };
  #tilt = 0;

  /**
   * The shader, where there is one.
   *
   * Built on the first frame rather than in the constructor: a body is
   * made before it has a size, and asking for a WebGL context costs a real
   * allocation on the GPU that a test which never draws should not pay.
   */
  #shader: Compositor | null = null;
  #shaderTried = false;

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
   * Advances the instrument by one frame, and the chamber with it.
   *
   * Separate from {@link render} because the two happen at different rates: a
   * paused instrument is still repainted when a slider moves, and a settings
   * change should show up without the animation running.
   *
   * The one piece of arithmetic here that matters is gravity. Three things
   * move it and all three compose: turning the chamber sweeps gravity around
   * it, setting the mirrors over takes it back off again — the chamber is
   * drawn *inside* the framework, so the framework's angle has to come off
   * gravity's or the pile would lean with the instrument — and tipping the
   * phone moves it once more without turning anything on screen. What comes
   * out is one angle in the chamber's own frame, which is the only form the
   * chamber ever sees.
   */
  step(chamber: Chamber, { dt, turn, drag, tilt, angle, touch = null }: BodyStep): void {
    // Clamped here, once, so that no chamber has to defend itself against a
    // tab that has been in the background for a minute.
    const seconds = Math.min(Math.max(dt, 0), MAX_STEP_SECONDS);

    this.#bearing += turn * seconds;
    this.#drag = { x: drag.x, y: drag.y };
    this.#tilt = tilt;

    chamber.update({
      dt: seconds,
      gravity: this.#bearing + frameworkRadians(angle) + tilt,
      turn,
      touch,
    });
  }

  /** How far the chamber has been turned in its bearing, in radians. */
  get bearing(): number {
    return this.#bearing;
  }

  /**
   * Where a point on the stage lands, in the body's own frame and cell units.
   *
   * The screen shows one triangle of chamber and a field of its reflections, so
   * a finger is almost never over the chamber itself — it is over some mirror
   * image of it. The fold knows which, and this is the body's own placement run
   * backwards through it: the same triangle, the same centring, the same
   * framework rotation, the same drag.
   *
   * It stops one step short of the chamber's own frame, deliberately. The
   * bearing is not applied, because a finger is in the room rather than in the
   * tube: the chamber turns under a held finger, and a point read after the
   * bearing has been divided out moves when the finger has not. Differencing
   * such points measures the tube turning as well as the hand moving. So the
   * frames are kept apart until the reading is done — `trackStir` in
   * `lib/stir.ts` differences here and carries only the answer across, with
   * {@link KaleidoscopeBody.bearing} for the crossing.
   *
   * The rest lives here because every step of it is the body's. A chamber that
   * wants to be stirred takes the answer and never learns there were mirrors.
   */
  probe(point: Vector, optics: BodyOptics): Vector {
    const side = this.#sideAtZoom(optics.zoom);
    const framework = frameworkRadians(optics.angle);

    // Undo the view's placement: centre, then the framework's rotation, then
    // the offset that put the source triangle's centre in the middle.
    const dx = point.x - this.#width / 2;
    const dy = point.y - this.#height / 2;
    const cos = Math.cos(-framework);
    const sin = Math.sin(-framework);
    const centre = triangleCentre(side);
    const folded = foldIntoTriangle(
      { x: dx * cos - dy * sin + centre.x, y: dx * sin + dy * cos + centre.y },
      side,
    ).point;

    // Out of the triangle and into the chamber's own units, undoing exactly
    // what #paintWedge and #chamberView do on the way in — bar the bearing.
    const scale = this.#cellScale(side);
    const pan = this.#chamberPan();

    return {
      x: (folded.x - centre.x) / scale - pan.x,
      y: (folded.y - centre.y) / scale - pan.y,
    };
  }

  /**
   * Draws one frame. Call after {@link resize}.
   *
   * @param chamber Whatever is in the far end of the tube. Asked to paint
   *   itself once, into one triangle; everything on screen after that is that
   *   triangle and its reflections.
   * @param optics How the tube itself is set. See {@link BodyOptics}.
   */
  render(chamber: Chamber, optics: BodyOptics): void {
    if (this.#width === 0 || this.#height === 0) {
      return;
    }

    const triangle = this.#sideAtZoom(optics.zoom);
    const source: WedgeSource = { chamber, optics };

    this.#source = source;
    this.#paintWedge(source, triangle);
    this.#compositeTiling(triangle, frameworkRadians(optics.angle), optics);

    if (optics.debug) {
      this.#drawDebug(triangle, this.#tilt, frameworkRadians(optics.angle));
    }
  }

  /** The largest side the zoom slider can reach, for sizing the surfaces. */
  #maxTriangleSide(): number {
    return this.#sideAtZoom(LIMITS.zoom.max);
  }

  #sideAtZoom(zoom: number): number {
    return triangleSideFor(this.#width, this.#height, zoom);
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

  /**
   * Puts the chamber where the mirrors can see it, and asks it to paint.
   *
   * This is the whole of the body's side of the bargain, and it is four steps:
   *
   * 1. Cover the surface — all of it — with whatever the chamber says it is
   *    lit against. Not just the triangle: the bead samples outside the
   *    triangle's own reach, and anything it finds unpainted comes back as
   *    transparent black, which showed up as holes punched through the figure.
   *    Painting the whole surface costs nothing and has no such edge.
   * 2. Move to the middle of the cell, which is the middle of the triangle.
   *    The mirror triangle is inscribed in the chamber, the way a real tube's
   *    mirrors span the round cell at the end of it. Hanging the cell off the
   *    corner the six triangles are assembled around instead leaves most of it
   *    outside the view, and turning sweeps the contents clean out of it.
   * 3. Hand over a scale, a bearing and a drag, and let the chamber paint.
   * 4. Put the context back, whatever the chamber did to it.
   *
   * Nothing here asks what is in the chamber, and there is nowhere it could:
   * the only thing that varies between one chamber and the next is a colour
   * and a callback.
   */
  #paintWedge(source: WedgeSource, triangleSide: number): void {
    const { chamber } = source;
    const ctx = this.#wedgeCtx;

    // Painted from scratch every frame. It cannot be built up by fading what is
    // already there and drawing over it: a chamber may composite with
    // `multiply` and `lighter`, neither of which is idempotent, so a still pile
    // stamped over its own remains walks away from a single pass of it.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.filter = 'none';
    ctx.fillStyle = chamber.ground;
    ctx.fillRect(0, 0, this.#wedge.width, this.#wedge.height);

    const apex = wedgeApex(triangleSide);
    const centre = triangleCentre(triangleSide);

    ctx.save();
    ctx.translate(apex.x + centre.x, apex.y + centre.y);

    try {
      chamber.paint(ctx, this.#chamberView(triangleSide));
    } finally {
      // Balanced whatever the chamber did — a chamber that throws, or that
      // leaves a save of its own dangling, must not be able to leave the next
      // frame drawing through its transform.
      ctx.restore();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.filter = 'none';
    }
  }

  /**
   * How the chamber is placed for a triangle of this size.
   *
   * The scale is the one number that ties the two parts together: the cell's
   * radius maps onto the triangle's circumradius, so the cell reaches all three
   * corners and no further. Everything simulated has a chance of being seen,
   * and nothing is simulated that never could be.
   */
  #chamberView(side: number): ChamberView {
    const scale = this.#cellScale(side);

    return {
      scale,
      rotation: this.#bearing,
      pan: this.#chamberPan(),
      drag: { x: this.#drag.x, y: this.#drag.y },
      // A little past the wall, so the seam bleed lands on the chamber's own
      // picture rather than on bare ground behind it.
      reach: CHAMBER_RADIUS + (scale > 0 ? SEAM_BLEED / scale : 0),
      // Where the room's light is, seen from a phone being held at this tilt.
      // The light stays where it is and the instrument turns under it.
      light: { x: Math.sin(this.#tilt), y: Math.cos(this.#tilt), z: 1 },
    };
  }

  /** Cell units to device pixels, for a triangle of this size. */
  #cellScale(side: number): number {
    return side / Math.sqrt(3) / CHAMBER_RADIUS;
  }

  /** Where the drag has carried a cell's contents, in cell units. */
  #chamberPan(): { x: number; y: number } {
    return { x: this.#drag.x * CHAMBER_DRAG, y: this.#drag.y * CHAMBER_DRAG };
  }

  /**
   * Tiles the field the way a three-mirror tube does.
   *
   * Six mirrored triangles are assembled into one hexagon, and that hexagon is
   * then stamped across the view on the translation lattice. Building the
   * hexagon once and stamping it keeps the per-frame cost at six clipped draws
   * plus one cheap blit per hexagon, however much of the field is on screen.
   */
  #compositeTiling(side: number, angle: number, optics: BodyOptics): void {
    const ctx = this.#ctx;

    if (this.#compositeWithShader(side, angle, optics)) {
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

  #compositeWithShader(side: number, angle: number, optics: BodyOptics): boolean {
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
      // Over an open chamber only, and the chamber says which it is. The bead
      // is a marble over the objective, and a real instrument with an object
      // cell has no objective to put one over — the cell caps the tube. It was
      // tried applying to everything, and over a cell it inverted gravity: the
      // pile hung opposite the arrow, with every avalanche crushed into the
      // rings around the apex corners. A half-turn of the painted cell
      // cancelled that, but the owner's call is simpler and truer: the bead
      // does not touch the glass, ever. It remains the teleidoscope optic.
      bead: this.#source?.chamber.open === true ? optics.bead : 0,
      // The middle of the chamber, which is the middle of the triangle. Every
      // chamber is painted about that point, so the bead's axis and the
      // picture's middle are the same place by construction — which they were
      // not while a photograph was drawn about the triangle's corner instead.
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

function defaultCanvas(): HTMLCanvasElement {
  return document.createElement('canvas');
}
