# Kaleidoscope

An interactive kaleidoscope, rendered on a 2D canvas. A triangular tube of three mirrors
tiles the field with repeating hexagons, the way a real one does. Feed it a dry chamber of
tumbling objects, the same glass suspended in oil, a photo of your own, or a live camera
feed. Built with React 19, TypeScript and Vite.

Swipe across the artwork to turn the cell. Every look is described by a small set of
settings, so a generated pattern can be reproduced from its seed or shared as a link.

What might come next, and what it would cost, is in [ROADMAP.md](ROADMAP.md). Research
notes and the current plan behind it live in [RESEARCH.md](RESEARCH.md).

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

## Two parts

A kaleidoscope is two things that know almost nothing about one another, and this one is
built that way on purpose.

The **body** is the tube: three mirrors, the framework they are set in, the barrel, the
eyehole, and the glass bead over the far end. It is in `lib/body.ts`, and it is where every
question about the figure is settled — how big the triangle is, how the six of them make a
hexagon, how that hexagon tiles, where the joins go, what the mirrors cost, how the barrel
darkens the rim.

The **chamber** is whatever is at the far end. Loose glass, a cell of oil, a photograph, a
live camera. There are three of them today — `lib/glassChamber.ts`, `lib/substanceChamber.ts`
and `lib/mediaChamber.ts` — and a single switch in `lib/chambers.ts` that picks between them.

Between the two is one small file, `lib/chamber.ts`, and it is worth reading before
anything else here. It is a bargain in two clauses:

- **The body promises** that the chamber is always the same size, that it is handed a clean
  context with the middle of the cell at the origin, that the clock is already clamped, and
  that gravity arrives worked out — one angle, in the chamber's own frame. A chamber never
  sees a mirror.
- **The chamber promises** to fill its own disc. Out to a little past the wall, every pixel
  is covered.

That is the whole of it. Keep those and the figure cannot come out wrong, because the body's
sampling is contained in the disc by construction and the disc is painted. `lib/body.ts`
imports neither the glass nor the substances nor the pictures, so it _cannot_ branch on the
contents; there is no code path where the triangle is right for one kind of chamber and
wrong for another.

It is also why a new chamber is cheap. A video is a `<video>` element handed to the media
chamber, which already takes one. Something genuinely new — a shader, a game, a page of
text — is a file with four members in it and one line in `lib/chambers.ts`.

### Which rotation is which

Three things turn, and they are not the same thing:

- **The body's own angle** — the **Mirror angle** slider. It turns the mirrors, and the
  chamber goes round with them, because the chamber is fixed in the tube behind them. The
  whole figure turns on screen.
- **The chamber's bearing** — a swipe across the artwork. It turns the chamber alone,
  against fixed mirrors, the way plenty of real kaleidoscopes are built. The framework holds
  still on screen and only what is inside it moves.
- **The tilt** — how far the phone is being held over. It turns nothing at all on screen. It
  moves gravity.

The body composes all three into one direction and hands it to the chamber, so gravity is
defined by the mirrors and passed in. Whatever is turned, the floor comes out where the room
put it — which is the one thing a real one does that a spinning picture does not.

## How it renders

The body works the way the instrument does:

1. **The light.** It sits at your eye, the way a phone's torch does next to its lens. So
   the pieces are opaque solids lit from the front: a facet turned towards you is the one
   that comes back bright, a facet ground away from you goes dark, and the specular peaks
   in the same place the shading does rather than off to one side. Behind them the ground is
   white — the objects are the subject, and white is what a photographer would stand them
   on, which is also what the pictures they come from were cut from.
2. **The chamber.** Whichever one is fitted paints itself into its own disc. `lib/scene.ts`
   holds the contents of a cell — loose pieces, or a substance instead of them — simulated in
   `lib/physics.ts`. `lib/media.ts` paints a photo or a camera frame. Each chip is a
   pre-rendered sprite (`lib/chips.ts`), see below.
3. **The triangle.** Once per frame the chamber is painted from scratch onto the surface the
   mirrors sample (`lib/body.ts`), with its middle at the middle of the triangle and its wall
   on the triangle's three corners. From scratch every time rather than drawn over: the
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

Steps 4 and 5 above describe the figure being _drawn_. On any browser with WebGL2 it is
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
`src/assets/objects/` adds a preset to the glass list and removing it takes one
away, with no registry to keep in step and no way for the list and the files to disagree
(`lib/objectSets.ts`, and see the README in that folder for what a picture has to be). Which
one the app opens on is a single name in that module, and if the picture it names is missing
the first set is used instead, so the name cannot put the app in a state the files do not
support. One entry is not a file — **Upload a photo** takes one of your own.

The chamber holds **any number of sets at once**, mixed together: a pile can be gems and
beads and splinters, because a real chamber is loaded with whatever is poured into it and
nothing says that has to come from one jar. So the glass is a **list of checkboxes** rather
than a single chooser (`controls/PictureChecklist.tsx`), and mixing two sets is checking two
boxes. Each set is scored on its own and the pieces are shared out evenly across the ones
that are checked — fixed per piece, so a splinter keeps its own scrap of its own set as it
tumbles (`glassAt` in `lib/scene.ts`). Scoring each separately is not only tidier: a set
keyed by colour rather than by alpha — `flowers.webp` is the one — has no transparency to
carry into a combined picture, so it can only come apart when it is measured alone.

Each box is shown with a **thumbnail beside its name**, because the names are no help on
their own: "Cut gems" and "Bright gems" are two different pictures and one description. The
thumbnails live in `assets/objects/thumbs/` and are a few kilobytes together; a set's own
picture is fetched only when it is checked, so opening the app downloads nothing until a box
is ticked and a set unchecked is not fetched again once it has been. The glass sits behind
the same **Shards** tab as the piece count and the seed, alongside the **View** tab that
mirrors a photo or the live camera — a chamber of objects and a picture pointed into the
mirrors being two different instruments, not two settings of one. A chamber is loaded with
objects out of a picture, or it is empty: uncheck every set and nothing is drawn at all,
which is a truer answer than a chamber full of shapes nobody chose.

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

| Setting          | Range               | Effect                                               |
| ---------------- | ------------------- | ---------------------------------------------------- |
| Source           | glass, liquid, view | Which instrument this is                             |
| Pieces           | 30–150              | How many are in the chamber                          |
| Variety          | one size–widest     | How much the piece sizes differ from each other      |
| Substance        | lava … oil film     | What a cell of liquid holds instead of glass         |
| Amount           | a trace–a cell full | How much of that substance there is                  |
| Thickness        | thin–gel            | How hard the fluid resists what is moving through it |
| Mirror size      | 0.5x–3x             | How wide the mirror triangle is                      |
| Mirror angle     | 0–120°              | Which way up the tube is being held                  |
| Real gravity     | on/off              | Let the phone's position say which way is down       |
| Show the mirrors | on/off              | Draws the triangle, and points at gravity            |
| Seed             | any text            | Seeds the chamber; same seed, same arrangement       |

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

The body draws the cell rotated by its own bearing, so world-down has to be turned back
by that same angle to land in the cell's axes. Signing that the other way — the easy
mistake, since it reads as "undo the rotation" — sweeps gravity round at twice the turn
rate instead of holding it still, which puts the pile at the top of the screen at a quarter
turn and makes the whole mechanism read as no gravity at all. Since the body and the chamber were separated the claim is
tested as arithmetic instead, in `body.test.ts`: whatever is turned — the mirrors, the
bearing, or both — gravity in the chamber's frame less the two rotations the figure is drawn
through comes out at the tilt and at nothing else. That is the same statement, and it does
not need a pile to make it. What the pile is for is the other half, in `glassChamber.test.ts`:
that it gathers wherever gravity actually points. Measured on the built app: essentially still at rest, a burst of change on the
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
instrument. `Input` is deliberately absent from the URL and reset on load — a link cannot
carry the recipient's photo, and reopening on `camera` would fire a permission prompt
nobody asked for.

Stored settings carry the release they were written under, and a release that changes what
the app opens on moves that number so they are let go once. Every field in a saved set of
settings is individually valid — an object set chosen a year ago is still a real set — so
nothing else would ever release them, and someone who had been here before would keep
opening on the old picture while the new ones sat unseen behind the chooser. The cost is
that the same release forgets a mirror angle they liked, which is why the number moves
deliberately and most releases leave it alone.

## A cell of liquid

A kaleidoscope's object cell does not have to hold loose pieces. Plenty of real ones do not,
and the ones that do not are a different instrument entirely — so the **Liquid** tab holds a
**substance instead of glass**. There are no shards in it, no piece count, no pile to settle.
Whatever is in there is the whole content, and the mirrors repeat it.

Six of them, chosen inside the tab:

|              | what it is                                                    | what you watch                                       |
| ------------ | ------------------------------------------------------------- | ---------------------------------------------------- |
| **Lava**     | blobs of a second liquid that will not mix with the first     | them climbing, merging and coming apart              |
| **Drops**    | a heavier liquid draining through a lighter one, bead by bead | it running down, and turning it over to run it again |
| **Smoke**    | a fluid, and the colour carried on it                         | it folding over on itself                            |
| **Ink**      | watercolour let into water                                    | a mixture coming apart into its pigments             |
| **Glitter**  | flakes of foil hanging in clear fluid                         | them flashing as the light sweeps across             |
| **Oil film** | a few hundred nanometres of oil riding the fluid              | the interference bands sliding as it flows           |

All six take the same two controls, because between them they are the whole of what a cell
does to what is in it: **Amount**, which is how much of the stuff is in there, and
**Thickness**, which is how hard the fluid resists whatever is moving through it. Both are
the same question six times over and only a different noun each time.

They are a picker inside one tab rather than six tabs of their own, because eight
instruments across the top of a phone is a tab bar and not a choice.

### The fluid four of them ride

`lib/flow.ts` is the body of liquid itself — velocity on a grid, the wall, the viscosity, the
pressure solve, and the stirring, the tube's and the finger's. Smoke, ink and the oil film
are things carried in it; the glitter's flakes hang in one of their own. What is _in_ the
fluid stays each substance's business.

Three things about it were wrong in ways that were only visible once someone measured them,
and all three are the sort of fault that hides in plain sight because a fluid is _supposed_
to be complicated.

**The wall was a hole.** The divergence a pressure solve removes is measured against the
neighbouring cells, and beyond the round wall there is no neighbour — so it used what the
asking cell already held, which is the right answer for a pressure and the wrong one for a
velocity: a cell against the glass whose neighbour agrees with it has no divergence, so the
solve was told nothing was flowing out and let the fluid straight through. What that did is
not subtle. **A cell with nothing pushing on it at all** — no dye, no turning, the
confinement off — fell to a thousandth of its opening swirl in three seconds and then _grew
back to the speed limit by ten_, fed by the staircase the round wall makes on a square grid.
In a square box, same code, the same field decayed to 10^-25. The wall reflects the normal
component now, which is what a wall is, and the round cell behaves exactly like the square
one. That leak is where the thin end of the **Thickness** slider used to go to NaN.

**It was a turntable, not a fluid.** The wall's grip was applied at full strength to _every_
cell, pulling the whole field towards rigid rotation, and on top of that a drag pulled every
cell towards standing still. Between them an eddy lost about a quarter of itself **per
step**: a finger's wake was gone in a tenth of a second, and nothing anyone did to the cell
survived long enough to watch. Now the wall grips the fluid **against it** and eases off over
a boundary layer; the cell as a whole is brought round to the tube's rate as _one number_,
its own angular rate, so a swirl, an eddy or a wake — anything that is a departure from
turning as a body — is not touched by it; and the dissipation is **viscosity in the shape
viscosity has**, each cell drawn towards the average of its four neighbours, which kills the
smallest swirls first and leaves the largest alone.

That last is what the Thickness slider now _is_. Measured, as the share of a stirred eddy
still moving after a given time:

| Thickness         | 1 s      | 3 s      | 6 s     | 12 s      | 30 s |
| ----------------- | -------- | -------- | ------- | --------- | ---- |
| thin, before      | 37%      | 6%       | 0.4%    | 0%        | 0%   |
| thin, now         | 83%      | 61%      | 42%     | 24%       | 6%   |
| default, before   | 5%       | 0%       | 0%      | 0%        | 0%   |
| default, now      | 72%      | 42%      | 22%     | 7%        | 0.2% |
| gel, before / now | 0% / 56% | 0% / 22% | 0% / 6% | 0% / 0.5% | 0%   |

And because the middle of the cell is only brought round as a body while the rim is dragged
directly, a turn now **shears** what is in the cell. With the tube held at 3 rad/s the rim
settles at 1.9 (thin), 2.6 (default) or 3.0 (gel) and the middle at 1.0, 1.3 and 1.5 — so
ribbons wind into spirals as the tube turns instead of the whole picture revolving.

**The confinement had no ceiling.** Vorticity confinement adds a push proportional to the
curl, the curl is proportional to the speed, so it is an exponential with the viscosity for
its only brake — a race it wins outright at the thin end of the slider. The curl it reads is
clamped now, well above anything a healthy cell shows, which keeps the correction and takes
the runaway; and it also takes the wall's own curl spike out of the sum, which was the
strongest push in the cell and pointed by the grid rather than by any swirl. Under all of it
there is a speed cap that nothing real ever reaches, so no combination of a slider, a frame
time and a swipe can put a NaN on the screen.

### Lava, which is metaballs and a heat cycle

`lib/lava.ts`. Two things make it, and neither of them is a picture of a blob.

**The heat cycle**, which is what a lava lamp actually is. A blob near the bottom warms;
warm means lighter than what it is floating in, so it rises; near the top it cools and turns
heavy again and comes back down. That one loop is the whole motion, and it is why the cell
never settles — the bottom is always making new risers. Nothing else lifts a blob. Measured,
a blob takes about ten seconds to go up and come back.

**The lag is the cycle**, and getting that wrong is subtle. The first version aimed every
blob at a temperature read off its own height, everywhere, all the way up — which sounds
like the same thing and is not. Do that and heat tracks position, so lift always points at
the middle from both directions: it is a **spring**, not a cycle. Every blob converged on the
centre of the cell and stopped there, and the only thing still moving was blobs merging and
splitting. A lamp works because the wax does not cool until it has been at the top for a
while, so it overshoots at both ends. Nothing in the middle touches its temperature at all.

**Metaballs**, which is what makes it read as liquid rather than as a bag of circles. Each
blob lays down a soft field around itself, the fields **add**, and the surface is drawn where
the total crosses a threshold. So two blobs approaching _reach_ for each other and pinch into
one shape before their circles ever touch, and one coming apart necks in the middle first.
The shape is the sum and not the parts.

Blobs that meet properly become one, with the area added rather than the radius — two of a
size make one about 1.4 across — and the colour mixed in proportion, because that is what
two colours of wax running together do. Merging only ever runs one way, so a blob that has
grown past a fraction of the cell is pulled into two along the way it was travelling. Between
them the cell holds a steady population instead of ending as one lump.

Then there is the **stagger**, which is what merging and splitting do to each other if
nothing stops them. Merging makes a blob bigger and splitting makes it smaller, so the two
are a loop. With the split threshold sitting exactly where a merge of two blobs lands, and
the halves placed close enough to meet again, the loop ran at whatever rate the frames
arrived: the whole cell alternated between two arrangements sixty times a second. Measured on
the field, a typical frame moved it by **1.23** — more than a whole blob's worth — where it
should move by 0.015.

Two things fix it, and they are the same thing said twice: wax that has just pinched apart
keeps to itself for a second and a half, and the halves are left overlapping what they came
off rather than set clear of it, so the shape necks instead of one blob vanishing and two
appearing either side of where it was. Placed clear, a split moved as much of the picture in
one frame as two hundred ordinary frames do.

Every other measurement was happy throughout: the blobs were inside the wall, the wax was
conserved, the colours mixed and the count held steady. `lava.test.ts` measures the picture
from one frame to the next now, which is the only thing that would have said so.

Three more things had to be got right and all three were got wrong first, which is worth
writing down because each of them looked reasonable:

- **The sizing has to go through the threshold.** A blob on its own is drawn at 0.54 of the
  distance its field reaches, so sizing the blobs by their reach and not by what is drawn
  gave a cell of dots when it was asked for a cell of lava.
- **And it cannot be done on isolated areas either.** The fields add, so a cell of blobs at
  arm's length already crosses the surface in the gaps between them. Asking for half the cell
  covered, on the arithmetic for blobs that never overlap, filled the entire cell with one
  shape.
- **The palette has to be able to survive being averaged.** Merging averages, and averaging
  colours from opposite sides of the wheel gives mud: a first go with rose, amber, violet and
  teal in it was uniformly the colour of a puddle within a minute. All four are warm now, and
  neighbours on the wheel average to neighbours on the wheel.

**The kernel is the smoothing, and it was a stop too narrow.** The field a drop lays down is
what turns a few dozen particles into a body with a surface, so how wide it is decides how
lumpy that surface comes out — and at the width it was left at, the edge of a body carried a
fine scalloping, a ripple at the spacing of the particles beneath it. Invisible at the default
zoom, plain at the top of the slider. Widened, with the surface threshold raised in proportion
to the square of the reach so the wax covers exactly the ground it covered, the contour is
smooth at any size — the cure for a lumpy contour is a wider kernel and not a finer grid. And
with a smooth surface the light has nothing to catch on, so the shading is back up from where
an earlier correction had left it: at the numbers before this, a screenshot at any zoom showed
flat pink shapes with a coloured edge, which is a sticker and not a body of wax.

### Drops, which is a timer rather than a cycle

`lib/drops.ts`, and it is the [liquid motion
timer](https://www.amazon.ca/Floating-Illusion-Liquid-Motion-27/dp/B01LZNKDNU) off a desk: a
sealed tube of two liquids that will not mix, one a shade heavier than the other. Turn it
over and the heavy one, now on top, has to get back down — and it cannot go as a slab,
because the light one has to come up past it at the same time. So it goes as beads. They
gather on the underside of the pool overhead, hang, stretch, let go, drift down, and are
drawn into the pool growing on the floor.

**It is the opposite of the lava lamp next to it, and that is the reason to have it.** Lava
is a cycle: heat drives it and it never settles. This runs _down_. It is a timer — measured,
a bit over two minutes at the middle of Thickness, a bit over one at the thin end and four in
the gel — and what starts it is the hand.

**Turning the instrument over runs it again.** The pool keeps its own idea of down and
re-levels towards gravity at a limited rate, so a slow turn is followed and nothing happens,
which is right: tipping a real one gently on its side runs it to the low side and leaves it
there. A deliberate half-turn outruns it, and everything on the floor is overhead again. A
shake reseeds the chamber, which for this cell is the same gesture with the same result.

**A surface.** Nothing else in this instrument has one, and it is most of what makes this
cell look unlike any other setting of it. A pool at rest is flat and perpendicular to
gravity, so it cuts the round cell along a chord — and six mirrors fold one straight line
into a hexagram. Where the pools are is arithmetic and not animation: the area of a disc
beyond a chord at `u·R` is `R²(acos u − u√(1−u²))`, which has no inverse worth writing down,
so it is bisected twice a frame. What is stored is how much liquid is at each end, and the
surfaces follow from that. Nothing can drift out of step with anything, and the total is
conserved exactly.

**Two colours, and neither of them is the one you see most of.** The tube is deep, so there
is always some of the light liquid in front of whatever you are looking at: the beads are not
their own colour, they are their colour _seen through_ the other one. That is the whole of
the "floating colour mix illusion" the toys are sold on, and it is why this is composited
with `multiply` — nothing anywhere chooses what a bead looks like, it falls out of two
liquids being transparent. Cream and rose make a crimson; ice and cobalt an ink blue; frost
and violet an orchid. The light one of each pair is **nearly white**, and that is a
correction and not a preference: it used to be a butter or a sky, a light colour but a
colour, and it is most of the cell — so the figure came out as two mid-tones against each
other, which is the one thing a kaleidoscope cannot carry. The mirrors take a few per cent of
the light at every bounce and lean it green as they go, so a picture with no light in it goes
to olive and brick at the rim, which is exactly what a screenshot of the old pairs showed.
The same arithmetic shades a bead: Beer and Lambert say each
unit of liquid passes a fixed _share_ of what reaches it, so what comes through a depth `d`
is the tint raised to `d` rather than scaled by it — and since the metaball field _is_ how
much liquid is in the way, a bead comes out dark in the middle and light at its rim without
being told to be round.

**Metaballs**, borrowed wholesale from the lava and pointed at a different problem. The pools
lay down a field either side of their own surfaces and the beads lay down fields of their
own, so a bead about to let go necks off the pool above it and a bead landing is drawn down
into the pool below it. Neither of those is animated anywhere.

**And the picture is painted two pixels to a cell of that field**, with the pools worked out
at each of them rather than read off the grid. A pool's surface is the one edge in this whole
instrument that the eye _measures_ — it is straight, and a straight line laid down a cell at a
time is a staircase, plain in a screenshot at anything past the default zoom while the same
quantisation in the edge of a bead goes unnoticed. Where the surface is was already arithmetic
rather than a field, so painting it one pixel per cell was throwing away resolution the cell
already had.

**It is the one substance that does not ride `lib/flow.ts`**, and that is on purpose: a
bubbler's liquid is nearly still. What moves is the beads, under weight and drag, and where
the liquid _is_ falls out of an area and a chord rather than out of a grid. It does take the
finger — a drag pushes the beads it reaches, the same rule the wax is pushed with, and sweeping
across a pool tips the whole of it, because a surface is a single object however wide it is.

Three things were got wrong first, and the first two are the same mistake:

- **A bead that appears is not a drip.** A drip is liquid running down into a pendant drop
  until the drop is heavy enough to break its own neck. The first version waited on a timer
  and then put a bead on the surface — and sampled at any given instant the underside of the
  pool was flat, because the waiting was most of the cycle. The wait is spent gathering now,
  so there is always one hanging there, and the neck is the metaballs doing what they do.
- **A bead that vanishes is not a landing.** Same at the other end: deleting it took a bite
  out of the picture on one frame. It is poured in over a third of a second instead, and the
  surface rises to meet it.
- **The bump a bead starts as is liquid, and it has to come out of the pool.** It did not,
  and the cell quietly made about a sixth more liquid than it was filled with. Nothing looked
  wrong; the test that adds up what is in the two pools and what is in flight, every frame,
  is the only thing that saw it. The same test caught the other half of it, which is that a
  pool that only ever gives away a _share_ of what is in it is never empty — so the last of
  it comes down as one dribble, and the cell is allowed to finish.

It is also the cheapest substance in the cell: **0.65 ms per rendered frame** against the
lava's 1.27, the oil film's 3.07 and the smoke's 4.58, measured in one process on the same
machine.

### Smoke, which is a fluid rather than things in one

`lib/smoke.ts`. Where lava and glitter are things _in_ a fluid, this is the fluid: a grid
holding a velocity field and the dye carried on it. It is Stam's _Stable Fluids_ (SIGGRAPH 1999) — advect the velocity by tracing it backwards, make it divergence-free, then carry the
dye along on the result. Semi-Lagrangian advection is unconditionally stable, which is what
makes it safe against whatever frame time a phone hands over.

The roadmap put this on the GPU and per pixel it belongs there. At the size an object cell
needs it does not have to be: 96×96 stepped at 30 Hz with the time banked measures **1.9 ms
per rendered frame**, against the 0.6 the chamber of glass costs — and that mode is not
running a chamber of glass. What it buys is that the smoke lives with the rest of the
chamber rather than in the compositor, painted into the source triangle and folded by the
mirrors with everything else.

Nothing outside stirs it. The tube's turning drags the body of fluid round, and the dye is a
little heavier than what it hangs in, so it falls through itself and the falling is what
curls it: a heavy patch sinks, the fluid it displaces comes up around it, and that is a
plume. The cell is given a few swirls to start with, because round clouds falling straight
down stay round for a long time and it needs a reason to be asymmetric before it can fold
over on itself.

Three dyes, and **subtractive** — the drawing composites with `multiply`, so two dyes folded
together read as the mixture rather than as the brighter of the pair. What each of them takes
out of the light is the part that had to be redone. It used to be one primary each: dye
number _d_ was written straight into channel _d_, which is a printer's cyan, magenta and
yellow at full chroma, and the cell came out looking like a test page. Real dye does not take
out a primary, it takes out a **band** — a rose ink leaves plenty of blue and a little green
— which is why two of them folded together make a colour a painter would recognise instead of
one of six corners of the cube.

So each dye now carries a transmittance per channel and the light is multiplied through all
three: Beer and Lambert, exactly as the liquid timer's beads are shaded, so what comes through
a depth _d_ is the tint raised to _d_ and a ribbon is dark where it is thick and shows its own
hue where it is drawn out thin. The three are a triad an ink-maker would sell — a peacock
blue-green, a quinacridone rose and a turmeric gold — far enough apart to reach the whole
wheel between them and none of them on a primary, so no pair can mix to the flat grey a pair
of opposites gives.

**And the cell keeps its dye.** Tracing backwards is a gather, so wherever the flow crowds two
cells' worth into one it keeps the larger and drops the difference — measured, a cell of smoke
held **82% of its dye after ten seconds, 33% after a minute and 18% after two**. It is
documented in ROADMAP.md as a thing nobody could see directly, because a cell that is emptying
and a cell that is spreading out look the same from one minute to the next, and it was left
alone for as long as it was because the look had been tuned around the fading. The cell is
sealed, the total is a thing that is known, and `conserveScalar` hands back what the step lost:
**100% at ten seconds, at a minute and at two**, at every setting of the Thickness slider. The
dye is weaker to match, because the old strength was partly standing in for the leak.

**Getting smoke rather than fog took two known techniques and a wrong turn between them.**
Tracing backwards and sampling bilinearly is stable precisely because it _averages_, and what
an average takes out first is the smallest swirls — which are the ones the eye reads as
smoke. So:

- **Vorticity confinement** (Fedkiw, Stam and Jensen, SIGGRAPH 2001) measures the curl and
  pushes each cell back towards where the turning is strongest, putting back energy the
  method should not have lost. Taken straight it has a trap of its own: "where the turning is
  strongest" decided by single cells points every cell at its own noisiest neighbour, and the
  result was a row of grid-aligned comb teeth along the edge of every ribbon, plain enough to
  see in a screenshot. One pass of blur over the curl's size first points it at the swirl
  instead of at the grid.
- **MacCormack advection** takes the blur off rather than papering over it: carry the field
  forwards again from where it landed, and wherever that does not arrive back at what was
  there is the error the trace introduced. Half of it comes off, clamped to the range the
  plain trace already found so the correction can sharpen what is there and cannot invent
  anything.

The wrong turn between them was an unsharp mask — take a little of the local average back out
of every cell — which is the obvious way to sharpen and is a trap. Amplifying the difference
from the neighbours amplifies the _shortest_ wavelength hardest, and the shortest wavelength
a grid has is a checkerboard.

### Ink, which is real paint and comes apart

`lib/ink.ts`, and the optics and the paint box are in `lib/pigment.ts`. It rides the same
fluid smoke does. What makes it a different instrument is that what rides it is **paint**,
and paint is not a colour: it is a solid, ground from a rock or a dyestuff, held in water.
Everything here follows from that.

The model is lifted from **paintwheel**, a wet-watercolour simulator, which is built on
Curtis, Anderson, Seims, Fleischer and Salesin, _Computer-Generated Watercolor_ (SIGGRAPH
1997). Everything that model does with _paper_ — deposition, lifting, staining, drying,
backruns, the tooth granulation settles into — is gone, because there is no paper in an
object cell. There is a round glass wall and water, and paint that stays in suspension for
as long as anyone is watching. That is the one case a watercolour model never has to work
for, and the only case this one does.

Four things came across, and every one of them is a thing paint does that a coloured fluid
does not.

**They mix as paint, not as light.** Smoke's three dyes each take one primary out of the
light; that is cheap, correct for dye, and it cannot make green out of blue and yellow —
take red out with one and blue out with the other and what is left is a grey. Paint is
solved differently: each pigment both absorbs light (**K**) and throws it back (**S**) at
its own rate per wavelength, the mixture's K and S add, and the whole layer is solved over
the white behind it as one. Real paints, by Colour Index number, with K and S inverted from
each one's measured mass tone and undertone. So ultramarine and a green-gold yellow give a
green, that green over quinacridone gives the grey a painter would mix, and no pair of them
ever gives the flat mud that averaging colours gives.

Solving that needs an exponential per channel per pixel, which is a millisecond and a half a
frame — as much as the whole fluid step. But the answer only depends on how much of each of
the three paints a pixel holds, so it is solved once onto a lattice of 21×21×21 mixtures
when the cell is filled and read back with a straight interpolation. The lattice is spaced by
the _square root_ of concentration, because that is where the colour changes fastest.

**They come apart.** This is the thing to watch. Quinacridone is milled to a fraction of a
micron and magnetite black is a coarse grit, better than five to one apart in how fast they
fall through water — so a mixture does not stay a mixture. A cloud goes in one colour and
half a minute later it is the two or three paints it was mixed from, sorted by weight down
its length. Measured, from a cloud holding all three in the same place: the heavy one's
middle of mass sits a tenth of the cell below the light one's after twenty-five seconds.

That is why the cell is poured as clouds **of mixed paint** rather than one cloud per paint,
which was the first go and was pointless: three paints dropped in separately are three
colours drifting past each other. They never mix, so they can never come apart, and the
difference between their weights has nothing to act on.

**They clump.** Coarse pigment flocculates — it gathers rather than staying evenly spread,
and the clumps are the mottle a granulating wash is loved for. Ultramarine does it violently
and phthalo not at all, and it is per paint and measured: on an even wash the coarse paint of
a palette varies from pixel to pixel by about **17 values out of 255** against the fine one's
**2**. The clumping is a field of its own, carried by the water like everything else, with a
little fresh clumping folded in every step — because flocs gather and break up again rather
than being a pattern the cell was printed with. Fold it in too fast and the mottle stops
travelling with the paint and sits still in the cell instead, which is paper grain and not
flocculation.

**They have edges.** Where a wash has a boundary, pigment gathers along it and dries as a
dark line, and that line is what everybody recognises a watercolour by. Nothing dries in a
sealed cell, so it is drawn rather than deposited: darken by how fast the amount of paint is
changing, at two cells' radius so the clumping does not itself read as an edge. It costs four
reads a pixel and it is what makes a ribbon read as a shape with an edge instead of as a
smear.

Two more things had to be got right, and both were got wrong first.

**Depth.** Kubelka-Munk over a deep enough layer is black whatever is in it — every paint in
the box and every mixture of them alike. Set where a first go put it, the cell was a slow
churn of near-black shapes: correct, and no use at all. The range where a paint shows what it
is turns out to be under about four times a thin wash. And the depth has to be reached by
every paint _together_, which means pouring the strong ones thinner: tinting strength across
a paint box runs nearly ten to one, so equal parts of a Prussian and a potter's pink is a
cell of Prussian — the one black, the other not there at all.

**A sealed cell cannot lose paint, and this one was losing all of it.** Tracing backwards is
a _gather_: a cell reads what was upstream and it cannot read more than was upstream, so
wherever the flow crowds two cells' worth into one it keeps the larger and drops the
difference. Settling is nothing but crowding. Left to itself, an early cell of paint held
**nothing at all** after two minutes — not settled at the bottom, gone. It went unnoticed for
as long as it did because a cell that is emptying and a cell that is spreading out look the
same from one minute to the next.

Two answers together. The settling is **moved rather than traced**: each cell hands a share
of what it holds to its neighbour downhill and that neighbour keeps it, which is arithmetic
that adds up by construction, and a cell whose downhill neighbour is outside the wall hands
on nothing — so sediment rests against the glass instead of passing through it. And what the
_fluid's_ own crowding still loses is handed back in proportion at the end of every step,
because the cell is sealed and the total is a thing that is known. The honest repair for that
second one is a solver that does not compress — a staggered grid, where the pressure and the
velocity are read at the same points — which is a rewrite to fix something nobody can see
directly. This is the same statement for one multiply a cell.

**One thing smoke has that this deliberately does not: vorticity confinement.** Smoke needs
it — a fluid that only ever averages loses its smallest swirls first, and without them smoke
is coloured blur. A wash does not: its structure is the shape of the ribbon and the rim along
its edge, and the correction keeps both. What confinement does to a wash instead is the thing
it has always threatened to do, and that a blurred curl only postpones: it pushes each cell
towards where the turning is strongest nearby, and along a broad soft edge that direction is
decided by the grid. Every plume grew a row of horizontal teeth down its side — plain in a
screenshot at any strength that did anything at all, and gone entirely at none. It is a good
example of why the pictures get looked at and not only the tests: nothing numeric complained.

Measured against the smoke it shares a fluid with: **7% more per step**, and 0.66 ms to
paint against the dye's tenth of that, most of which is the colour table's interpolation.

### Glitter, which is flashes and also matter

`lib/glitter.ts`. Real glitter is thousands of tiny flat mirrors lying at every angle, and it
does not glow — it **flashes**, one flake at a time, as the angle between the eye, the flake
and the light passes through alignment. Each flake keeps a normal of its own and is lit
properly, so tipping the phone sets them off in waves. That half comes alive with **Real
gravity** on, because then the room's light really is sweeping across them.

A flake is drawn **twice**, and the second time is the part that is easy to leave out. Light
added to a lit ground is still that ground, so a flake that only flashed is invisible over
anything pale — which is true of the real thing as well, since a mirror cannot be brighter
than a lit white page. What it can do is _sit on_ it. So the flake is drawn as itself first,
covering what is behind it, and the flash goes over the top.

A flake is a few microns of foil and weighs next to nothing for its area, so the fluid
carries it almost perfectly: it rides the swirl of a turning tube rather than swimming
through it, and sags only slowly when nothing is moving.

**It read as a night sky for a long time, and four things were wrong with it at once.** They
are worth listing because each of them individually looks like a detail and together they
were the whole substance.

- **There were far too many of them, and each was too small.** Eighteen hundred specks three
  to seven device pixels across is not a suspension of flakes, it is a _texture_ — and a
  texture folded six times by the mirrors is static, because the figure a kaleidoscope makes
  is only legible when the eye can pick out the thing being repeated. Four hundred flakes,
  each large enough to be an object, repeat into a figure.
- **A flake was a soft round dot**, which is dust. Craft glitter is die-cut, and the corner is
  the whole of what says so: a field of round specks reads as grain in a photograph however
  bright it is made. They are cut hexagons now, turned to their own facing and foreshortened
  as they lean, in six foils rather than three.
- **The flash was a bulb.** A soft glow brightening and dimming says "sparkle" to nobody. What
  the eye reads as a glint is the _star_, and the star is not in the world — it is what a lens
  or an eyelash does to a small bright thing, which is exactly the case a lit flake is. The
  flash has rays now.
- **Nothing moved.** With no tilt to sweep the light and nothing in a cell of glitter that
  pushes on its fluid, the same few hundred specks stayed alight in the same places for as
  long as anybody looked — a photograph of glitter. Two things fix it: each flake **rocks over
  at its own slow rate**, so it comes through alignment on its own schedule, and the fluid
  gets the same wandering curl-noise breeze the smoke has, so the flakes drift through each
  other for as long as the cell is open.

The dry chamber's ground has always been white, on the reasoning that the objects are the
subject and white is what a photographer would stand them on. Lava and smoke want the same
thing for the same reason. Glitter does not, and its cell is a dark liquid — because the
whole of what glitter does is be brighter than what is behind it, and against white it
cannot be. Dark, but not _flat_: a lit cylinder of liquid is brightest where the light comes
straight through and darkest at the glass, and one gradient across the disc is the difference
between specks on a sheet of paper and flakes suspended inside something.

### An oil film, which is interference and not pigment

`lib/film.ts`. The one substance whose colour is not a colour: oil on water is a few hundred
nanometres thick, light reflecting off the top of the film meets light reflecting off the
bottom after a delay set by the thickness, and which wavelengths survive is purely a function
of how thick the film is _right there_. So the bands are contour lines of thickness, and they
slide as the film flows. A thickness field rides the shared fluid, sags under its own weight
the way the dye does, and is coloured by the interference and nothing else.

**Evaluating that at three wavelengths is what made it look like a screensaver.** One per
channel, on the reasoning that the eye has three kinds of cone standing at about those
places — but a cone answers to a wide _band_, and what a band does to a fringe pattern is
average it. Sampled at three points instead, every fringe survives at full contrast however
tightly they are packed, so the fifth order comes out as saturated as the first: hard rings
of pure red, green and blue, which is not a colour any oil slick has ever shown.

Done properly it is an integral — the film's reflectance across the whole visible spectrum,
weighed by the eye's three colour-matching functions (the analytic fit of Wyman, Sloan and
Shirley, JCGT 2013) — and that integral does for free the thing that makes a slick look like
a slick. Thin films have fringes far apart in wavelength, so the first orders survive the
averaging as the vivid gold, magenta and blue everybody knows; a thicker film's fringes crowd
together, the average washes them out, and by the fourth or fifth order the colour has faded
to a pale pearl. The full thickness is about three orders rather than six now, for the same
reason: past the third the eye cannot tell one from the next, and all the extra buys is a
crowd of tight rings.

Two more things had to be right. **The slick keeps its oil** — it drained exactly as the
smoke's dye did, and worse: a cell left to itself held **a fifth of what it was poured after a
minute**, which is not an empty cell but a slick shrinking to a few small rings on a black
ground, and is what the screenshots of this substance kept showing. And **the film is painted
three pixels to a cell** rather than one, off an eased reconstruction of the thickness field:
interference colour is a violently non-linear function of thickness and the bands it draws are
all edge, so at one pixel a cell the edge of every band was the grid's own staircase at any
zoom past about half.

## Photo and camera

Choose **Photo** and pick a file, or drop one anywhere on the artwork.

Choose **Camera** and you have a different instrument. A kaleidoscope has a chamber of loose
objects at the far end; a **teleidoscope** has a lens or a glass ball instead, and mirrors
whatever you point it at. That is what this is — an open-ended tube, with the world for a
chamber. The camera defaults to the **back** one for the same reason: it is something you
point at things, and a phone's front camera points at your face. It is asked for as a
preference rather than a requirement, so a laptop with only a front camera still gets that
one instead of failing outright.

Both are the same chamber — `lib/mediaChamber.ts`, handed a different element. It is the one
chamber that reports itself **open**, and that is what decides where the glass bead goes: a
cell of objects caps the tube and has no objective in front of it to put a marble over, while
an open end is exactly what a teleidoscope's marble is for. A video would be the third
element handed to this same file.

Both stay on the device. The photo is read through an object URL, drawn to a canvas, and
the URL revoked; the camera is a `getUserMedia` stream drawn frame by frame. Nothing is
uploaded, and no frame is stored. The camera is requested only while it is the selected
source, and its tracks are stopped the moment you switch away, so the camera light does not
stay on behind your back.

Shift-drag, or a two-finger drag, moves the source around; pinching those two fingers zooms
it, and a scroll over the artwork does the same for a hand with no second finger on glass.
It follows the pointer and stays where it is let go.

Past its own edges the picture continues as its **own mirror image**, the way the mirrors
continue everything else, so there is no zoom and no drag that can leave bare ground showing
inside the wedge and no floor on the zoom to protect it. A full drag moves it by the cell's
own reach plus however much of the picture hangs outside — bounded at the wall, as it used to
be, a full drag at zoom 1 was no travel at all and read as the drag being broken.

The picture is drawn about the **middle of the cell**, like everything else in a chamber. It
used to be drawn about the mirror triangle's corner instead, which put the middle of the
picture somewhere the bead's axis was not: a photograph was seen through the edge of the
marble rather than its centre, and a grid photograph through a full bead showed it plainly as
a blown-out patch off to one side of every rosette. Fitting the picture as a chamber like any
other fixed it, because a chamber is painted about its own middle by definition.

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

**Installed to the home screen the units disagree the other way**, and it took a photograph
of a phone to see it. There is no address bar to dodge in standalone, so `dvh` and `%` ought
to be the same thing and the screen; instead each of them stops short of the strip the status
bar is laid over, while `vh` does not. The page came out **793pt of an iPhone 15 Pro's 852**
— short by exactly the 59pt the Dynamic Island's inset takes — and because the artwork starts
at the top of the screen, the missing strip showed up at the _bottom_, as a band of page
background under the picture.

So in standalone the height is `max(100%, 100vh, 100dvh)`. Nothing collapses there, so none
of the three can be taller than the screen and the largest of them is it; taking the largest
is also the safe way round, since it can only ever add to what the page already covered. The
artwork is pinned with `position: fixed` on top of that, which measures against the viewport
rather than against the page box — a different question, and the one that matters for the
thing that has to reach the edge.

None of this is visible to a test that can run here: jsdom has no viewport and a desktop
browser measures every one of those units the same. `test/fullscreen.test.ts` reads the rules
instead, the way `test/manifest.test.ts` reads the manifest, so that the two lines holding
the picture against the edge of a phone are not tidied away by someone who never saw the
band.

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
  `lib/body.ts` keeps the field and the optics in front of it as separate steps.
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
