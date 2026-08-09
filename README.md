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

1. **The source.** `lib/scene.ts` holds the object chamber — loose glass in a bounded cell,
   simulated in `lib/chamber.ts`.
   `lib/media.ts` substitutes a photo or a camera frame for that cell. Each chip is a
   pre-rendered sprite (`lib/chips.ts`): backlit glass is a gradient and a catch-light, and
   building those per chip per frame would mean hundreds of gradients a frame, so every
   shape-and-colour pair is rendered once and stamped from then on.
2. **The triangle.** Once per frame the source is painted into a single offscreen triangle
   (`lib/renderer.ts`). Fading that surface instead of clearing it is what produces motion
   trails.
3. **The mirrors.** Six mirrored triangles are assembled into one hexagon (`lib/tiling.ts`),
   and that hexagon is stamped across the field on its translation lattice, so neighbours
   meet mirror to mirror.

Drawing the source once and blitting the result keeps the per-frame cost proportional to
the source rather than to `source x triangles` — and building the hexagon once means the
field costs one blit per hexagon however many are on screen.

Each triangle's clip is bled a couple of pixels past its seam, onto a surface that carries
a matching margin. Without both halves of that, two antialiased clip edges each cover the
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
  lib/           Rendering engine, chamber physics, tiling, chips, palettes, settings — no React
  test/          Vitest setup and a fake 2D context
```

## Settings

| Setting   | Range               | Effect                                            |
| --------- | ------------------- | ------------------------------------------------- |
| Input     | shards/photo/camera | What the mirrors repeat                           |
| Zoom      | 0.5x–3x             | Magnification of the object cell                  |
| Trails    | 0–95%               | How long each frame lingers                       |
| Count     | 4–60                | Shards in the cell                                |
| Chip size | 0.4x–2.5x           | How big each piece is, without changing how many  |
| Palette   | 5 presets           | Shard colours and backdrop                        |
| Glow      | on/off              | Additive blending, so overlaps bloom              |
| Seed      | any text            | Seeds the shard generator; same seed, same shards |

The last five apply to the shard field only; the rest apply to every source. There is no
mirror control — a tube has three, and no spin control: it is turned by swiping, as below.

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

Older links carried a mirror arrangement this app no longer offers. They still open, on
whichever of their settings still mean something.

## Turning the tube

Swipe across the artwork. Left-to-right or top-to-bottom turns it clockwise, the swipe's
speed sets how fast, and the turn stops when the swipe does.

The chamber is bolted inside the tube, so gravity does not point "down" in its
coordinates — it points down in the **world**, and turning sweeps that direction around the
chamber. That is the whole mechanism: the pattern does not change because the tube is
turning, it changes because turning tips the glass, it avalanches, and it settles into a
new pile. Measured on the built app: essentially still at rest, a burst of change on the
swipe, then back to rest.

Contacts are resolved by moving positions and reading the velocity back off how far each
chip actually travelled. Impulses alone leave a pile creeping forever, because gravity
keeps feeding in velocity the contacts never quite take out; here a chip held in place
records no movement, and so comes to rest.

The glass is drawn at its physical size, so what collides is what you see, and it is sized
to pack the chamber to around two thirds by area — a real cell is full, so tipping it
rearranges the pile rather than emptying most of the view.

Turning a real kaleidoscope turns the mirrors and the chamber together, so the whole figure
revolves rigidly. A photo or camera frame has no physics of its own, so it keeps a capped
lag behind the tube instead, which lets it evolve as it turns.

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
