# Roadmap

Things worth building, why they are worth building, and what they cost. Nothing
here is a commitment; it is a list to argue with and pull from.

Each item says which renderer it needs. **2D** works on the canvas pipeline that
exists today. **GL** needs the WebGL move in "The renderer" below, because it is
per-pixel work that a 2D canvas can only fake badly. That split is the main
thing this list is for: several of these are cheap once the renderer moves and
unaffordable before it.

## The renderer

### Move compositing to WebGL2

The single decision everything else hangs off. Today the mirrors are made by
drawing: six clipped triangles into a hexagon, that hexagon stamped across the
field on a lattice. It is exact, and it is the reason the interesting effects
are all out of reach — every one of them is per-pixel.

In a fragment shader the same figure is one fold. For each screen pixel, reflect
its coordinates into the fundamental triangle and sample the source there. No
hexagon, no stamping, no lattice, no seam bookkeeping, and it is *more* correct
than what we do now: reflections stay exact at any zoom instead of resampling a
pre-drawn hexagon.

What it unlocks: refraction, chromatic aberration, glitter, fluids, bloom, the
glass bead, and depth of field — all of §2, §3 and most of §4 below.

What it costs: `renderer.ts` is 925 lines and its tests are 410. The physics
does not move — `lib/` stays plain TypeScript and the solver is untouched. The
PNG save path needs `preserveDrawingBuffer` or a `readPixels` copy.

Target WebGL2, which iOS Safari has had since version 15. Keep the 2D path as a
fallback rather than deleting it.

### Pick the thinnest library that does it

The whole render is three passes: draw the chamber to a texture, fold and
sample, then post-process. That is not a scene graph, and a scene-graph engine
is mostly weight we would carry and not use.

Unpacked sizes, as published — not what ships, which needs measuring against a
real build before choosing:

| | version | unpacked |
| --- | --- | --- |
| `ogl` | 1.0.11 | 423 KB |
| `twgl` | 7.0.3 | 1.16 MB |
| `regl` | 2.1.1 | 1.21 MB |
| `three` | 0.185.1 | 23.2 MB |
| `pixi.js` | 8.19.0 | 72.4 MB |

`ogl` is the one to try first. Raw WebGL2 with our own small helper is also a
real answer for three passes, and costs nothing at all.

### Add a web app manifest

Free, quick, and it makes the thing feel like an instrument instead of a web
page: added to the home screen it opens full screen with no browser chrome.
**2D.**

## The glass bead

### Teleidoscope optics in camera mode

The biggest single change in what the app *is*. A real teleidoscope has a solid
glass sphere at the objective end, and its optics are specific: n≈1.5 puts the
focus just outside the surface, so the sphere forms an **inverted, heavily
compressed fisheye of the whole hemisphere in front of it**, with the
compression going nonlinear toward the rim.

Camera mode today is a mirrored webcam. This makes it an instrument.

**GL** for the real thing. A **2D** approximation exists — draw the frame as
~32 concentric annuli, each scaled by the sphere's own r→r′ curve — and is
worth building first if the renderer move is not imminent, because it proves
the mapping is right before any shader is written.

### Rim dispersion

Glass balls separate colour hard at the edge. Red and blue pull apart visibly in
the outer third. Falls out of the bead mapping almost for free once it exists.
**GL.**

### The highlight on the bead

One bright specular spot, fixed to the room rather than to the pattern. It is
what gives the bead roundness; without it the fisheye reads as a filter. **2D.**

### The bead over the object chamber too

Not just camera. Open question whether it helps or muddies — worth trying once
the mapping exists, and cheap to try. **GL.**

## Light and colour

### Iridescent sheen, driven by tilt

Oil-slick colours across the glass, as a conic gradient in `overlay` or
`soft-light`.

The trap: it must **not** mirror with the pattern. Real glare comes from the
objective lens and the room, not from inside the chamber, so a sheen that
repeats six times reads as a sticker. It lives in screen space, after the
tiling.

The thing that sells it: rotate it with the device tilt, which `lib/tilt.ts`
already reads live. Tip the phone and the sheen slides across the glass. That
one connection is the difference between a surface and a filter. **2D**, better
in **GL**.

### Facet sparks

Brief specular hits on individual pieces as they tumble, alpha driven by each
piece's `rotation` against a virtual light. One small radial gradient per lit
piece. Makes a settling pile feel alive rather than merely animated. **2D.**

### Glitter

Real glitter is thousands of tiny flat mirrors at random orientations, and it
does not glow — it *flashes*, one flake at a time, as the angle between you, the
flake and the light passes through alignment.

That is the whole trick, and it is why glitter looks fake when it is drawn as
sparkly dots: the flashes have to be driven by something real. We have the real
thing already — device tilt. Each flake gets a fixed random normal, and its
brightness is a sharp power of the half-vector alignment. Tilt the phone and
they fire in waves across the field.

Suspended in the oil cell below, this is probably the single prettiest thing on
this list. **GL** — thousands of instanced points with per-flake normals is a
shader's home ground and a 2D canvas's worst case.

### Thin-film interference on piece edges

Soap-bubble colours mapped from piece thickness. Physically motivated rather
than invented. **GL.**

### Mirrors that are green

Silvered mirrors are green — iron in the glass — and every bounce multiplies it.
Photograph a real kaleidoscope and the outer reflections go dimmer *and* greener
while the middle stays neutral.

We already dim by distance in `#mirrorFalloff`, and `#stampField` already varies
each hexagon by `cellNoise(i, j)`, so tinting by bounce count is a handful of
lines on machinery that exists. Small change, disproportionate payoff: it is the
kind of thing that reads as photographic without anyone being able to say why.
**2D.** Do this one early — it is nearly free.

### Bloom on the bright facets

Glass catches light and blooms. Cheap in **GL**, painful in 2D.

## Distortion

### Barrel and pincushion

Same annulus technique as the bead, applied to the whole field. Reads as a cheap
plastic tube lens, which is authentic to actual toy kaleidoscopes rather than a
defect. **2D**, trivial in **GL**.

### Wavy antique glass

Sample in horizontal strips with a sinusoidal offset — old hand-rolled glass. Very
cheap: N strip draws. **2D.**

### Refraction at the mirror joins

Real mirrors bend the image in a thin band either side of their cut edges. The
geometry is already in hand — `#drawSeams` knows where every join is. **GL.**

### Depth of field

Pieces nearer the eye slightly soft. We have a per-piece radius to drive it.
Needs `ctx.filter` in 2D, which wants Safari 17+ and a fallback; free in **GL.**

## The chamber

### An oil cell

Many real kaleidoscopes suspend the glass in oil, and the pieces drift and
settle slowly, almost floating. This is damping and buoyancy constants on the
solver we already have — close to free, and a completely different mood from the
dry cell. **2D.** Best value on the whole list for the effort.

### Actual fluid, on the solver we already built

The unusual-physics one, and the reason it is realistic to want it: **Position
Based Fluids** (Macklin & Müller, 2013) is XPBD with a density constraint, and
`lib/chamber.ts` is already an XPBD solver doing substeps and constraint
projection. A fluid is not a different engine here. It is another constraint in
the loop we have.

That gives real liquid in the cell — glass pieces displacing it, glitter carried
in the currents, the whole cell sloshing when you tilt the phone, because the
gravity vector feeding it is already the real one.

Rendered as screen-space metaballs, which is another piece of luck: pieces are
*already* chains of 2–4 circles for collision, so the metaball field is sitting
there waiting to be drawn. **GL** to render; the solver work is **2D**-agnostic.

### Smoke and ink

Stable-fluids advection on the GPU — the standard Stam solver, cheap at modest
resolution on a phone. Ink drifting through a kaleidoscope chamber is genuinely
unusual and would look like nothing else. Separate from the liquid above: this
is a grid, that is particles. **GL.**

### Polarised mode

Polarising film plus cellophane is how real kaleidoscopes get those electric
interference colours. Map piece thickness to an interference hue. Striking, and
physically motivated. **2D.**

## Housekeeping

### Replace or drop `bright-gems` and `cut-stones`

The two remaining stand-ins, keyed out of flattened stock previews, not cleared
for redistribution. Blocked on new pictures.

### `flowers.webp` has no alpha channel

The only set of the seven without one. It works — the tracer falls back to
keying against the border colour and finds twelve objects — but a
transparent-background export would trace more precisely.
