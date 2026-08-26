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

## The two parts

The instrument is a **body** and a **chamber**, and they are meant to stay
strangers. Read `src/lib/chamber.ts` first — it is small, and it is the whole
of what passes between them.

- `lib/body.ts` is the optics: the mirrors, the fold, the tiling, the joins,
  the barrel, the bead. It must never learn what is in the chamber. If you find
  yourself wanting to import the glass, a substance, a picture or
  `Settings.source` into it, the answer is a new member on `Chamber` instead.
- `lib/glassChamber.ts`, `lib/substanceChamber.ts` and `lib/mediaChamber.ts`
  are the chambers there are; `lib/chambers.ts` holds the one switch that picks
  between them. A new chamber is a file and a line, and it owes the body
  exactly one thing: **it must fill its own disc.**
- `lib/physics.ts` is the loose-glass solver and the medium it runs in.
  `lib/scene.ts` is the contents of a cell. Neither is the fitting.

Rotation, said once: the body's angle turns the mirrors and the chamber
together; the bearing turns the chamber alone; the tilt turns nothing and moves
gravity. The body composes all three and hands the chamber one angle.

Conventions that matter:

- Everything under `src/lib/` is plain TypeScript with **no React imports**;
  that is what makes it testable without a browser. Keep it that way.
- Measure before and after any performance change, in one process, and record
  the numbers. The repo's history is full of reasonable ideas that measured
  slower.
- Judge visual changes by **looking at the picture**, not only at tests —
  more than one bug here passed every numeric check and was obvious in a
  screenshot.
- Owner decisions on record: the bead never touches the chamber — which is now
  `Chamber.open`, answered by each chamber rather than asked by the optics; the
  liquid cell holds a substance _instead of_ glass; seed determinism is **not**
  a requirement (2026-08-25).
- `npm run typecheck && npm run lint && npm run test` before pushing;
  Prettier formats markdown too (`npm run format`).
