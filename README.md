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
   in the same place the shading does rather than off to one side. That arrangement is what
   lets metal read as metal — a hard blaze on some facets and nothing at all on their
   neighbours. Behind them the ground is white — the objects are the subject, and white is
   what a photographer would stand them on. It is still a property of the palette rather
   than a constant, so one can be given its own again, but every palette is white today.
2. **The source.** `lib/scene.ts` holds the object chamber — loose pieces in a bounded cell,
   simulated in `lib/chamber.ts`. `lib/media.ts` substitutes a photo or a camera frame for
   that cell. Each chip is a pre-rendered sprite (`lib/chips.ts`), see below.
3. **The triangle.** Once per frame the source is painted from scratch into an offscreen
   triangle, then blended into the surface the mirrors sample (`lib/renderer.ts`). Each
   frame keeping a share of the ones before it is what produces motion trails.
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
- **The blaze** is the specular on top, stamped with `lighter`. Its sharpness is the whole
  difference between the two finishes: raised to a low power it is a soft sheen across a
  matte stone, and to a high one it is either blown out or absent, which is what a polished
  metal actually does.

That split is not only tidiness. The same two layers go over a **photograph** where a piece
is cut from one, so they have to exist apart from any colour. A finished palette-coloured
piece is just the two of them composed over a flat fill, done once at build time because
the colour never changes between frames.

Colours are picked from the palette, never blended between two of its stops: a chamber is
loaded from a handful of jars, and the halfway house between a green and a magenta is mud.
Within a jar, each colour is rendered in a few shades — no melt is ever quite even, so a
chamber where every green is the identical green reads as printed.

### Cutting the pieces out of a picture

`lib/skin.ts` turns a photograph into the pieces themselves, rather than into a surface laid
over generated ones. **Nothing in the app reaches it today** — the built-in object collection
is what will drive it — but the engine and the drawing path are here and tested, and
`KaleidoscopeRenderer.render` takes the picture as its fourth argument.

When a picture is a few separate things on a plain backdrop, which is what a set of cut-out
gemstones is, it comes apart cleanly. The picture is sampled to 96x96 and everything that is
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
  lib/           Rendering engine, chamber physics, tiling, chips, palettes, settings — no React
  test/          Vitest setup and a fake 2D context
```

## Settings

| Setting   | Range               | Effect                                            |
| --------- | ------------------- | ------------------------------------------------- |
| Input     | shards/photo/camera | What the mirrors repeat                           |
| Zoom      | 0.5x–3x             | Magnification of the object cell                  |
| Trails    | 0–95%               | How long each frame lingers                       |
| Count     | 4–60                | Pieces in the chamber                             |
| Chip size | 0.4x–2.5x           | How big each piece is, without changing how many  |
| Palette   | 5 presets           | The piece colours                                 |
| Metallic  | on/off              | Polished metal rather than matte stone            |
| Seed      | any text            | Seeds the piece generator; same seed, same pieces |

The last five apply to the shards only; the rest apply to every source. There is no mirror
control — a tube has three — and no spin control: it is turned by swiping, as below.

**Trails** blend whole frames rather than fading the surface each frame is painted on. The
pieces are composited with `multiply` and `lighter`, neither of which is idempotent: a
still pile stamped over its own remains every frame walks away from a single pass of it. So
the frame is painted from scratch each time and the previous ones are kept as a share of
the blend instead.

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
would set both the chip size and how many land in view, so **Chip size** scales the pieces
on its own.

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

Choose **Photo** and pick a file, or drop one anywhere on the artwork. Choose **Camera** to
mirror a live feed. The camera defaults to the **back** one: a kaleidoscope is something you
point at the world, and a phone's front camera points at your face. It is asked for as a
preference rather than a requirement, so a laptop with only a front camera still gets that
one instead of failing outright.

Pointing either at something with real surface is worth doing. The mirrors do not care
where their pixels came from, so a photograph of polished stone or beaten metal gives you a
genuinely photographic material, which no amount of drawing will match.

Both stay on the device. The photo is read through an object URL, drawn to a canvas, and
the URL revoked; the camera is a `getUserMedia` stream drawn frame by frame. Nothing is
uploaded, and no frame is stored. The camera is requested only while it is the selected
source, and its tracks are stopped the moment you switch away, so the camera light does not
stay on behind your back.

Shift-drag, or a two-finger drag, moves the source around; pinching those two fingers
zooms it. It follows the pointer and stays where it is let go.

A photo cannot tile the way the shard field does, so zoom is floored at 1x — below that
its edges would show inside the wedge — and its travel is bounded by however much of the
image hangs outside the mirrored area.

The camera draws a fresh frame into the mirrors on every animation frame, so what you see
is live rather than a snapshot.

## Accessibility

- Motion is paused by default when the system asks for reduced motion, and changing that
  preference mid-session hands control back to it. A live camera is the exception: it keeps
  drawing and the mirrors are held still instead, because freezing a feed on its first
  frame does not reduce motion, it just breaks what the viewer asked for. An explicit Pause
  still freezes it.
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
