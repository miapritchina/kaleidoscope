# Kaleidoscope

An interactive kaleidoscope, rendered on a 2D canvas. Mirror a generated field of drifting
shards, a photo of your own, or a live camera feed. Built with React 19, TypeScript and
Vite.

Move the pointer over the artwork to steer it. Every look is described by a small set of
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
   infinitely — shards drift, spin, pulse and slide along the palette, and positions wrap,
   so the field never runs out however far it pans. `lib/media.ts` substitutes a photo or a
   camera frame for that cell.
2. **The wedge.** Once per frame the source is painted into a single offscreen wedge
   (`lib/renderer.ts`). Fading that surface instead of clearing it is what produces motion
   trails.
3. **The mirrors.** The wedge is blitted around the centre, every other copy reflected, so
   neighbouring wedges always meet edge to edge.

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
  hooks/         Animation frame, element size, media queries, settings, photo, camera
  lib/           Rendering engine, palettes, media, settings — no React
  test/          Vitest setup and a fake 2D context
```

## Settings

| Setting  | Range               | Effect                                             |
| -------- | ------------------- | -------------------------------------------------- |
| Input    | shards/photo/camera | What the mirrors repeat                            |
| Segments | 4–36 (even)         | Mirrored wedges around the centre                  |
| Spin     | -0.5–0.5 turns/s    | Rotation of the mirror assembly; negative reverses |
| Zoom     | 0.5x–3x             | Magnification of the object cell                   |
| Count    | 4–60                | Shards in the cell                                 |
| Trails   | 0–95%               | How long each frame lingers                        |
| Palette  | 5 presets           | Shard colours and backdrop                         |
| Glow     | on/off              | Additive blending, so overlaps bloom               |
| Seed     | any text            | Seeds the shard generator; same seed, same shards  |

The last four apply to the shard field only; the rest apply to every source.

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

A photo cannot tile the way the shard field does, so zoom is floored at 1x — below that
its edges would show inside the wedge — and panning is bounded by however much of the
image hangs outside the mirrored area.

## Accessibility

- Motion is paused by default when the system asks for reduced motion, and changing that
  preference mid-session hands control back to it.
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
