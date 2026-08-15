# Kaleidoscope

An interactive kaleidoscope, rendered on a 2D canvas. A triangular tube of three mirrors
tiles the field with repeating hexagons, the way a real one does. Feed it a generated
chamber of tumbling objects, a photo of your own, or a live camera feed. Built with React
19, TypeScript and Vite.

Swipe across the artwork to turn the cell. Every look is described by a small set of
settings, so a generated pattern can be reproduced from its seed or shared as a link.

What might come next, and what it would cost, is in [ROADMAP.md](ROADMAP.md).

## Getting started

```bash
npm install
npm run dev
```

The dev server prints a local URL (http://localhost:5173 by default).

## Scripts

| Script                  | What it does                                |
| ----------------------- | ------------------------------------------- |
| `npm run dev`           | Vite dev server with hot module replacement |
| `npm run build`         | Typecheck, then build to `dist/`            |
| `npm run preview`       | Serve the production build locally          |
| `npm run typecheck`     | TypeScript, no emit                         |
| `npm run lint`          | ESLint (type-aware)                         |
| `npm run format`        | Prettier, write                             |
| `npm run test`          | Vitest, single run                          |
| `npm run test:watch`    | Vitest, watch mode                          |
| `npm run test:coverage` | Vitest with a V8 coverage report            |

## How it renders

A kaleidoscope is a small chamber of loose chips seen through mirrors, and the renderer
works the same way:

1. **The light.** It sits at your eye, the way a phone's torch does next to its lens. So
   the pieces are opaque solids lit from the front: a facet turned towards you is the one
   that comes back bright, a facet ground away from you goes dark, and the specular peaks
   in the same place the shading does rather than off to one side. Behind them the ground is
   white — the objects are the subject, and white is what a photographer would stand them
   on, which is also what the pictures they come from were cut from.
2. **The source.** `lib/scene.ts` holds the object chamber — loose pieces in a bounded cell,
   simulated in `lib/chamber.ts`. `lib/media.ts` substitutes a photo or a camera frame for
   that cell. Each chip is a pre-rendered sprite (`lib/chips.ts`), see below.
3. **The triangle.** Once per frame the source is painted from scratch onto the surface the
   mirrors sample (`lib/renderer.ts`). From scratch every time rather than drawn over: the
   pieces composite with `multiply` and `lighter`, neither of which is idempotent, so a
   still pile stamped over its own remains walks away from a single pass of it.
4. **The mirrors.** Six mirrored triangles are assembled into one hexagon (`lib/tiling.ts`),
   and that hexagon is stamped across the field on its translation lattice, so neighbours
   meet mirror to mirror.
5. **Where it sits.** The field is offset by the source triangle's own centre, so that
   triangle lands in the middle of the view. `traceTriangle` puts the apex at the origin,
   because that is the corner all six are assembled around — laid straight onto the middle
   of the screen it puts six apexes there, and the one triangle every other is a reflection
   of ends up off in a corner. The interesting part belongs where people are looking.

Drawing the source once and blitting the result keeps the per-frame cost proportional to
the source rather than to `source x triangles` — and building the hexagon once means the
field costs one blit per hexagon however many are on screen.

Each triangle's clip is bled a couple of pixels past its seam, onto a surface that carries
a matching margin. Without both halves of that, two antialiased clip edges each cover the
boundary pixel about halfway and composite to roughly 75%, letting the backdrop show
through as dark spokes.

### The mirrors, folded instead of drawn

Steps 4 and 5 above describe the figure being *drawn*. On any browser with WebGL2 it is
not: `lib/compositor.ts` runs those two steps as a fragment shader, which asks the
opposite question. Rather than working out where to put each triangle, it takes each pixel
and folds it back into the one triangle the source is painted in. `lib/fold.ts` is that
arithmetic, in plain TypeScript, and the shader is a transliteration of it — the two are
meant to stay the same routine.

The fold works in a skewed frame where the tiling is whole numbers. Writing

    u = x/side - y/(side*sqrt(3))      v = 2y/(side*sqrt(3))      w = 1 - u - v

makes `(w, u, v)` barycentric coordinates for the triangle's corners: the source triangle
is exactly `u, v, w >= 0`, and every mirror in the plane is a line where one of them is a
whole number. Three quantities then fall out as arithmetic rather than bookkeeping —
**which mirror to reflect in** is whichever went negative, **how many mirrors were
crossed** is how many whole numbers lie in between, and **how far the nearest join is** is
the distance to the nearest whole number.

Reflecting until all three are positive does terminate, but it takes a step per mirror
crossed and the corner of a phone screen is thirty-odd mirrors out. So the point is first
moved by a whole number of lattice steps — one jump, in closed form — which lands it in the
hexagon around the origin, where the six triangles are a dihedral group of order six and
nothing is more than three reflections from home.

Three things come out better for it, and all three are the same thing: the shader knows per
pixel what drawing only knows per triangle.

- **The bounce count is exact.** The falloff below stops being a radial gradient standing
  in for the count and becomes the count, so the dimming follows the tiling instead of a
  circle drawn over it.
- **The joins are measured, not stroked** — solid across the cut and softened over the last
  pixel either side, at any size.
- **Reflections stay sharp.** Nothing is resampled off a pre-drawn hexagon.

It also buys a thing the 2D path cannot fake at all: a little dispersion at the rim, where
the outer channels are read from folds of their own rather than nudged, so the split obeys
the mirrors instead of smearing across them.

The 2D path is not a legacy. It still paints the source triangle for both renderers, it
still exports the seamless tile, and it is the whole renderer wherever WebGL2 is missing —
so the shader is a branch, not a rewrite. The shader draws onto a surface of its own that
is blitted onto the visible 2D canvas, which is what keeps the debug overlay and the PNG
save working against one surface holding the finished frame.

Both paths were driven over the same frozen frame — one scene, settled by a fixed number of
fixed steps, so that the comparison is not of two different simulations. They agree
everywhere except in the falloff: **mean difference 11 levels out of 255, worst 40, and
100% of the frame within 32.** The falloff difference is deliberate and is the whole point
— brightness against distance from the middle comes out at a ratio of 1.000 at the centre,
0.955 halfway out and 0.859 at the far corner, because the true wall-crossing count is
about 1.9x the estimate `2r / (side * sqrt(3))` the gradient uses. The rim is darker than it
was, and it is darker because it should be.

Timings were taken under a software rasteriser (SwiftShader), where per-pixel work is far
more expensive than on any real GPU, so they bound the risk rather than predict a phone:
157 ms/frame against the 2D path's 335 ms on the same machine.

### The mirrors are not free

Each bounce loses a few percent of the light, and it loses it unevenly: a household mirror
is silvered behind a sheet of glass the light has to cross twice, and glass absorbs red,
which is why the far end of a corridor of mirrors is green. The cell you are looking
straight down has taken no bounces; every cell further out has taken more.

That count is what sets the falloff, and the view is multiplied by `reflectance ^ bounces`
per channel. Brightest and truest on the axis, dimmer and greener towards the rim, and it
applies to the bare backdrop as much as to the pieces, because the mirrors do not know the
difference.

Where the count comes from is the difference between the two paths. The shader has it
exactly, per pixel, out of the fold. The 2D path cannot, so it estimates: neighbouring
cells sit one lattice step apart and a step is two reflections, so a point `r` out has been
through about `2r / (side * sqrt(3))` of them, drawn as a radial gradient. That estimate is
low by about 1.9x, because walking outwards crosses all three families of mirror lines and
not just the one the lattice step is measured along.

### The joins, and the barrel

Three mirrors meeting in a tube have edges, and you can see them: a hairline at every
triangle boundary, where the silvering stops and the mirror is cut. Without them the
reflections run into each other so cleanly that the figure reads as a printed pattern
rather than something assembled out of parts.

Every triangle edge lies on one of three families of parallel lines, sixty degrees apart
and spaced `side * sqrt(3) / 2` — the height of the triangle. Drawing the three families
straight is both exact and cheaper than outlining the triangles, which would stroke every
edge twice, once from each side, and leave the joins twice as dark as the rest. They are
part of the framework, so they hold still as the cell turns; drawn inside the turning cell
they would sweep across the pieces like a fan.

Over the top of all of it is the **barrel**. A kaleidoscope is a tube with an eyehole at one
end, so the field of view is a circle and it does not end abruptly — the further off the
axis you look, the more of the barrel is in the way. That is a separate thing from what the
mirrors cost: those dim the light on its way through and are multiplied into it, while the
barrel is in front of them and simply lies over the top.

### The pieces

A piece is a cut solid, and it is built as a **mosaic of flat faces** rather than a shaded
blob. Each face is filled at one level, worked out from how far its normal turns from the
line of sight — which is also the line the light comes down. Airbrushing a soft falloff
over the whole thing instead is exactly what makes a rendered solid read as moulded
plastic.

Two layers are rendered per cut, and kept apart because they composite differently:

- **The shading** is how much of the light each facet returns, stamped with `multiply`.
  The flat top faces you and comes back brightest; the ring of ground bevel faces is tilted
  away and comes back darker, each face by its own amount. The rim is darkest of all — the
  last sliver before the piece turns away from you entirely.
- **The blaze** is the specular on top, stamped with `lighter`: a soft sheen across the
  facets that face you, and nothing on their neighbours.

Neither says anything about what a piece is made of, and there is nothing here that does.
The colour comes from the picture; these two only say how much of the light each facet
returns. They are used where a picture yields no separable objects and a piece falls back to
a generated shape with a patch of it inside — see below.

### Cutting the pieces out of a picture

`lib/skin.ts` turns a picture into the pieces themselves, rather than into a surface laid
over generated ones. This is what the chamber is normally loaded with; the drawn shapes are
what is left when there is no picture.

**Tracing an object.** Each blob is turned into a 28-corner outline by casting rays out from
its own middle — a star-shaped approximation, exact for the compact, roughly convex things
this is for, and it cannot produce the self-intersecting mess a contour walk gives on a ragged
edge. The two details that decide whether it looks like the object:

- The picture is worked at **160 pixels** a side, not 96. The objects are traced off that
  raster, so it sets how well their edges come out: at 96, a photograph of nine beads left
  each one about twenty pixels across, and a silhouette traced at twenty pixels and drawn two
  hundred wide is visibly scalloped. The beads came out as flowers. It is scored once per
  picture, so being finer costs a few milliseconds, once.
- Each ray finds the edge to **below a hundredth of a pixel**, by reading the mask bilinearly
  between pixel centres — which turns its staircase edge into a ramp that crosses a half where
  the edge really is — and then halving the gap six times. Stopping at the last whole pixel
  instead rounds every ray to the raster _independently_, so neighbouring rays land a pixel
  apart on a shape that has no such step in it.

Measured on a picture of round beads: how far each ray lands from the one beside it fell from
**3.7% of the radius to 0.7%**, and the worst outline's roundness went from 0.90 to **0.97**.
Long thin objects stay long and thin — a splinter's shortest ray is still under a third of its
longest — so this is noise being removed rather than corners being rounded off.

**Object sets.** A set is a PNG or WebP of a few objects on a transparent background. The
bundled ones are discovered from the files rather than listed anywhere: dropping one into
`src/assets/objects/` adds a preset to the **Source** control and removing it takes one
away, with no registry to keep in step and no way for the list and the files to disagree
(`lib/objectSets.ts`, and see the README in that folder for what a picture has to be). Which
one the app opens on is a single name in that module, and if the picture it names is missing
the first set is used instead, so the name cannot put the app in a state the files do not
support. One entry is not a file — **Upload a photo** takes one of your own.

Each set is shown with a **thumbnail beside its name**, because the names are no help on
their own: "Cut gems" and "Bright gems" are two different pictures and one description. That
means the control is a listbox rather than a `select` — an `option` carries text and nothing
else on every browser — so arrow keys, Home and End, Enter and Space to choose, Escape to
close and the combobox announcements are all built in `controls/PictureField.tsx` rather than
inherited. The thumbnails live in `assets/objects/thumbs/` and are a few kilobytes together;
the sets themselves are fetched only when chosen, so opening the app downloads one picture. They sit in the same list as
**Mirror a photo** and **Camera**, because a chamber of objects, a flat photograph and the
live camera are three answers to the same question. They were two controls once, and the one
that chose between them decided whether the other was rendered at all — so leaving it on
Photo took the object sets out of the panel entirely, with nothing to say why. There is nothing else: a
chamber is loaded with objects out of a picture, or it is empty. Without one, nothing is
drawn at all, which is a truer answer than a chamber full of shapes nobody chose.

Five of the seven that ship — **Glass shards**, **Stone beads**, **Cut gems**, **Rough
jewels** and **Flowers** — are the owner's own work. The other two, **Bright gems** and **Cut
stones**, are stand-ins from an earlier round, keyed back out of flattened stock previews and
not cleared for redistribution; replacing them is a matter of putting different files in the
folder.

A picture comes apart cleanly when it is a few separate things on a plain backdrop, which is
what a set of cut-out gemstones is. The picture is sampled to 160x160 and everything that is
not backdrop is flood-filled into separate objects. What counts as backdrop depends on what
the picture is: an image with meaningful transparency — at least a twentieth of it clear —
has already been segmented by whoever made it, so its alpha decides and the colour is never
consulted. Judging a cut-out by colour instead punches holes through a diamond with
near-black facets, because near-black is near the transparent ground's own colour. Failing
that, the backdrop is the median of the border pixels and a pixel belongs to an object when
it sits far enough from it.

Each object is traced by casting rays out from its own middle and taking the furthest pixel
along each: a star-shaped approximation, exact for the compact things this is for and
incapable of the self-intersecting mess a contour walk gives on a ragged edge. What comes
back is a silhouette and the rectangle the object occupies, in a shared frame, so clipping
to one and drawing the other lines them up. The silhouette is pulled in 7%, because at that
sample size the ring where an object meets the backdrop is a blend of the two and reads as a
halo drawn round it. Objects keep their own proportions, so a splinter stays a splinter
rather than being stretched to fill a circle.

Nothing on this path is lit. The photograph arrived with its own light in it, and a second
one laid over the top only argues with the first.

Three guards decide whether a picture is that kind at all: an object covering more than 55%
of the frame is not an object but a picture with no backdrop, one under 0.2% is a speck, and
fewer than three of them is not worth switching for. Failing any of those — a landscape, a
live camera — a piece falls back to a generated shape filled with a patch of the picture,
and that shape _is_ a solid, so it takes the lighting. Where that patch comes from is
weighted by how much of it sits away from the backdrop colour, so a picture that is mostly
empty does not give a chamber of empty pieces.

None of it is per frame. A camera feed is not rescored as it plays: reading a canvas back is
a pipeline stall, and a live feed is interesting all over anyway. A cross-origin picture
taints the canvas and cannot be read at all, which is a reason to cut it at random, not a
reason to refuse to draw it.

Outlines are irregular polygons generated from a seed fixed by the shape and the cut, so
every piece looks broken rather than stamped while staying identical between runs — the
sprite cache and the seeded scene both depend on that. Building all of this per chip per
frame would mean a dozen path fills for every one of hundreds of draws, so each
shape-colour-cut combination is rendered once into a small canvas and stamped from then on:
the same trick the mirror triangle uses, one level down.

Chips are drawn a little larger than the footprint they collide with. A real chamber is
several pieces deep and the simulation is one layer, so at exactly the collision radius
nothing ever overlaps anything, and a heap of solids that never once occludes each other
reads as a scatter of stickers rather than a pile.

Everything under `src/lib/` is plain TypeScript with no React imports, which is what makes
the interesting parts testable without a browser.

## Layout

```
src/
  components/    Canvas surface and the control panel
    controls/    Small labelled form fields
  hooks/         Animation frame, element size, media queries, settings, gestures, photo,
                 camera, device tilt, shake
  lib/           Rendering engine, chamber physics, piece shapes, tiling, object sets,
                 tilt, shake, settings — no React
  test/          Vitest setup and a fake 2D context
```

## Settings

| Setting          | Range                  | Effect                                         |
| ---------------- | ---------------------- | ---------------------------------------------- |
| Source           | a set, a photo, camera | What the mirrors are pointed at                |
| Pieces           | 4–60                   | How many are in the chamber                    |
| Mirror size      | 0.5x–3x                | How wide the mirror triangle is                |
| Mirror angle     | 0–120°                 | Which way up the tube is being held            |
| Real gravity     | on/off                 | Let the phone's position say which way is down |
| Show the mirrors | on/off                 | Draws the triangle, and points at gravity      |
| Seed             | any text               | Seeds the chamber; same seed, same arrangement |

**The gestures are for the contents and the panel is for the instrument.** Swiping turns the
tube, pinching sizes what is in it and two fingers move it about; the one thing the hand
cannot reach is how wide the mirrors themselves are, so that is a slider. They were the same
control once, which meant widening the tube also enlarged the picture inside it — two things
at once and no way to have either alone.

How big the pieces are has no slider: it is a pinch, or a scroll over the artwork. It still
travels in a shared link.

There is no mirror count, because a tube has three, and no spin control, because it is
swiped.

## The mirrors

A real kaleidoscope is a **triangular prism of three mirrors**. Reflecting in its three
sides generates the (3,3,3) triangle group: six equilateral triangles meet around every
vertex, alternating mirrored, to form a hexagon — and those hexagons repeat across the
whole field by translation. What you see fills the view; it is not a single rosette spun
about the centre.

The repeat is a genuine translation because composing reflections in two parallel mirror
lines is a translation of twice their spacing. The lines lie `side * sqrt(3) / 2` apart, so
the lattice steps by `side * sqrt(3)`.

The mirror triangle is **inscribed in the object cell**, the way a real tube's mirrors span
the round chamber at the end of it: the cell is centred on the triangle's centroid and
reaches all three corners. Hung off the corner the six triangles are assembled around
instead, most of the chamber sits outside the view and turning sweeps the pile clean out of
it, emptying the field. The mirrors cut the chips at the triangle's edges and each one
continues into its own reflection, which is what fills a real chamber. Cell size alone
would set both the size of the pieces and how many land in view, so the pinch scales them on
its own — and it scales them in the simulation rather than at draw time, so a bigger piece
displaces its neighbours and the pile settles differently. Scaling only the sprite leaves
every arrangement identical and merely draws it larger, which is a picture of the same
chamber rather than a different one.

Older links carried a mirror arrangement this app no longer offers. They still open, on
whichever of their settings still mean something.

## Turning the cell

The **mirror framework does not move**. Plenty of real kaleidoscopes are built this way:
the mirrors are fixed in the barrel and the chamber of glass turns against them on its own
bearing. Rotating the whole tiling instead sweeps the figure around the screen, which reads
as a picture being spun — and it drowns the thing actually worth watching, which is the
glass falling.

Swipe across the artwork. Left-to-right or top-to-bottom turns it anticlockwise, and the
swipe's speed sets how fast. Let go mid-swipe and it **coasts** to a stop within a second
or so, the way a real barrel does. That matters more than it sounds: the pieces only move
while the tube is turning, so a turn that ended with the finger gave the pile a fraction of
a second to avalanche in — not long enough to see it happen at all. Measured on the built
app, a thumb-flick now keeps the field changing for two to three seconds before it settles.
Hold still mid-swipe and it holds still; touch it again and the coast stops dead.

The cell turns and gravity does not, so gravity does not point "down" in the cell's
coordinates — it points down in the **world**, and turning sweeps that direction around it.
That is the whole mechanism: the pattern does not change because something is rotating, it
changes because turning tips the pile, it avalanches, and it settles into a new one.

### The cell is the triangle

The glass is bounded by **the three mirrors themselves**, not by a disc around them. Plenty of
kaleidoscopes are built each way — a wheel of glass turning behind a fixed triangular window,
or a dry cell whose walls _are_ the mirrors with a pane at either end — and here the second is
better by a long way, because everything simulated is inside the triangle and so everything
simulated can be seen.

A disc around the triangle looks reasonable and behaves badly. Only **41%** of it falls inside
the triangle at all, and a settled pile lies along its rim, which is outside the triangle
everywhere except near the three corners. Measured on the built app with ten pieces in the
cell and the instrument held upside down, the triangle came out between **0% and 4.2%**
covered depending on the mirror angle: the glass fell out of view, and turning the mirrors
changed which corner it peeked into. With the triangle as the cell, the same measurement gives
**4.0% to 4.2%** at every angle, and at the default thirty pieces the pile sits where gravity
points to within a degree whatever the mirrors are doing.

The corners are taken off, at 0.78 of the circumradius. Where two mirrors meet at sixty
degrees the glass wedges, and a pile that has settled into a corner will not come out again:
tipping the instrument through a right angle moved it **not at all**. Rounded off, it rides
round the corner the way it used to ride round the barrel. Real dry cells are like this too —
the joints where the mirrors meet are taped or glued, and the glass never reaches the corner.

The pieces are smaller to match: the triangle is a little over four tenths of the disc that
would go round it, so pieces cut for the disc pack a triangle solid. At the default thirty
they now cover about two thirds of the triangle and a tip through a right angle still moves
each piece a third of a wall's distance.

Seen from inside the cell — which is the frame the simulation is in — the mirrors turn
backwards as the tube is turned, which is what tips the pile out of one corner and into the
next. It also means turning the tube and tilting the phone are no longer interchangeable: they
compose only when the turn is a multiple of 120 degrees, which is what brings the walls back
onto themselves.

### Weight, and what a contact holds

Two things make a chamber of glass behave like one rather than like a bag of identical
counters.

**Weight.** Pushing two overlapping pieces apart is shared out by mass rather than halved. A
splinter that lands on a bead should be the one that moves; splitting the correction evenly
shoves the bead just as far, and a chamber of mixed sizes then behaves as though every piece
weighed the same. Mass goes with area, so a piece twice across is four times as hard to
shift. It is a push the two pieces give each other, so it cannot move the pair as a whole —
weighting it by anything but mass breaks that, and there is a test on the invariant.

**Shape.** The pieces are _drawn_ as polygons — the silhouettes traced out of the picture they
are cut from — but a polygon solver is a different machine entirely: contact manifolds,
several touch points per pair, a full inertia tensor. Each piece is instead **a chain of two
to four circles laid along its length** (`lib/shape.ts`), which the existing solver of circles
can take without changing what it is.

One circle cannot tell a needle from a pebble. It is the same in every direction, so a sliver
on its end and a sliver lying flat take up exactly the same room, two of them cross straight
through each other, and neither can ever bridge a gap. That is what a photograph of glass
splinters looked like: the pile settled full of air, with pieces resting on nothing at all,
because a single circle held everything a sliver's _length_ away in every direction.

The chain is as fine as the piece is thick, capped at four — the cost of a pair is the square
of that, and the gain falls away quickly. The circles are wide enough to cover the length
without holes and never narrower than the piece really is. Because a contact away from a
piece's middle now **turns** it as well as pushing it, a splinter stood on end lies itself
down, which no single circle can do.

Two numbers come along with the chain. **Bulk** is the area of the traced silhouette over the
area of the circle it was cut to fit, and mass goes with it — a sliver should not weigh what
the pebble beside it does simply because it is as long. **Gyration** is how hard the piece is
to turn, worked out from where the circles actually sit: a uniform disc is `r^2 / 2`, and a
thin rod of the same reach comes out near `L^2 / 3` and is _easier_ to turn, because the disc
has mass out at that reach in every direction while the rod has it along one line.

Measured on the built app, on 60 pieces — the most the panel offers — a chamber of four-circle
splinters costs **2.8 ms** a frame against **0.6 ms** for single circles, and **1.1 ms**
against **0.2 ms** at the default thirty. A piece that is a single circle on its own middle
skips the rotation entirely, so the bundled object sets and the drawn shapes pay nothing for
any of this.

Note that this makes a chamber of slivers **emptier** than a chamber of pebbles for the same
count, because there is genuinely less glass in it — and **Pieces** is the control for that.

**Small steps rather than many passes.** The solver takes four substeps a frame and solves
each once, rather than two substeps solved three times. That is the result of Macklin et al.,
[_Small Steps in Physics Simulation_](https://mmacklin.com/smallsteps.pdf) (SCA 2019): a large
step solved _n_ times converges worse than _n_ small steps solved once each, for the same
work, because the solver always gets to use the newest contact directions instead of iterating
against stale ones. Measured here on a settled pile of thirty pieces, the change took the
deepest overlap between two pieces from **2.2% of a piece's width to 1.3%**, left the pile a
little more willing to move when tipped, and cost slightly _less_ per frame.

**Friction.** A contact also resists sliding, up to `0.45` times how hard the two are being
pressed together — Coulomb's number for glass on glass, roughly, and these are ground and
faceted rather than polished. This is what gives a pile an **angle of repose**. Resolving
only the overlap leaves the glass free to slide across whatever it rests on, so a heap
spreads until it is flat and the least tip sets the whole thing flowing — a chamber of liquid
rather than one of glass. With it a heap stands at a slope, holds through a small tip, and
lets go all at once past a critical one, which is what an avalanche is. There is a test that
settles a pile, tips it 5 degrees and 50, and checks the first barely moves while the second
runs. The wall grips too, and takes the whole of the friction rather than a share, because it
does not move.

Both are position-level rather than impulses: the overlap has just been resolved by moving
positions, so the friction that goes with it has to come out of the same ledger, or the
velocity read back at the end of the substep will not agree with where the glass ended up.

The renderer draws the cell rotated by its own angle, so world-down has to be turned back
by that same angle to land in the cell's axes. Signing that the other way — the easy
mistake, since it reads as "undo the rotation" — sweeps gravity round at twice the turn
rate instead of holding it still, which puts the pile at the top of the screen at a quarter
turn and makes the whole mechanism read as no gravity at all. There is a test that settles
the chamber at twelve angles and checks the pile comes out below centre **on screen** each
time; a test of the chamber alone cannot see this, because in the cell's own coordinates
both signs look equally plausible. Measured on the built app: essentially still at rest, a burst of change on the
swipe, then back to rest.

Contacts are resolved by moving positions and reading the velocity back off how far each
chip actually travelled. Impulses alone leave a pile creeping forever, because gravity
keeps feeding in velocity the contacts never quite take out; here a chip held in place
records no movement, and so comes to rest.

The glass **tumbles** rather than sliding about flat. A chip is a disc, not a point, so an
impulse landing off its centre turns it: each contact removes part of the tangential slip —
the relative speed of the two surfaces where they touch — with an impulse along the
tangent, which sets a chip sliding down the wall rolling, spins both pieces on a glancing
blow, and stops a piece pinned in the pile turning because its contacts have nothing left
to slide against. A uniform disc has `I = m r^2 / 2`, so once the spin that impulse produces
is counted back in it changes the slip by `3 J / m`. Measured on a settled chamber given a
quarter-turn-a-second swipe: peak spin around 8 rad/s, the median chip turning some 50
degrees over two seconds, and every chip back to exactly zero spin within six seconds of
release.

The glass is drawn at its physical size, so what collides is what you see, and it is sized
to pack the chamber to around two thirds by area — a real cell is full, so tipping it
rearranges the pile rather than emptying most of the view.

A photo or camera frame has no physics of its own, so it simply turns with the cell, a
little behind it — a capped lag, which lets it evolve as it turns rather than revolving
rigidly.

Hold **Shift**, use a secondary button, or put a second finger down to move the source
instead of turning it. With two fingers down it is the pair that is tracked rather than
either one: the point midway between them drags the source, and the span between them
zooms it, the way a photo viewer on a phone behaves. Tracking the first finger alone would
shove the source sideways every time the other one squeezed.

Two things make the pinch behave on a real hand. Pointer events arrive one finger at a
time, so between two of them the span reflects one finger that has moved and one that has
not — a transient the hand never made — and the pinch is only read once both have reported
in. And fingers dragging together are never quite parallel, so a change under 6% is left
alone, which is what keeps a two-finger drag from creeping the zoom along with it. The
pinch scales from wherever the zoom already is, so a spread, a lift and another spread
compound rather than starting over, and the Zoom slider follows along live.

Settings persist to `localStorage`, and **Copy link** encodes them into the URL. A shared
link wins over stored settings on load. Both are treated as untrusted input and clamped to
the ranges above, so a hand-edited link cannot push an out-of-range value into the
renderer. `Input` is deliberately absent from the URL and reset on load — a link cannot
carry the recipient's photo, and reopening on `camera` would fire a permission prompt
nobody asked for.

Stored settings carry the release they were written under, and a release that changes what
the app opens on moves that number so they are let go once. Every field in a saved set of
settings is individually valid — an object set chosen a year ago is still a real set — so
nothing else would ever release them, and someone who had been here before would keep
opening on the old picture while the new ones sat unseen behind the chooser. The cost is
that the same release forgets a mirror angle they liked, which is why the number moves
deliberately and most releases leave it alone.

## Photo and camera

Choose **Photo** and pick a file, or drop one anywhere on the artwork.

Choose **Camera** and you have a different instrument. A kaleidoscope has a chamber of loose
objects at the far end; a **teleidoscope** has a lens or a glass ball instead, and mirrors
whatever you point it at. That is what this is — an open-ended tube, with the world for a
chamber. The camera defaults to the **back** one for the same reason: it is something you
point at things, and a phone's front camera points at your face. It is asked for as a
preference rather than a requirement, so a laptop with only a front camera still gets that
one instead of failing outright.

Both stay on the device. The photo is read through an object URL, drawn to a canvas, and
the URL revoked; the camera is a `getUserMedia` stream drawn frame by frame. Nothing is
uploaded, and no frame is stored. The camera is requested only while it is the selected
source, and its tracks are stopped the moment you switch away, so the camera light does not
stay on behind your back.

Shift-drag, or a two-finger drag, moves the source around; pinching those two fingers zooms
it, and a scroll over the artwork does the same for a hand with no second finger on glass.
It follows the pointer and stays where it is let go.

A photo cannot tile the way the shard field does, so zoom is floored at 1x — below that
its edges would show inside the wedge — and its travel is bounded by however much of the
image hangs outside the mirrored area.

The camera draws a fresh frame into the mirrors on every animation frame, so what you see
is live rather than a snapshot.

## The screen

The artwork has the whole screen — under the notch and under the home indicator, which is
what `viewport-fit=cover` in `index.html` buys. Without it iOS insets the whole page by the
safe areas and the picture comes up with a black band above and below it. What has to stay
clear of the notch is the controls, and they hold their own `env(safe-area-inset-*)`.

On it are three buttons in a corner: save the pattern, reshuffle the pieces, open the panel.
They are drawn and not written. A word beside each would be three labels laid over the thing
they are for, and they are faint on purpose — a solid pill in the corner of a picture is the
first place the eye lands, which is the wrong place. The name lives in the accessibility
tree, where it costs the picture nothing. Everything else is behind the gear, because the
point of the thing is the picture rather than the panel.

The window is measured in `dvh`, not `%`. On iOS Safari a percentage height resolves against
the _large_ viewport — the one without the address bar — so the page comes out taller than
what is on screen, and anything anchored to its bottom hangs below the fold until a scroll
collapses the bar and brings the two into line. That is exactly how the drawer used to open:
half off the bottom, and correct after a scroll. The body does not scroll at all; the only
thing that does is the drawer's own contents, and it opens at the top of them.

The panel comes in from the right, or up from the bottom on a narrow screen, and lies over
the artwork rather than squeezing it — the canvas keeps its size, so opening the panel costs
no re-render and no reflow of the pattern. Closed it is not hidden but **absent**: a scroll
container kept in the DOM, moved off-canvas with a transform and hidden with `visibility`, is
the combination iOS Safari paints stale, and it came up as a band of the last frame with the
rest black until something scrolled it. Unmounted there is no hidden layer to paint wrongly
and no `inert` needed to keep a keyboard out of it. Escape closes it from anywhere and hands
the focus back to the button.

Two things live outside the panel for that reason. The document's `<h1>` is in the layout
rather than in the drawer, since the drawer is not always on screen; and so is the live
region, so that a message — a photo dropped on the artwork, say — still reaches a screen
reader with the panel closed.

## Holding it at an angle

**Mirror angle** turns the whole framework and nothing else — which way up you are holding
the tube. It is a fixed attitude rather than motion: it stays put while the cell turns under
it, so it never reads as the picture being spun.

A third of a turn is the whole range. Six triangles around a point, alternately mirrored,
are unchanged by 120 degrees, so a wider slider would only repeat itself twice over.

The cell is drawn _inside_ the framework, so the framework's angle has to come off gravity's
direction as well, or the pile would lean with the instrument — which no real one does. That
is one term in the same sum the swipe and the tilt already contribute to, and there is a test
that settles the chamber at four attitudes and checks the glass still ends up at the bottom
of the screen. The exported tile is stamped upright whatever the angle: a rotated rectangle
does not line up with the sides of a picture, and how you are holding the tube is not a
property of the pattern.

## Tilting it

A real kaleidoscope is held in the hand, and tipping it does not turn the figure — the
mirrors and the chamber are both fixed in the tube. What changes is which way the pieces
fall. **Real gravity** does exactly that: the phone's own rotation is given to gravity and to
nothing else, so the framework stays put on screen and the pile slides towards whatever is
lowest in the room.

It composes with a swipe rather than fighting it. Gravity's direction inside the cell is how
far the cell has been turned plus how far the whole instrument is tilted; turning the tube
sweeps gravity around the cell, and tipping the phone moves it again without turning
anything.

`lib/tilt.ts` holds the arithmetic and nothing else, and the arithmetic is a projection rather
than a formula fitted to the numbers.

The orientation event reports three Euler angles: `alpha` about the vertical, then `beta`
about the device's own x, then `gamma` about its own y. Composed in that order, the rotation
from the device's axes to the room's is `Rz(alpha) Rx(beta) Ry(gamma)`, and the room's upright
direction written in the device's own axes is that matrix's bottom row,
`(-cos b sin g, sin b, cos b cos g)`. Down is its negative, and the screen shows the first two
of those, with the sign of the second flipped because a canvas counts y downwards and the
device counts it up. So **down on screen is `(cos(beta) sin(gamma), sin(beta))`**, and its
angle from the bottom of the screen is the `atan2` of that pair. `alpha` is absent on purpose:
turning on the spot with the phone held out in front of you does not move the glass.

This was `atan2(gamma, beta)` for a long time — the two Euler angles treated as if they were
the components of a vector, which they are not. It is right near upright and wrong everywhere
else, by **11 degrees on average and 45 at worst** over every attitude the app acts on. The
plainest case: rolling a phone in its own plane drives `gamma` to 90 and carries the roll in
`beta`, so held perfectly upright the old formula answered **45 degrees** when the truth was
0, and a 60-degree roll came out as 27 degrees of movement on top of that offset. What that
felt like in the hand is what was reported — tipping the phone away from you swinging gravity
off to the side, on a movement that has no side to it.

The length of that same vector is how much of gravity the screen still has: 1 held upright,
0 laid flat on a table, where down points through the glass and the direction in the plane is
whichever way the hand last shook. Below about a tenth the reading is **dropped** rather than
smoothed, so a phone put down leaves the pile where it was. The debug readout prints the
percentage beside the angle, and marks it `flat` when it stops being believed.

Two details of the plumbing matter as much as the formula. The reading wraps at half a turn —
gravity itself does not mind, being a sine and a cosine, but the smoothing does: asked to move
from just under half a turn to just over, it sweeps all the way round through zero and the
pile slides the wrong way while it does. So each reading is carried on from the last by the
shorter way, and only then smoothed, which is also what takes out the sensor's shiver at rest.

iOS will not report orientation until it has been asked for from a user gesture, which is what
the toggle is. Refused, it says so and stays refused; nothing asks twice.

The sign of the left-to-right reading was wrong until a phone said so: leaning right sent the
pieces towards the raised edge rather than the dipped one. That is the one thing about this
that cannot be checked without hardware in a hand — synthesised events confirm the wiring and
say nothing about which way the world is. It is a unit test now, and so is the projection
above.

## Shaking it

Shaking a kaleidoscope is what a hand does with one without being told to, and what it does
to the glass is not a tip or a turn — it throws the whole pile up and lets it come down
somewhere else entirely. That is a new arrangement, which here is a new seed.

`lib/shake.ts` watches the **change between accelerometer readings** rather than the readings
themselves, because a reading includes gravity: a phone lying still reads about 9.8, and a
phone held still in a hand reads about 9.8 in some other direction. What a shake looks like
is that number moving, quickly and repeatedly. Four jolts of at least 12 m/s² inside 700 ms
make one, and then nothing counts for a further 1.2 seconds — a hand does not stop cleanly,
and without the rest one waggle reseeds the chamber a dozen times over and the figure never
settles long enough to be seen. A phone set down hard is a single spike, which is two jolts —
into the table and out of it — so the count is what tells a knock from a shake.

There is no toggle for it. A setting for shaking a kaleidoscope is a setting nobody would go
looking for. iOS gates the accelerometer behind a permission that has to be asked for from a
user gesture, and there is no gesture here to hang that on without putting a prompt in front
of someone who only wanted to look at the picture — so it asks for nothing. Everywhere the
reading is free it works straight away, and on iOS it starts working the moment **Real
gravity** is switched on, since Safari's prompt covers motion and orientation together.

## Seeing the mirrors

Everything on screen is one triangle and its reflections, and the triangle itself is
invisible by design — which makes the figure hard to reason about when it misbehaves. **Show
the mirrors** outlines it, in the middle of the view where the source is painted, and draws
an arrow for gravity: straight down the screen until the instrument is tilted, and then
wherever the room says. Between them they answer most of "why is it doing that".

The triangle turns with the framework, being part of it. The arrow does not: the floor is
where it is however the instrument is held, and watching it stay put while the figure turns
under it is most of what it is for.

Along the bottom it also writes out **what the device is being told**: the accelerometer's
`x`, `y` and `z`, the orientation's `α`, `β` and `γ`, and — beside them — where the app has
decided down is. The overlay on the canvas says what the instrument thinks; this says what it
was handed. When those two disagree, the difference between them is the bug, which is how the
sign that sent gravity to the wrong edge was pinned down. `lib/readings.ts` formats it, signed
and padded, so a column does not jump sideways every time a value crosses zero, and it is
refreshed eight times a second rather than sixty — a readout changing at sensor speed cannot
be read at all.

Every stroke is drawn twice, broad and pale then narrow and coloured. The overlay lies over
a picture that could be any colour, including its own, and a hairline in one ink is legible
over about half the pictures it might land on — no use in a thing whose only job is to be
seen. It is drawn after the barrel, being an instrument laid on the picture rather than part
of the optics, and it is left out of an exported tile entirely.

## Saving a pattern

**Save PNG** writes the frame as you see it. **Save pattern** writes a 1351x780 tile that
repeats without a seam.

It goes to the **share sheet** rather than straight to a download. On a phone a download
lands in Files, and it is the sheet that offers "Save Image" and puts it in the photo
library, which is where a picture belongs. A browser with no sheet saves the file instead.
Dismissing the sheet does nothing at all: that is a rejection rather than a return value,
and taking it for a failure would mean downloading the file behind the back of someone who
just declined. `lib/share.ts` holds that decision, away from the component, because the
branch nobody thinks about is the one worth testing.

### Why it is that shape

The tile is a rectangle cut straight out of the figure, the way you would cut one out of the
screen. Nothing is mirrored and no edges are blended: it is a **period** of the field, so a
copy laid beside it continues the pattern because it _is_ the pattern.

It cannot be square. A three-mirror kaleidoscope tiles the plane on a hexagonal lattice, and
a hexagonal lattice has no square period — `k` steps across can never equal `m` steps up,
because the ratio is `sqrt(3)` and that is irrational. It does have a rectangular one.
Writing a lattice vector as `i*a + j*b`, the ones lying flat need `i = -2j`, so the shortest
is `3 * radius` across; the ones standing upright need `i = 0`, so the shortest is
`sqrt(3) * radius` tall. That rectangle holds two hexagons and nothing smaller works, which
is `lib/tiling.ts`'s `latticePeriod`. 1351x780 is that ratio in whole pixels: it is out by
two parts in ten million, which over the whole width comes to three ten-thousandths of a
pixel.

Three things the screen has are left off it, all for the same reason — each varies across the
view, so baked into a tile it comes back at every repeat as a visible grid:

- the **barrel** and the **mirror falloff**, which are radial. They describe looking down a
  tube, not the pattern, and would put a dark blot in the middle of every copy. This is why
  `lib/renderer.ts` keeps the field and the optics in front of it as separate steps.
- the **per-hexagon exposure**, which is deliberately aperiodic on screen so the field does
  not read as a printed pattern. Here a printed pattern is the point, and that variation is
  the one thing standing between the field and an exact repeat. The variation _between the
  six cells of a hexagon_ stays, so the tile still has facets.

The source is painted again at the tile's own size rather than scaled up from the screen, so
the tile is as sharp as the pieces are and does not depend on the mirror-size slider.

Measured on the built app: laying a copy alongside, the mean step in brightness across the
join is **11.2** across and **6.0** down, against **14.4** and **14.2** for the average pair of
neighbouring pixels inside the tile. The join is smoother than the picture is.

## Accessibility

- Motion is held still when the system asks for reduced motion. A live camera is the
  exception: it keeps drawing and the mirrors are held still instead, because freezing a
  feed on its first frame does not reduce motion, it just breaks what the viewer asked for.
- Every control is labelled; sliders expose formatted values via `aria-valuetext`.
- The canvas carries a text description, and action feedback is announced politely.

## Deploying

`npm run build` emits a static bundle to `dist/`. Asset URLs are relative
(`base: './'` in `vite.config.ts`), so the same build works at a domain root, at a
project subpath, or from the local preview.

### GitHub Pages

`.github/workflows/deploy.yml` builds and publishes `dist/` on every push to `master`.
It requires **Settings -> Pages -> Source** to be set to **GitHub Actions**. The
"Deploy from a branch" option cannot serve this app: it publishes the repository as-is,
including the source `index.html`, which points at TypeScript no browser can execute.

The repository's `.htaccess` is for Apache deployments; copy it alongside the built files
if the site lives there instead.
