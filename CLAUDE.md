# Working in this repository

Read these before proposing or building anything:

- **README.md** — how the app actually works: the fold, the chamber physics,
  the substances, and why each is built the way it is.
- **ROADMAP.md** — what might be built next, what things cost, and — as
  important — what was tried, measured, and taken out again. Check it before
  suggesting an "obvious" optimization; several are recorded there with the
  numbers that killed them.
- **RESEARCH.md** — research notes and current plans: literature, library
  surveys, critiques, and the agreed multi-phase plan for the liquid
  substances, Rapier, iridescence, stirring, and sound.

Conventions that matter:

- Everything under `src/lib/` is plain TypeScript with **no React imports**;
  that is what makes it testable without a browser. Keep it that way.
- Measure before and after any performance change, in one process, and record
  the numbers. The repo's history is full of reasonable ideas that measured
  slower.
- Judge visual changes by **looking at the picture**, not only at tests —
  more than one bug here passed every numeric check and was obvious in a
  screenshot.
- Owner decisions on record: the bead never touches the chamber; the liquid
  cell holds a substance _instead of_ glass; seed determinism is **not** a
  requirement (2026-08-25).
- `npm run typecheck && npm run lint && npm run test` before pushing;
  Prettier formats markdown too (`npm run format`).
