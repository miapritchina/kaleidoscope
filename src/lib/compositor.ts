/**
 * The mirrors, as a fragment shader.
 *
 * The 2D path assembles the figure out of pieces: six clipped triangles into a
 * hexagon, that hexagon stamped across the field, then a radial gradient for
 * what the mirrors cost and a stroked line at every join. This does the same
 * job by asking, for each pixel, where in the source triangle it is looking —
 * see `lib/fold.ts` for the arithmetic, which this file transliterates.
 *
 * Three things come out better for free, because folding knows per pixel what
 * drawing only knows per triangle:
 *
 * - **The mirrors cost what they actually cost.** The 2D falloff is a radial
 *   gradient standing in for the bounce count. Here the count is exact, so the
 *   dimming follows the tiling rather than a circle drawn over it.
 * - **The joins are where the mirrors are**, measured as a distance and shaded
 *   with the derivative, rather than stroked as lines a pixel or two wide.
 * - **The reflections stay sharp at any size.** Nothing is resampled off a
 *   pre-drawn hexagon, so zooming in samples the source itself.
 *
 * What it does not do is replace the 2D renderer. That one still paints the
 * source triangle — the chamber, the photo, the camera — and still exports the
 * seamless tile, and it is the whole renderer wherever WebGL2 is missing.
 */

const VERTEX = `#version 300 es
// One triangle covering the viewport. Two would need a shared edge, which is
// one more place for a seam to appear in a program about not having seams.
void main() {
  vec2 corner = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`;

const FRAGMENT = `#version 300 es
precision highp float;

uniform sampler2D uSource;
/** Viewport, in device pixels. */
uniform vec2 uResolution;
/** Side of the wedge surface, and how far into it the triangle's apex sits. */
uniform vec2 uSurface;
/** Side of the mirror triangle, in device pixels. */
uniform float uSide;
/** How far the framework is turned. */
uniform float uAngle;
/** The source triangle's own centre, so it lands in the middle of the view. */
uniform vec2 uCentre;
/** Half the diagonal of the view. */
uniform float uRadius;
/** What each of the six cells of a hexagon does to the exposure. */
uniform float uFacet[6];
/** How far a whole hexagon may stray from its neighbours. */
uniform float uCell;
/** Width of a join in pixels, and how dark it is. */
uniform vec2 uSeam;
/** What one bounce leaves of the light, per channel. */
uniform vec3 uTint;
/** Share of the way out the barrel leaves clear, and how dark its corner is. */
uniform vec2 uVignette;
/** How far apart the channels are pulled at the rim, in pixels. */
uniform float uDispersion;
/** How much glitter is in the chamber, and how coarse it is, in pixels. */
uniform vec2 uGlitter;
/** Which way the room's light is coming from, as the phone is being held. */
uniform vec3 uLight;
/** How much bead there is, and how far across the source it reaches. */
uniform vec2 uBead;
/** The middle of the painted source, which is what the bead is centred on. */
uniform vec2 uBeadAt;

out vec4 fragColor;

const float SQRT3 = 1.7320508075688772;
const float SIXTH = 1.0471975511965976;

struct Fold {
  vec2 point;
  float bounces;
  float seam;
  int facet;
  ivec2 cell;
};

/**
 * Folds a point of the field into the source triangle.
 *
 * The comments in lib/fold.ts explain the coordinates and why the lattice step
 * comes before the reflections; this is the same routine and has to stay the
 * same routine, since the two renderers are meant to agree.
 */
Fold foldIntoTriangle(vec2 p, float side) {
  float u = p.x / side - p.y / (side * SQRT3);
  float v = 2.0 * p.y / (side * SQRT3);
  float w = 1.0 - u - v;

  Fold folded;
  folded.bounces = abs(floor(u)) + abs(floor(v)) + abs(floor(w));
  folded.seam = min(min(abs(u - round(u)), abs(v - round(v))), abs(w - round(w)))
    * (side * SQRT3 * 0.5);

  // Which hexagon: nearest lattice point, which on a hexagonal lattice is not
  // the rounded one, so the four corners of the cell are measured.
  float along = floor((2.0 * u + v) / 3.0);
  float across = floor((u + 2.0 * v) / 3.0);
  float nearest = 1.0e30;
  vec2 best = vec2(0.0);

  for (int stepAlong = 0; stepAlong < 2; stepAlong++) {
    for (int stepAcross = 0; stepAcross < 2; stepAcross++) {
      float m = along + float(stepAlong);
      float n = across + float(stepAcross);
      float toU = u - (2.0 * m - n);
      float toV = v - (-m + 2.0 * n);
      // Measured on the plane, not in the skewed frame.
      float dx = toU + toV * 0.5;
      float dy = toV * SQRT3 * 0.5;
      float reach = dx * dx + dy * dy;

      if (reach < nearest) {
        nearest = reach;
        best = vec2(m, n);
      }
    }
  }

  folded.cell = ivec2(int(best.x), int(best.y - best.x));

  float originU = 2.0 * best.x - best.y;
  float originV = -best.x + 2.0 * best.y;
  float localU = u - originU;
  float localV = v - originV;

  // Which of the six around that centre, numbered as traceTriangle numbers them.
  float turn = atan(localV * SQRT3 * 0.5, localU + localV * 0.5);
  folded.facet = int(mod(floor(turn / SIXTH), 6.0));

  float foldU = localU;
  float foldV = localV;
  float foldW = 1.0 - foldU - foldV;

  // Six is twice the longest word in the group of the six triangles around a
  // vertex, which is as far as the lattice step can leave a point.
  for (int step = 0; step < 6; step++) {
    if (foldU < 0.0) {
      foldV += foldU;
      foldW += foldU;
      foldU = -foldU;
    } else if (foldV < 0.0) {
      foldU += foldV;
      foldW += foldV;
      foldV = -foldV;
    } else if (foldW < 0.0) {
      foldU += foldW;
      foldV += foldW;
      foldW = -foldW;
    } else {
      break;
    }
  }

  folded.point = vec2(side * (foldU + foldV * 0.5), side * foldV * SQRT3 * 0.5);

  return folded;
}

/** The same integer hash the 2D renderer uses, so both vary the same hexagons. */
float cellNoise(ivec2 cell) {
  uint hash = uint(cell.x) * 0x27d4eb2du ^ uint(cell.y) * 0x165667b1u;
  hash = (hash ^ (hash >> 15)) * 0x2545f491u;
  hash ^= hash >> 13;

  return float(hash) / 4294967296.0;
}

/** Three unrelated numbers in [0, 1) from one pair of whole ones. */
vec3 hash3(vec2 cell) {
  uvec2 c = uvec2(ivec2(cell) + 4096);
  uint h = c.x * 0x27d4eb2du ^ c.y * 0x165667b1u;
  h = (h ^ (h >> 15)) * 0x2545f491u;
  h ^= h >> 13;
  uint a = h * 0x9e3779b9u;
  uint b = a * 0x85ebca6bu;

  return vec3(h & 0xffffu, a >> 16, b >> 16) / 65535.0;
}

/**
 * Glitter suspended in the chamber.
 *
 * Real glitter is thousands of tiny flat mirrors lying at every angle, and it
 * does not glow — it *flashes*, one flake at a time, as the angle between the
 * eye, the flake and the light passes through alignment. Drawn as sparkly dots
 * it always looks stuck on, because the flashes are not driven by anything. So
 * each flake here gets a normal of its own and is lit properly: what makes them
 * fire is uLight, which is where the room's light is coming from given how the
 * phone is being held. Tip the phone and they go off in waves.
 *
 * Laid out in the source triangle's own frame, before the mirrors, so the same
 * flake appears in all six reflections of a hexagon exactly as a real speck in
 * a real chamber would. One flake per square of a grid, placed away from the
 * edges so a pixel only ever has to look at the square it is in.
 */
vec3 glitterAt(vec2 point) {
  if (uGlitter.x <= 0.0) {
    return vec3(0.0);
  }

  vec2 cell = floor(point / uGlitter.y);
  vec3 dice = hash3(cell);
  // Kept inside the middle of its square, so no flake straddles a boundary.
  vec2 flake = (cell + 0.25 + dice.xy * 0.5) * uGlitter.y;
  float spread = length(point - flake) / (uGlitter.y * 0.16);

  if (spread > 1.0) {
    return vec3(0.0);
  }

  // A flat flake at some angle. Squared, so most lie nearly face up and only a
  // few stand well over — which is what settles how many are alight at once.
  // Spread evenly over a wide cone instead, and with a specular this sharp,
  // essentially none of them ever line up and the whole thing is invisible.
  float lean = dice.z * dice.z * 1.1;
  float turn = dice.x * 6.2831853;
  vec3 normal = normalize(vec3(sin(lean) * cos(turn), sin(lean) * sin(turn), cos(lean)));
  // The eye is straight ahead, so the half-vector is the light tipped halfway.
  // Not called "half", which GLSL ES reserves.
  vec3 midway = normalize(uLight + vec3(0.0, 0.0, 1.0));
  // High, because a flake is a mirror and not a matte speck: dark until it is
  // nearly right, then very bright. This number and the lean above are one
  // decision — together they set what share of the flakes are lit at any
  // moment, and a few percent is what reads as glitter rather than as frost.
  float lit = pow(max(dot(normal, midway), 0.0), 90.0);
  // Round, and soft at the edge, so it reads as a point of light and not a disc.
  float shape = 1.0 - spread * spread;

  return vec3(lit * shape * shape * uGlitter.x);
}

/** Where a screen pixel lands in the field: the view's placement, undone. */
vec2 toField(vec2 pixel) {
  vec2 fromMiddle = pixel - uResolution * 0.5;
  float cosine = cos(-uAngle);
  float sine = sin(-uAngle);

  return vec2(
    fromMiddle.x * cosine - fromMiddle.y * sine,
    fromMiddle.x * sine + fromMiddle.y * cosine
  ) + uCentre;
}

/**
 * The source, read where a fold says to read it.
 *
 * Not called "sample", which GLSL ES 3.00 reserves. Backticks are out too:
 * this whole shader lives in a template literal.
 */
/**
 * Where a point is looking, once there is a glass bead in the way.
 *
 * A teleidoscope is a kaleidoscope with an open end and a solid glass sphere
 * over it, and that sphere is not a decoration. Ordinary glass has an index
 * near 1.5, which puts a sphere's focus just outside its own surface, so it
 * gathers the whole hemisphere in front of it into a disc — upside down, and
 * packed hardest at the rim, where the last few degrees of the world are
 * squeezed into the last few pixels of glass.
 *
 * Both halves matter. Inverting without compressing is a rotation; compressing
 * without inverting is a fisheye. It is the pair together that reads as looking
 * into a marble.
 *
 * A model, not a ray trace: the gain is a curve shaped to behave like the real
 * thing — middle magnified, rim reaching far — rather than derived from Snell's
 * law across two surfaces. Applied in the source's own frame, so the bead sits
 * in front of the mirrors as the real one does and every reflection shows the
 * same beaded image rather than a bead of its own.
 */
vec2 throughBead(vec2 point) {
  if (uBead.x <= 0.0) {
    return point;
  }

  float reach = max(1.0, uBead.y);
  // About the middle of what is painted, not about the triangle's corner.
  // Inverting about the corner sends every coordinate negative, they clamp to
  // the edge of the surface, and the glass disappears into bare ground — which
  // is exactly what the first version of this did.
  vec2 from = point - uBeadAt;
  float across = length(from) / reach;
  float gain = mix(1.0, 0.42 + 1.5 * across * across, uBead.x);

  // Subtracted rather than added, because a sphere hands the world back upside
  // down. That inversion is half of what makes it read as a marble.
  return uBeadAt - from * gain;
}

vec3 readSource(Fold folded) {
  vec2 at = (throughBead(folded.point) + uSurface.y) / uSurface.x;

  return texture(uSource, at).rgb;
}

void main() {
  // gl_FragCoord counts up from the bottom; the field counts down from the top,
  // as every other surface in this program does.
  vec2 pixel = vec2(gl_FragCoord.x, uResolution.y - gl_FragCoord.y);
  vec2 field = toField(pixel);

  Fold folded = foldIntoTriangle(field, uSide);
  vec3 colour = readSource(folded);

  // Glass disperses, and a tube of it disperses most where the light crosses it
  // most steeply. Sampling the outer channels from a fold of their own rather
  // than nudging this one keeps the split obeying the mirrors: it stays a
  // property of the optics rather than a smear laid over the picture.
  float offAxis = length(pixel - uResolution * 0.5) / uRadius;

  if (uDispersion > 0.0 && offAxis > 0.0) {
    vec2 outward = normalize(pixel - uResolution * 0.5 + 1.0e-6);
    float spread = uDispersion * offAxis * offAxis;

    colour.r = readSource(foldIntoTriangle(toField(pixel + outward * spread), uSide)).r;
    colour.b = readSource(foldIntoTriangle(toField(pixel - outward * spread), uSide)).b;
  }

  // Every cell its own exposure: three mirrors cut and glued by hand are never
  // at exactly sixty degrees and never equally silvered.
  float exposure = uFacet[folded.facet];
  colour = exposure > 0.0
    ? mix(colour, vec3(1.0), exposure)
    : mix(colour, vec3(0.0), -exposure);

  // And each hexagon differs from its neighbours, or the field would be exactly
  // periodic, which is the same tell one step up.
  colour *= 1.0 - cellNoise(folded.cell) * uCell;

  // The joins. Shaded from the distance rather than stroked: solid across the
  // width of the cut and softened over the last pixel either side, which is
  // what a stroked line gets from the rasteriser and has to be asked for here.
  float join = 1.0 - smoothstep(uSeam.x - 0.5, uSeam.x + 0.5, folded.seam);
  colour *= 1.0 - join * uSeam.y;

  // Added before the mirrors take their cut, because the glitter is inside the
  // chamber: a flake seen six bounces out has been through six mirrors, and
  // dims and greens along with everything else at that depth.
  colour += glitterAt(folded.point);

  // What the mirrors take out of the light, at the count of bounces this pixel
  // actually took. A mirror is not free: silvered behind glass the light
  // crosses twice, a few percent goes each time, and the red goes fastest —
  // which is why a corridor of mirrors turns green rather than merely grey.
  colour *= pow(uTint, vec3(folded.bounces));

  // The throat of the tube, in front of the optics rather than part of them.
  // The 2D path draws this as a gradient with four stops, picked by eye rather
  // than derived from anything, so there is no formula to share — this is a
  // curve fitted to those stops, and 3.1 is the exponent that comes closest.
  // Worst disagreement is five levels out of 255, at a place where the picture
  // is already most of the way to black.
  float barrel = clamp((offAxis - uVignette.x) / max(1.0e-6, 1.0 - uVignette.x), 0.0, 1.0);
  colour *= 1.0 - pow(barrel, 3.1) * uVignette.y;

  fragColor = vec4(colour, 1.0);
}
`;

/** Everything the shader needs that changes between frames. */
export interface CompositeOptions {
  /** The surface the source triangle is painted on. */
  source: HTMLCanvasElement;
  /** How far into that surface the triangle's apex sits. */
  bleed: number;
  /** Side of the mirror triangle, in device pixels. */
  side: number;
  /** How far the framework is turned, in radians. */
  angle: number;
  /** The source triangle's own centre. */
  centre: { x: number; y: number };
  /** What each of the six cells of a hexagon does to the exposure. */
  facets: readonly number[];
  /** How far a whole hexagon may stray from its neighbours. */
  cell: number;
  /** Width of a join in device pixels. */
  seamWidth: number;
  /** How dark a join is. */
  seamAlpha: number;
  /** What one bounce leaves of the light, per channel. */
  tint: { r: number; g: number; b: number };
  /** Fraction of the view the barrel leaves clear, and how dark its corner is. */
  vignette: { clear: number; depth: number };
  /** How far apart the channels are pulled at the rim, in device pixels. */
  dispersion: number;
  /** How much glitter is in the chamber, from none to plenty. */
  glitter: number;
  /** How far apart the flakes are, in device pixels. */
  grain: number;
  /** Which way the room's light comes from, given how the phone is held. */
  light: { x: number; y: number; z: number };
  /** How much glass bead is over the end, from none to all. */
  bead: number;
  /** How far across the source the bead reaches, in device pixels. */
  beadReach: number;
  /** Where the bead's axis sits, which is wherever the source is drawn around. */
  beadAt: { x: number; y: number };
}

/**
 * Draws the figure with WebGL2, onto a surface of its own.
 *
 * Its own surface rather than the visible canvas: the visible one stays 2D, so
 * the debug overlay, the PNG save and the seamless tile all keep working
 * unchanged, and dropping back to the 2D renderer is a branch rather than a
 * different program. The cost is one blit per frame, which is measured in the
 * README.
 *
 * {@link create} returns `null` wherever WebGL2 is missing — an old browser, a
 * test in jsdom, a machine that has lost its GPU — and every caller is expected
 * to have a 2D path to fall back to.
 */
export class Compositor {
  readonly #gl: WebGL2RenderingContext;
  readonly #canvas: HTMLCanvasElement;
  readonly #program: WebGLProgram;
  readonly #texture: WebGLTexture;
  readonly #where = new Map<string, WebGLUniformLocation | null>();
  #uploaded = { width: 0, height: 0 };

  private constructor(
    canvas: HTMLCanvasElement,
    gl: WebGL2RenderingContext,
    program: WebGLProgram,
    texture: WebGLTexture,
  ) {
    this.#canvas = canvas;
    this.#gl = gl;
    this.#program = program;
    this.#texture = texture;
  }

  /**
   * Builds a compositor, or returns `null` if this environment cannot run one.
   *
   * Everything after asking for the context is inside the `try`, and not out of
   * superstition: jsdom hands back a truthy `webgl2` object with none of the
   * methods on it, so "did I get a context" is not the same question as "can I
   * use it". Any environment that answers the first and not the second is one
   * the 2D path should be handling, and the only way to find out is to try.
   */
  static create(makeCanvas: () => HTMLCanvasElement = defaultCanvas): Compositor | null {
    // Asked before anything is built, so that an environment without WebGL at
    // all — jsdom, most obviously — never reaches `getContext` and never has to
    // log that it is not implemented.
    if (typeof WebGL2RenderingContext === 'undefined') {
      return null;
    }

    try {
      const canvas = makeCanvas();
      // `alpha: false` because the figure is opaque and compositing it against
      // the page is work nobody sees. `antialias: false` because there is no
      // geometry to alias — every edge in the picture is shaded, not drawn.
      const gl = canvas.getContext('webgl2', {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        preserveDrawingBuffer: true,
      });

      if (!(gl instanceof WebGL2RenderingContext)) {
        return null;
      }

      const program = link(gl);
      const texture = gl.createTexture();

      if (!program) {
        return null;
      }

      gl.bindTexture(gl.TEXTURE_2D, texture);
      // The source is sampled at whatever scale the zoom asks for, so it is
      // filtered; and it must never wrap, or a fold landing a hair outside the
      // triangle would read a pixel from the far side of the surface.
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      return new Compositor(canvas, gl, program, texture);
    } catch {
      return null;
    }
  }

  /** The surface the figure is drawn on, to be blitted onto the visible one. */
  get canvas(): HTMLCanvasElement {
    return this.#canvas;
  }

  /** True once the context has been lost, after which the 2D path takes over. */
  get lost(): boolean {
    return this.#gl.isContextLost();
  }

  resize(width: number, height: number): void {
    if (this.#canvas.width !== width || this.#canvas.height !== height) {
      this.#canvas.width = width;
      this.#canvas.height = height;
    }
  }

  draw(options: CompositeOptions): boolean {
    const gl = this.#gl;

    if (gl.isContextLost()) {
      return false;
    }

    const width = this.#canvas.width;
    const height = this.#canvas.height;

    if (width === 0 || height === 0) {
      return false;
    }

    gl.viewport(0, 0, width, height);
    gl.useProgram(this.#program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.#texture);

    const source = options.source;

    // A whole upload when the surface changes size, a sub-image when it has
    // not: reallocating the texture every frame is the expensive half.
    if (this.#uploaded.width !== source.width || this.#uploaded.height !== source.height) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      this.#uploaded = { width: source.width, height: source.height };
    } else {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
    }

    this.#set1i('uSource', 0);
    this.#set2f('uResolution', width, height);
    this.#set2f('uSurface', source.width, options.bleed);
    this.#set1f('uSide', options.side);
    this.#set1f('uAngle', options.angle);
    this.#set2f('uCentre', options.centre.x, options.centre.y);
    this.#set1f('uRadius', Math.hypot(width, height) / 2);
    this.#set1fv('uFacet[0]', options.facets);
    this.#set1f('uCell', options.cell);
    this.#set2f('uSeam', options.seamWidth, options.seamAlpha);
    this.#set3f('uTint', options.tint.r, options.tint.g, options.tint.b);
    this.#set2f('uVignette', options.vignette.clear, options.vignette.depth);
    this.#set1f('uDispersion', options.dispersion);
    this.#set2f('uGlitter', options.glitter, options.grain);
    this.#set3f('uLight', options.light.x, options.light.y, options.light.z);
    this.#set2f('uBead', options.bead, options.beadReach);
    this.#set2f('uBeadAt', options.beadAt.x, options.beadAt.y);

    gl.drawArrays(gl.TRIANGLES, 0, 3);

    return true;
  }

  #location(name: string): WebGLUniformLocation | null {
    if (!this.#where.has(name)) {
      this.#where.set(name, this.#gl.getUniformLocation(this.#program, name));
    }

    return this.#where.get(name) ?? null;
  }

  #set1i(name: string, value: number): void {
    this.#gl.uniform1i(this.#location(name), value);
  }

  #set1f(name: string, value: number): void {
    this.#gl.uniform1f(this.#location(name), value);
  }

  #set2f(name: string, x: number, y: number): void {
    this.#gl.uniform2f(this.#location(name), x, y);
  }

  #set3f(name: string, x: number, y: number, z: number): void {
    this.#gl.uniform3f(this.#location(name), x, y, z);
  }

  #set1fv(name: string, values: readonly number[]): void {
    this.#gl.uniform1fv(this.#location(name), Float32Array.from(values));
  }
}

function defaultCanvas(): HTMLCanvasElement {
  return document.createElement('canvas');
}

function link(gl: WebGL2RenderingContext): WebGLProgram | null {
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);

  if (!vertex || !fragment) {
    return null;
  }

  const program = gl.createProgram();

  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  // Attached shaders are kept alive by the program; deleting the handles here
  // is what frees them once it is gone.
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    complain('The mirrors could not be linked', gl.getProgramInfoLog(program));
    gl.deleteProgram(program);

    return null;
  }

  return program;
}

function compile(gl: WebGL2RenderingContext, kind: number, source: string): WebGLShader | null {
  const shader = gl.createShader(kind);

  if (!shader) {
    return null;
  }

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    complain('The mirrors could not be compiled', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);

    return null;
  }

  return shader;
}

/**
 * Says why the shader was refused, once, before falling back to drawing.
 *
 * Worth the console noise. Failure here is silent by design — the 2D renderer
 * takes over and the picture still appears — so without this the only symptom
 * of a shader that will not build on some particular phone is that it is
 * slower there and nobody can say why.
 */
function complain(what: string, log: string | null): void {
  console.warn(`${what}: ${log?.trim() ?? 'no reason given'}`);
}
