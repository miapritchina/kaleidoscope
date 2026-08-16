# Roadmap

Things worth building, why they are worth building, and what they cost. Nothing
here is a commitment; it is a list to argue with and pull from.

Each item says which renderer it needs. **2D** works on the canvas pipeline that
exists today. **GL** needs the WebGL move in "The renderer" below, because it is
per-pixel work that a 2D canvas can only fake badly. That split is the main
thing this list is for: several of these are cheap once the renderer moves and
unaffordable before it.

## The renderer

### ~~Move compositing to WebGL2~~ — done

`lib/compositor.ts` and `lib/fold.ts`. The figure is a fold rather than a
drawing: each pixel is reflected back into the source triangle instead of each
triangle being placed. See "The mirrors, folded instead of drawn" in the README
for the arithmetic and the measurements.

Everything **GL** below is now unblocked.

No library in the end. The whole render is three passes, which is not a scene
graph, and a scene-graph engine would have been weight carried and not used —
so it is raw WebGL2 and costs 4.7 KB gzipped. The sizes that were on the table,
kept for whenever a later effect needs more than three passes:

| | version | unpacked |
| --- | --- | --- |
| `ogl` | 1.0.11 | 423 KB |
| `twgl` | 7.0.3 | 1.16 MB |
| `regl` | 2.1.1 | 1.21 MB |
| `three` | 0.185.1 | 23.2 MB |
| `pixi.js` | 8.19.0 | 72.4 MB |

The 2D path stayed. It still paints the source triangle for both renderers, it
still exports the seamless tile, and it is the whole renderer where WebGL2 is
missing.

### ~~Add a web app manifest~~ — done

`public/manifest.webmanifest`. Added to the home screen it opens with no browser
chrome, which is the difference between a page about a kaleidoscope and a thing
you pick up and turn.

The icon came with it. What was there was a placeholder logo from a template,
with nothing to do with this app — so the icons are now renders of the
instrument itself, framed on a rosette, with a wider crop for the maskable one
so Android's circular mask lands inside the figure rather than on an edge.

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

A first version of this already ships as part of the fold: the outer channels
are read from folds of their own, so the split obeys the mirrors rather than
smearing across them. It is small and tied to distance from the axis. The bead
wants a much stronger version, tied to the sphere's own rim.

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

### ~~Glitter~~ — done

`glitterAt` in `lib/compositor.ts`, behind a **Glitter** slider.

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

### ~~Mirrors that are green~~ — already done when this list was written

Silvered mirrors are green — iron in the glass — and every bounce multiplies it.
Photograph a real kaleidoscope and the outer reflections go dimmer *and* greener
while the middle stays neutral.

Listing this was a mistake on my part: `MIRROR_TINT` has been per-channel since
long before, at `{0.958, 0.983, 0.975}`, and both renderers raise it to the
bounce count. The shader made it *more* right, because the count it is raised to
is now exact rather than a radial estimate — but the green itself was never
missing.

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

### Two things that were tried and did not work

Both were proposed off the back of the WebGL move, on the reasoning that
compositing had left the CPU and the freed budget should go into physics. Both
were measured and neither paid. Written down because they are the obvious ideas,
and without the numbers they will be had again.

**A broad phase.** The solver tests every pair against every other, so cost goes
up as the square: thirty pieces to four hundred is thirteen times the glass and
fifty-two times the work. A uniform grid over the chamber does prune well — 71%
of pairs at sixty pieces, 74% at four hundred. It was still **slower**: 0.435
ms/frame against 0.332 at sixty pieces.

The reason is that the pairs it prunes are two subtractions and a compare, while
every pair it keeps costs a function call through the visitor. Measured with the
grid disabled but the callback still in place, sixty pieces cost 0.427 ms — so
almost all of the loss was indirection, not the grid. Inlining the traversal into
the solver would recover that, and the whole thing would still only matter past a
hundred-odd pieces, which is more than the instrument wants.

**More substeps.** The theory is Macklin's, and it is why there are four rather
than one. Going further does nothing:

| substeps | ms/frame | overlap mean / 95th | creep |
| --- | --- | --- | --- |
| 2 | 0.184 | 6.75% / 19.3% | 0.025 |
| 4 | 0.358 | 6.64% / 20.6% | 0.055 |
| 8 | 0.677 | 6.68% / 21.4% | 0.144 |
| 16 | 1.347 | 6.93% / 19.2% | 0.196 |

Accuracy is flat and the pile jitters roughly eight times as much, for seven
times the cost.

### Make the solver rate-independent

Which is what the table above is really saying. The constants are all *per pass*
— `SEPARATION` resolves 80% of an overlap per pass, `FRICTION` converts 55% of
the slip per pass, and the sleep thresholds are velocities. So changing the
number of passes changes the material rather than refining the answer, and there
is no reason for accuracy to improve.

Creep rising is the same fact from the other end: velocity is read back as
`(x - previous) / step`, so a correction of a fixed size reads back as a larger
velocity when the step is smaller, and a settled pile stops falling under
`SLEEP_SPEED` and never gets to sleep.

The fix is to say those things in units that do not depend on the step —
compliance for the contact rather than a fraction, a Coulomb coefficient against
the actual normal impulse rather than a share of the separation, and sleep
measured on how far a piece moved rather than how fast it is going. Then
substeps would converge, and the chamber would be tunable in numbers that mean
something.

Worth doing, and not casually: it re-tunes a feel that took a long time to get
right, and every number in it would move. **2D** — nothing here needs the GPU.

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
