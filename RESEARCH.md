# Research log

Findings from research sessions, kept so the next session does not have to redo
the reading. Where ROADMAP.md records what was _built_ and what it cost, this
file records what was _learned_ — critiques, literature, library surveys, and
the plans drawn from them. When a plan lands, move what it taught into
ROADMAP.md's style of record and leave the research here.

---

## 2026-08-25 — The liquid substances, third-party libraries, and the plan

### Owner decisions this session

- **Seed determinism is not a requirement.** Shared links may reproduce a
  _look_ without reproducing the exact arrangement. This frees library choice:
  cross-platform bit-exact physics (the one thing that argued for Rapier over
  alternatives, and against WASM float variance in general) no longer gates
  anything.
- Excited about, in the owner's words: **Rapier**, **thin-film iridescence**,
  **stirring the chamber with a finger**, and (interested) **sound**.
- The liquid-tab substances are considered unsatisfying as implemented; the
  scientific critique below is the agreed diagnosis.

### Critique of the three substances

#### Lava (`lib/lava.ts`) — the discrete topology machinery fights the field

The mode carries **two representations of topology**: the metaball field,
which draws necking and pinching for free, and the explicit
`coalesce`/`divide`/`SETTLE`/`PARTING` machinery, which re-decides the same
things discretely. Every recorded artifact — the two-frame stagger, the pop on
split, the settle timer that exists only to break the merge/split loop — is
the discrete layer fighting the continuous one. The fix is architectural, not
parametric:

**Simulate many small particles; let the field alone decide topology.**
Replace 2–10 large blobs with ~40–120 small particles carrying a short-range
pairwise force — attraction at medium range, repulsion up close. The reference
is Clavet, Beaudoin & Poulin, _Particle-based Viscoelastic Fluid Simulation_
(SCA 2005): its "double density relaxation" is ~40 lines and designed for
exactly this kind of 2D blobby liquid. Then:

- **Merging is emergent** — two clumps drift together, their summed fields
  neck and join. No `MERGE` threshold, no colour-averaging step (colour mixes
  spatially because particles interleave).
- **Splitting is emergent** — a rising clump stretched by shear thins in the
  middle, the field drops below `SURFACE`, and it visually pinches off with
  the neck drawn correctly. No `SPLIT`, `SETTLE`, or `PARTING`.
- `paintLava` survives nearly unchanged: more, smaller contributions to the
  same field.

The heat cycle's `ENDS` lag insight (see the comments in `lava.ts` — heat must
track _history_, not height, or the cycle is a spring) is correct physics and
carries over per particle. Two upgrades from real convection modelling
(Boussinesq / Rayleigh–Bénard):

1. **Heat diffusion between neighbouring particles** — plumes then rise as
   coherent columns, which is what a real lamp does.
2. **Temperature-dependent viscosity** — scale drag by `(1 - heat)` so cold
   wax slumps and hot wax runs. One line, a lot of wax-ness.

Rendering: the scalar field's **gradient is a surface normal**. Shade with it
(light up-left, darkened opposite rim, small specular) and flat gel-sticker
blobs become glossy 3D wax. Highest visual return per effort of anything in
this critique.

#### Smoke (`lib/smoke.ts`) — sound science; three refinements

The Stam + MacCormack + blurred-vorticity-confinement stack is correct and its
traps are already documented in ROADMAP.md. Remaining upgrades:

- **RK2 (midpoint) backtrace** in `advect`: sample velocity half a step back,
  then trace with that. Reduces rotational drift in tight swirls for one extra
  bilinear sample per cell. Standard next rung above single-Euler
  semi-Lagrangian.
- **Temperature buoyancy.** Today the only endogenous force is dye weight, so
  the cell makes sinking curtains. Add a temperature scalar field, injected
  with dye, advected identically, with force `β·T` up and `κ·dye` down — the
  full smoke model of Fedkiw, Stam & Jensen (SIGGRAPH 2001, already cited for
  confinement). Temperature is what makes rising plumes with mushroom caps.
- **Curl-noise background stirring** (Bridson, Hourihan & Nordenstam,
  _Curl-Noise for Procedural Fluid Flow_, SIGGRAPH 2007): take the curl of a
  slowly-animating noise potential and add it as a weak force. Curl of a
  potential is divergence-free by construction, so it cannot fight the
  pressure solve. Keeps an unattended cell alive indefinitely.

#### Glitter (`lib/glitter.ts`) — not in a fluid, and the flakes never tumble

Two faults keep it from reading as a suspension:

1. **The "fluid" is a rigid turntable.** `flow = swirl × r` is solid-body
   rotation: every flake rides a perfect circle. Real suspended flakes ride
   eddies. The elegant fix: this repo already owns a fluid solver. Run the
   smoke _velocity_ field (dye-free, smaller grid is fine — velocity is
   smoother than dye) under the glitter and advect flakes through it with
   their existing high `FLAKE_GRIP`. Swirling then shears and folds the
   glitter into sheets instead of rotating a disc.
2. **Orientation is frozen.** `lean`/`turn` are set at creation, so the flash
   pattern only changes when the _light_ moves. Real platelets tumble at a
   rate set by the local velocity gradient (rigorously, Jeffery's orbits,
   1922; a platelet in shear rotates continuously). Cheap version: rotate each
   flake's `turn`/`lean` proportionally to the local curl of the field it sits
   in. Waves of flashes then sweep through the cell _from the motion itself_,
   not just from tilt. Draw flakes as ellipses foreshortened by `cos(lean)`
   so they can be seen turning edge-on.

#### The unifying observation

All three substances take `{dt, thickness, swirl, angle}` and separately
reinvent "the fluid" (three wall-grip implementations, three thickness
scalings). The honest physics is **one cell of fluid with different things
carried in it**. Extracting the velocity solver from `smoke.ts` into a shared
flow field that lava particles, dye, glitter flakes — and any future
substance — ride is both the cleanup and the enabler: finger-stirring and
thin-film iridescence each want exactly that field.

### Library survey

Context: the compositor is already **raw WebGL2** (no library — see
ROADMAP.md's size table and the reasoning; a scene graph would be weight
carried and not used). Everything below was judged against that precedent:
a library must replace a real machine, not wrap one we have.

#### Physics (for the dry chamber)

| library                      | what it is                                                                           | verdict                                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `@dimforge/rapier2d`         | Rust→WASM rigid-body, actively maintained, convex polygon colliders, TGS-soft solver | **The candidate.** See below.                                                                                       |
| `planck.js`                  | Box2D port, pure JS                                                                  | Solid, slower than Rapier, no polygon advantage over it                                                             |
| `matter-js`                  | easiest API                                                                          | least accurate stacking; not worth the trade                                                                        |
| LiquidFun (`liquidfun-wasm`) | Box2D + particle fluids                                                              | glass sinking through real liquid — fun, but stale ports; PBF-on-our-solver (ROADMAP) covers the same ground better |

**Why Rapier fits this chamber specifically.** `lib/chamber.ts` approximates
every piece as a chain of 2–4 circles because a hand-rolled polygon solver is
a different machine (contact manifolds, inertia tensors). Rapier _is_ that
machine: the traced 28-corner silhouettes in `lib/skin.ts` become convex-hull
(or decomposed) colliders directly, so a splinter collides as a splinter. Its
solver is rate-independent — the exact property ROADMAP.md's "Make the solver
rate-independent" asks for, including the fill ceiling that wedges the pile at
160 pieces — and it sleeps islands properly. Costs to carry: ~1.5 MB of WASM
(≈500 KB gzipped; `-compat` build inlines it, simplest with Vite), async init
before first frame, and **a re-tune of a feel that took a long time to get
right** — the medium (oil buoyancy/drag/wall-stir) would be re-implemented as
custom forces on Rapier bodies. That last is the real price and the reason to
do it as a measured spike behind a flag, not a rewrite.

#### GPU / rendering

- **Pavel Dobryakov's WebGL-Fluid-Simulation** (MIT) — the reference GPU
  stable-fluids implementation; readable shaders to port from rather than a
  dependency to adopt. Only relevant if 96² CPU smoke ever feels limiting;
  at cell size it currently does not (1.9 ms/frame, measured).
- **WebGPU MLS-MPM** (e.g. matsuoka-601's demos) — tens of thousands of
  splashy particles; mobile WebGPU still uneven → progressive enhancement
  only, not a base.
- Wrapper libraries (three, pixi, ogl, regl) — already declined for the
  compositor; nothing new changes that.

#### Small utilities

- `simplex-noise` (~2 KB, seedable) — worth taking for curl-noise stirring
  and flake shimmer, or hand-roll a 2D value-noise (≈30 lines) to stay
  dependency-free. Either is fine; decide at implementation.

#### Sound

No library needed. Web Audio API: a handful of short buffers (or synthesized
clinks — filtered noise bursts with exponential decay) triggered off collision
events the chamber already computes, velocity → gain/pitch. Constraint to
respect: browsers require a user gesture before audio starts, so it is a
toggle (or first-tap unlock), never autoplay.

### Thin-film iridescence, as a substance

ROADMAP.md lists thin-film interference on piece edges (**GL**). The stronger
form of the idea is a **fourth liquid substance: an oil film**. A scalar
_thickness_ field advected on the shared flow field; colour from thin-film
interference — for film thickness `d` and wavelength `λ`, reflected intensity
goes as `cos²(2πnd/λ + φ)`, evaluated per RGB channel (three wavelengths ≈
610/550/470 nm) or via a small precomputed thickness→RGB lookup table (an
Airy-reflectance ramp; ~256 entries). Drain/replenish slowly so the film
drifts through colour bands as it thins, which is what a real slick does.
The physics is real, the look is unlike the other three substances, and at
grid resolution it is 2D-canvas cheap.

### References

- Clavet, Beaudoin, Poulin — _Particle-based Viscoelastic Fluid Simulation_, SCA 2005.
- Macklin, Müller — _Position Based Fluids_, SIGGRAPH 2013. (Already in ROADMAP.md.)
- Stam — _Stable Fluids_, SIGGRAPH 1999.
- Fedkiw, Stam, Jensen — _Visual Simulation of Smoke_, SIGGRAPH 2001.
- Bridson, Hourihan, Nordenstam — _Curl-Noise for Procedural Fluid Flow_, SIGGRAPH 2007.
- Jeffery — _The Motion of Ellipsoidal Particles Immersed in a Viscous Fluid_, Proc. R. Soc. A, 1922.
- Macklin et al. — _Small Steps in Physics Simulation_, SCA 2019. (Already cited in README.)
- Rapier: rapier.rs docs; `@dimforge/rapier2d-compat` on npm.
- Dobryakov — WebGL-Fluid-Simulation (github.com/PavelDoGreat/WebGL-Fluid-Simulation), MIT.

---

## The plan (agreed 2026-08-25)

Ordered so each phase ships alone and later phases stand on earlier ones.
"Done" for every phase includes: looked at on a phone-sized canvas (the
repo's history says numbers alone miss what matters), a test on whatever
invariant the phase creates, and the record moved into ROADMAP.md.

All seven phases are built as of 2026-08-25 — each phase's commit message
carries its record, and the notes below are the plan as agreed. What remains
is looking at everything on a real phone: the numbers and the headless
screenshots are good, and the feel is the owner's call.

1. **Stir with a finger.** _Built._ It went one better than planned: the
   pointer is folded back into the cell with the fold's own arithmetic
   (`lib/stir.ts`), so a drag anywhere on the figure stirs the one cell and
   the stir appears in every reflection at once. Turning and stirring are one
   gesture. A pointer drag inside the stage on the Liquid tab
   splats velocity (and a little dye, for smoke) into the cell at the touch
   point; pushes lava particles; drags glitter. Touches `useStageGesture.ts`
   (a third gesture: one finger _inside the cell_ stirs rather than turns —
   decide the disambiguation: current behaviour is swipe-turns, so stirring
   likely wants the existing drag mapped to stir _for liquid sources only_,
   with turn staying on a swipe that starts outside the cell, or coexisting
   via velocity injection along the drag), `scene.ts` plumbing, each
   substance's update. Small, immediate joy; also the first consumer of a
   stir API the flow field will formalize.

   **The disambiguation is no longer only a matter of taste — there is a
   result about it.** Reported from a phone as "finger stir seems to disagree
   with finger rotation", and it did, measurably: the turn was read from the
   finger's screen displacement without regard to where the finger was
   (rightwards and downwards both anticlockwise), while the stir is folded
   back to exactly where the finger is. Probed at four places on the stage
   with the same swipe, the two came out with agreement +1 in half the stage
   and -1 in the other half — the same swipe pushing the wax one way and
   sweeping the cell the other.

   Reading the turn off the lever the finger has about the middle of the
   _view_ does not fix it, and the reason is worth writing down. For the two
   to agree at the finger, the turn has to be proportional to `q x J.dP`,
   where `q` is the finger's _folded_ position about the cell's middle and `J`
   is the fold's local Jacobian. `J` is orthogonal with determinant ±1 by the
   parity of the reflections, so the sign flips at every mirror. Written back
   in screen terms: each triangle has its own centre of rotation and alternate
   triangles turn opposite ways, which is exactly what a kaleidoscope looks
   like when you turn one. A turn read that way reverses every time the finger
   crosses a seam — four times in a swipe across the stage at the default zoom
   — and nets out at about nothing. **So no screen-space turn gesture can
   agree with the folded stir everywhere. One finger cannot coherently do
   both, and the disambiguation is a real fork rather than a preference.**

   What _was_ plainly wrong, and is fixed, is two things underneath it:

   - The stir's velocity was differenced from the folded point _after_ the
     cell's own turn had been divided out, so the frame's rotation was
     measured along with the finger's movement. A finger resting perfectly
     still on the glass of a tube turning at six radians a second reported a
     stir of about three cell units a second — more than the wax's own top
     speed of 1.6 — pointed against the turn, everywhere at once, for as long
     as it was held. Tracking in the framework's frame and turning only the
     answer into the cell's fixes it; there are tests on both halves of it.
   - The stir's speed cap was 5 cell units a second against a chamber radius
     of 1.15 and a wax top speed of 1.6, so any ordinary drag saturated it and
     drove the cell at three times what anything in it can do. It is two
     chamber radii a second now — a finger crossing the whole cell in half of
     one.

   Together those two turn the drag from something that blew the cell apart
   into something that swirls it, and they take the held-finger fight out
   entirely. The direction question is untouched and still the owner's: a
   moving finger's nudge can still curl against the field in half the
   triangles, and the choices are (a) leave it, now that it reads as a wake
   rather than a fight, (b) one finger stirs and does not turn on the Liquid
   tab, with turning moved to two fingers or a rim gesture, or (c) turn from
   the folded lever and accept that a swipe stops turning the tube.

2. **Shared flow field.** _Built_ — `lib/flow.ts`; smoke extends it,
   glitter rides a coarse one and tumbles by local curl, foreshortened and
   flashing on both faces. Extract the velocity solver from `smoke.ts` into
   `lib/flow.ts` (stir, confine, project, advect; no dye). Smoke keeps its
   dye on top. Glitter advects through it and tumbles by local curl
   (critique above), drawn as foreshortened ellipses. One wall-grip, one
   thickness scaling, for everything.
3. **Thin-film iridescence substance** (`film` in `SUBSTANCES`). _Built_ —
   `lib/film.ts`, and in the headless screenshots it is the best-looking
   thing in the app. Thickness
   field on the flow field, interference LUT, slow drain. New substance
   picker entry, Amount = how much oil, Thickness = the carrier fluid as
   ever.
4. **Lava rewrite.** _Built_ — particles + Clavet 2005; the merge/split
   machinery is gone and the frame-to-frame picture cap stands guard. Particles + double density relaxation; per-particle
   heat with diffusion and the existing ENDS-lag cycle;
   temperature-dependent viscosity; delete `coalesce`/`divide`/`jostle` and
   the settle machinery; gradient-lit rendering in `paintLava`. Keep
   `lava.test.ts`'s frame-to-frame-motion measurement — it is the test that
   caught the stagger.
5. **Smoke refinements.** _Built_ — RK2 midpoint trace in the shared
   advection, warmth with plumes, curl-noise breeze off `lib/noise.ts`
   (hand-rolled; the `simplex-noise` dependency proved unnecessary). RK2 backtrace, temperature buoyancy, curl-noise
   idle stirring (hand-rolled noise or `simplex-noise`, decide then).
6. **Rapier spike for the dry chamber.** `@dimforge/rapier2d-compat` behind
   a flag alongside `chamber.ts`: hull colliders from traced silhouettes,
   medium forces (buoyancy, size-dependent drag, wall-stir) reapplied as
   external forces, then measure — ms/frame at 150 pieces, fill ceiling,
   angle of repose, avalanche feel — against the incumbent and the ROADMAP's
   recorded numbers. Adopt only if the feel survives; either way the
   numbers go in ROADMAP.md next to the broad-phase and substep records.
   **Built 2026-08-25 — see "The Rapier spike, measured" below. Adoption
   still open, pending feel on a real phone.**
7. **Sound.** _Built_ — `lib/chime.ts`, synthesised clinks read off the
   solver's own velocity changes (works under either chamber solver), wash
   from the fluid's real swirl, behind an off-by-default Sound toggle. Web Audio, gesture-unlocked, off by default: synthesized glass
   clinks from chamber contact impulses (velocity → gain/pitch,
   rate-limited), a low fluid wash for the liquid cell keyed to swirl
   speed. `lib/` module with no React, like everything else.

Phases 1–3 are the excitement-per-effort front-runners; 4–5 are the
substance-quality debt; 6 is the big swing and can proceed in parallel as a
spike; 7 is garnish and can land any time after 1.

---

## 2026-08-25 — The Rapier spike, measured

Phase 6 of the plan above, built. `lib/chamberRapier.ts` is the object chamber
on `@dimforge/rapier2d-compat` 0.20, behind the same contract as the classic
solver — same `Shard[]`, same update, same mutated fields — reached through the
seam in `lib/solver.ts`. Nothing adopts it by default: the app switches onto it
only when opened with **`?solver=rapier`**, and falls back silently if the WASM
fails to load. `npm run dev` then `http://localhost:5173/?solver=rapier` is the
whole procedure.

What the spike does differently, and how:

- **Hull colliders.** `shapeOf` now takes the traced outline and carries its
  convex hull on the `Shape` (`hull`, in radius multiples, unused by the
  classic solver). Rapier collides a traced sliver as that hull; pieces
  without one fall back to the classic chain of circles as ball compounds.
- **The world is built ×10.** Rapier's sleep thresholds are tuned for metres
  and the cell is about one unit across — at true scale a visibly drifting
  piece counts as asleep. Positions, radii and accelerations are scaled in and
  back out.
- **The medium is a script, not a material.** In air the engine's own gravity
  and damping model the cell and the pile is left alone to sleep (woken
  whenever the angle moves, since a sleeping island does not feel gravity
  change). In a liquid the classic solver's velocity script — buoyancy,
  size-dependent drag against the _swirling_ fluid rather than against rest —
  runs before each of the four substeps, and the engine keeps the contacts.
- **Settling stays classic.** `settleChamber` (used once, at scene build) still
  runs the incumbent; the spike takes over from whatever arrangement it left.

### The numbers

Node 22 via Vite SSR, one process per comparison, 600 frames after 60 of
warm-up, cell turning slowly throughout. Round pieces collide as single balls
in both solvers; "slivers" are 8-corner hulls against the classic 4-circle
chains.

| pieces | classic, round | rapier, round | classic, sliver | rapier, sliver |
| ------ | -------------- | ------------- | --------------- | -------------- |
| 60     | 0.31 ms        | 0.97 ms       | 2.80 ms         | 1.65 ms        |
| 150    | 0.95 ms        | 1.63 ms       | 8.93 ms         | 3.60 ms        |
| 250    | 1.71 ms        | 2.80 ms       | —               | —              |
| 400    | 3.62 ms        | 4.03 ms       | —               | —              |

Two findings, one each way:

- **On round glass the classic solver wins** — about 1.7× cheaper at the
  default 150, converging by 400. Its inlined sweep over plain circles is
  simply a very good fit for that case.
- **On slivers Rapier wins by 2.5× at 150 pieces**, because one hull–hull
  test replaces up to sixteen circle-pair tests — and it is colliding the
  _actual traced shape_, not an approximation of it. A chamber loaded from a
  photograph of splinters is exactly the case the classic solver is weakest
  in, on both counts.

**The fill ceiling did not move in a crude test.** Settled 12 s then tipped
90° for 4 s, mean distance moved per piece: at 150 pieces classic 0.454 /
rapier 0.389; at 200 pieces (past the recorded wedge point) classic 0.172 /
rapier 0.117. Rapier's pile, if anything, wedges slightly _sooner_ at these
sizes. The hypothesis that rate-independence alone raises the ceiling is not
supported yet — though this test used uniform round glass and a fixed tip, not
ROADMAP's coverage methodology, so it bounds rather than settles the question.

**The picture was looked at**, per house rule: the built app at 150 pieces,
screenshotted headless under SwiftShader, renders a sane resting pile under
both solvers — nothing exploded, nothing outside the wall, no
interpenetration, coverage comparable. The arrangements differ (different
solver, same seed), which with determinism dropped as a requirement is
accepted.

### What it costs to carry

- The chunk: **2.1 MB minified, 804 KB gzipped**, split by the dynamic import
  in `lib/solver.ts` — downloaded only behind the flag, main bundle unmoved
  (286 KB). Adopting it as the default would put that on every first load.
- Tests: `chamberRapier.test.ts` holds the spike to the classic solver's
  behavioural suite — falls, stays inside the wall, stacks, holds a pile at
  5° and avalanches at 50°, suspends in oil, collides slivers as hulls.

### The open adoption question

The numbers say: adopt for traced-object chambers (the common case — every
bundled set is traced), keep classic for round glass, or keep classic outright
and take the sliver cost. What the numbers cannot say is **feel** — how an
avalanche reads in the hand — and that wants the flag tried on a real phone
before anything is switched. The ceiling result also weakens the strongest
argument for wholesale replacement; the honest summary is that Rapier's win is
_fidelity and sliver cost_, not the ceiling.
