# Kaleidoscope

An interactive kaleidoscope, rendered on a 2D canvas. A triangular tube of three mirrors
tiles the field with repeating hexagons, the way a real one does. Feed it a generated field
of glass chips, a photo of your own, or a live camera feed. Built with React 19, TypeScript
and Vite.

Swipe across the artwork to turn the tube. Every look is described by a small set of
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

1. **The source.** `lib/scene.ts` keeps a field of shards in a unit cell that tiles
   infinitely — positions wrap, so the field never runs out however far it pans.
   `lib/media.ts` substitutes a photo or a camera frame for that cell. Each chip is a
   pre-rendered sprite (`lib/chips.ts`): backlit glass is a gradient and a catch-light, and
   building those per chip per frame would mean hundreds of gradients a frame, so every
   shape-and-colour pair is rendered once and stamped from then on.
2. **The wedge.** Once per frame the source is painted into a single offscreen wedge
   (`lib/renderer.ts`). Fading that surface instead of clearing it is what produces motion
   trails.
3. **The mirrors.** For the three-mirror tube (`lib/tiling.ts`), six mirrored triangles are
   assembled into one hexagon and that hexagon is stamped across the field on its
   translation lattice. For the two-mirror rosette, the wedge is blitted around the centre,
   every other copy reflected. Either way neighbours meet mirror to mirror.

Drawing the source once and blitting the result keeps the per-frame cost proportional to
the source rather than to `source x segments`.

Each wedge's clip is bled a couple of pixels past its seam, onto a surface that carries a
matching margin. Without both halves of that, two antialiased clip edges each cover the
boundary pixel about halfway and composite to roughly 75%, letting the backdrop show
through as dark spokes.

Everything under `src/lib/` is plain TypeScript with no React imports, which is what makes
the interesting parts testable without a browser.

## Layout

```
src/
  components/    Canvas surface and the control panel
    controls/    Small labelled form fields
  hooks/         Animation frame, element size, media queries, settings, gestures, photo, camera
  lib/           Rendering engine, chips, palettes, media, settings — no React
  test/          Vitest setup and a fake 2D context
```

## Settings

| Setting | Range               | Effect                                                  |
| ------- | ------------------- | ------------------------------------------------------- |
| Input   | shards/photo/camera | What the mirrors repeat                                 |
| Mirrors | triangle/rosette    | Three mirrors tiling the field, or two making a rosette |
| Fold    | 2–18                | Rosette only: mirror lines through the centre           |
| Zoom    | 0.5x–3x             | Magnification of the object cell                        |
| Count   | 4–60                | Shards in the cell                                      |
| Trails  | 0–95%               | How long each frame lingers                             |
| Palette | 5 presets           | Shard colours and backdrop                              |
| Glow    | on/off              | Additive blending, so overlaps bloom                    |
| Seed    | any text            | Seeds the shard generator; same seed, same shards       |

## The mirrors

A real kaleidoscope is a **triangular prism of three mirrors**. Reflecting in its three
sides generates the (3,3,3) triangle group: six equilateral triangles meet around every
vertex, alternating mirrored, to form a hexagon — and those hexagons repeat across the
whole field by translation. What you see fills the view; it is not a single rosette spun
about the centre.

The repeat is a genuine translation because composing reflections in two parallel mirror
lines is a translation of twice their spacing. The lines lie `side * sqrt(3) / 2` apart, so
the lattice steps by `side * sqrt(3)`.

Inside a triangle the chamber holds one object cell, with the chips scaled up so the
mirrors cut them and each continues into its own reflection — which is what fills a real
chamber. Cell size alone would set both the chip size and how many land in view, so
enlarging it to get bigger chips thins them out instead.

**Two mirrors** hinged at `180 / N` degrees is the other real arrangement, and gives a
single `N`-fold rosette. It is kept as an option; the **Fold** slider applies only to it.
Links made when this control counted wedges are still read correctly, at half the number.

The last four apply to the shard field only; the rest apply to every source. There is no
spin control: the tube is turned by swiping, as below.

## Turning the tube

Swipe across the artwork. Left-to-right or top-to-bottom turns it clockwise, the swipe's
speed sets how fast, and the turn stops when the swipe does.

Turning a real kaleidoscope turns the mirrors and the chamber together, so the whole figure
revolves — but the chips are loose, so they trail the barrel and settle once it stops. That
lag is modelled (`Scene.contents` against `Scene.tube`) and capped: uncapped, the lag
settles at `rate / catchup`, so a brisk swipe leaves the chips half a turn behind and they
go on unwinding for seconds after the finger lifts, which reads as the tube still turning.

The chips are inert unless something moves them, so their jostle is tied to the turning
rate. At rest the figure is completely still, which is what a kaleidoscope sitting on a
table does.

Hold **Shift**, use a secondary button, or put a second finger down to pan the source
instead of turning it.

Settings persist to `localStorage`, and **Copy link** encodes them into the URL. A shared
link wins over stored settings on load. Both are treated as untrusted input and clamped to
the ranges above, so a hand-edited link cannot push an out-of-range value into the
renderer. `Input` is deliberately absent from the URL and reset on load — a link cannot
carry the recipient's photo, and reopening on `camera` would fire a permission prompt
nobody asked for.

## Photo and camera

Choose **Photo** and pick a file, or drop one anywhere on the artwork. Choose **Camera** to
mirror a live feed.

Both stay on the device. The photo is read through an object URL, drawn to a canvas, and
the URL revoked; the camera is a `getUserMedia` stream drawn frame by frame. Nothing is
uploaded, and no frame is stored. The camera is requested only while it is the selected
source, and its tracks are stopped the moment you switch away, so the camera light does
not stay on behind your back.

Shift-drag (or two-finger drag) moves the source around. It follows the pointer and stays
where it is let go.

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
