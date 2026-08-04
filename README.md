# Kaleidoscope

An interactive kaleidoscope: a drifting field of shards, mirrored around the centre and
rendered on a 2D canvas. Built with React 19, TypeScript and Vite.

Move the pointer over the artwork to nudge the shards. Every look is described by a small
set of settings, so any pattern can be reproduced from its seed or shared as a link.

## Getting started

```bash
npm install
npm run dev
```

The dev server prints a local URL (http://localhost:5173 by default).

## Scripts

| Script                  | What it does                               |
| ----------------------- | ------------------------------------------ |
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

1. **The cell.** `lib/scene.ts` keeps a field of shards in a unit cell that tiles
   infinitely. Shards drift, spin, pulse and slide along the palette; positions wrap, so
   the field never runs out however far it pans.
2. **The wedge.** Once per frame the visible tiles are painted into a single offscreen
   wedge (`lib/renderer.ts`). Fading that surface instead of clearing it is what produces
   motion trails.
3. **The mirrors.** The wedge is blitted around the centre, every other copy reflected, so
   neighbouring wedges always meet edge to edge.

Drawing the shards once and blitting the result keeps the per-frame cost proportional to
the shard count rather than to `shards x segments`.

Everything under `src/lib/` is plain TypeScript with no React imports, which is what makes
the interesting parts testable without a browser.

## Layout

```
src/
  components/    Canvas surface and the control panel
    controls/    Small labelled form fields
  hooks/         Animation frame, element size, media queries, settings state
  lib/           Rendering engine, palettes, settings — no React
  test/          Vitest setup and a fake 2D context
```

## Settings

| Setting  | Range           | Effect                                            |
| -------- | --------------- | ------------------------------------------------- |
| Segments | 4–36 (even)     | Mirrored wedges around the centre                 |
| Spin     | -0.5–0.5 turns/s | Rotation of the mirror assembly; negative reverses |
| Zoom     | 0.5x–3x         | Magnification of the object cell                  |
| Count    | 4–60            | Shards in the cell                                 |
| Trails   | 0–95%           | How long each frame lingers                       |
| Palette  | 5 presets       | Shard colours and backdrop                        |
| Glow     | on/off          | Additive blending, so overlaps bloom              |
| Seed     | any text        | Seeds the shard generator; same seed, same shards |

Settings persist to `localStorage`, and **Copy link** encodes them into the URL. A shared
link wins over stored settings on load. Both are treated as untrusted input and clamped to
the ranges above, so a hand-edited link cannot push an out-of-range value into the
renderer.

## Accessibility

- Motion is paused by default when the system asks for reduced motion, and changing that
  preference mid-session hands control back to it.
- Every control is labelled; sliders expose formatted values via `aria-valuetext`.
- The canvas carries a text description, and action feedback is announced politely.

## Deploying

`npm run build` emits a static bundle to `dist/`, which any static host will serve. The
repository's `.htaccess` is for Apache deployments; copy it alongside the built files if
that is where the site lives.
