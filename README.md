# Kaleidoscope

An interactive kaleidoscope, rendered on a 2D canvas. A triangular tube of three mirrors
tiles the field with repeating hexagons, the way a real one does. Feed it a generated
chamber of tumbling objects, a photo of your own, or a live camera feed. Built with React
19, TypeScript and Vite.

Swipe across the artwork to turn the cell. Every look is described by a small set of
settings, so a generated pattern can be reproduced from its seed or shared as a link.

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

Drawing the source once and blitting the result keeps the per-frame cost proportional to
the source rather than to `source x triangles` — and building the hexagon once means the
field costs one blit per hexagon however many are on screen.

Each triangle's clip is bled a couple of pixels past its seam, onto a surface that carries
a matching margin. Without both halves of that, two antialiased clip edges each cover the
boundary pixel about halfway and composite to roughly 75%, letting the backdrop show
through as dark spokes.

### The mirrors are not free

Each bounce loses a few percent of the light, and it loses it unevenly: a household mirror
is silvered behind a sheet of glass the light has to cross twice, and glass absorbs red,
which is why the far end of a corridor of mirrors is green. The cell you are looking
straight down has taken no bounces; every cell further out has taken more.

That count is what sets the falloff. Neighbouring cells sit one lattice step apart and a
step is two reflections, so a point `r` out from the middle has been through about
`2r / (side * sqrt(3))` of them — and the view is multiplied by a radial gradient whose
stops are `reflectance ^ bounces` per channel. Brightest and truest on the axis, dimmer and
greener towards the rim, and it applies to the bare backdrop as much as to the pieces,
because the mirrors do not know the difference.

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

**Object sets.** A set is a PNG or WebP of a few objects on a transparent background. The
bundled ones are discovered from the files rather than listed anywhere: dropping one into
`src/assets/objects/` adds a preset to the **Objects** control and removing it takes one
away, with no registry to keep in step and no way for the list and the files to disagree
(`lib/objectSets.ts`, and see the README in that folder for what a picture has to be). One
entry is not a file — **Upload a photo** takes one of your own. They sit in the same list as
**Mirror a photo** and **Camera**, because a chamber of objects, a flat photograph and the
live camera are three answers to the same question. They were two controls once, and the one
that chose between them decided whether the other was rendered at all — so leaving it on
Photo took the object sets out of the panel entirely, with nothing to say why. There is nothing else: a
chamber is loaded with objects out of a picture, or it is empty. Without one, nothing is
drawn at all, which is a truer answer than a chamber full of shapes nobody chose.

The two that ship — **Bright gems** and **Cut stones** — are stand-ins, keyed back out of
flattened stock previews and not cleared for redistribution. Replacing them is a matter of
putting different files in the folder.

A picture comes apart cleanly when it is a few separate things on a plain backdrop, which is
what a set of cut-out gemstones is. The picture is sampled to 96x96 and everything that is
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
  hooks/         Animation frame, element size, media queries, settings, gestures, photo, camera
  lib/           Rendering engine, chamber physics, tiling, object sets, settings — no React
  test/          Vitest setup and a fake 2D context
```

## Settings

| Setting          | Range                  | Effect                                         |
| ---------------- | ---------------------- | ---------------------------------------------- |
| Source           | a set, a photo, camera | What the mirrors are pointed at                |
| Count            | 4–60                   | Pieces in the chamber                          |
| Mirror size      | 0.5x–3x                | How wide the mirror triangle is                |
| Real gravity     | on/off                 | Let the phone's position say which way is down |
| Show the mirrors | on/off                 | Draws the triangle, and points at gravity      |
| Seed             | any text               | Seeds the chamber; same seed, same arrangement |

There is one more, and it has no slider: **how big the things in the source are** — the
pieces in the chamber, or the magnification of a photo. That is a pinch, or a scroll over
the artwork. It still travels in a shared link.

The split is deliberate. **The gestures are for the contents and the panel is for the
instrument.** Swiping turns the tube, pinching sizes what is in it and two fingers move it
about; the one thing the hand cannot reach is how wide the mirrors themselves are, so that
is the slider. They were the same control once, which meant widening the tube also enlarged
the picture inside it — two things at once and no way to have either alone.

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

`lib/tilt.ts` holds the arithmetic and nothing else. The orientation event gives the
front-to-back tilt and the left-to-right one; held upright and facing you those are about 90
and about 0, and rotating the phone clockwise in its own plane takes the first towards 0 and
the second towards -90, so `atan2` of the pair is the angle directly. Two details matter as
much as the formula. The reading wraps at half a turn — gravity itself does not mind, being a
sine and a cosine, but the smoothing does: asked to move from just under half a turn to just
over, it sweeps all the way round through zero and the pile slides the wrong way while it
does. So each reading is carried on from the last by the shorter way, and only then smoothed,
which is also what takes out the sensor's shiver at rest.

iOS will not report orientation until it has been asked from a user gesture, which is what
the toggle is. Refused, it says so and stays refused; nothing asks twice. The arithmetic is
unit-tested and the wiring is checked in a browser with synthesised events — **but it has
not been tried on a real iPhone**, and the sign convention comes from the specification
rather than from a device.

## Seeing the mirrors

Everything on screen is one triangle and its reflections, and the triangle itself is
invisible by design — which makes the figure hard to reason about when it misbehaves. **Show
the mirrors** outlines it, at the centre of the view where the source is painted, and draws
an arrow for gravity: straight down the screen until the instrument is tilted, and then
wherever the room says. Between them they answer most of "why is it doing that".

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
