# Roadmap

Things worth building, why they are worth building, and what they cost. Nothing
here is a commitment; it is a list to argue with and pull from.

Each item says which renderer it needs. **2D** works on the canvas pipeline that
exists today. **GL** needs the WebGL move in "The renderer" below, because it is
per-pixel work that a 2D canvas can only fake badly. That split is the main
thing this list is for: several of these are cheap once the renderer moves and
unaffordable before it.

## The renderer

### ~~Move compositing to WebGL2~~ — done

`lib/compositor.ts` and `lib/fold.ts`. The figure is a fold rather than a
drawing: each pixel is reflected back into the source triangle instead of each
triangle being placed. See "The mirrors, folded instead of drawn" in the README
for the arithmetic and the measurements.

Everything **GL** below is now unblocked.

No library in the end. The whole render is three passes, which is not a scene
graph, and a scene-graph engine would have been weight carried and not used —
so it is raw WebGL2 and costs 4.7 KB gzipped. The sizes that were on the table,
kept for whenever a later effect needs more than three passes:

|           | version | unpacked |
| --------- | ------- | -------- |
| `ogl`     | 1.0.11  | 423 KB   |
| `twgl`    | 7.0.3   | 1.16 MB  |
| `regl`    | 2.1.1   | 1.21 MB  |
| `three`   | 0.185.1 | 23.2 MB  |
| `pixi.js` | 8.19.0  | 72.4 MB  |

The 2D path stayed. It still paints the source triangle for both renderers, it
still exports the seamless tile, and it is the whole renderer where WebGL2 is
missing.

### ~~Add a web app manifest~~ — done

`public/manifest.webmanifest`. Added to the home screen it opens with no browser
chrome, which is the difference between a page about a kaleidoscope and a thing
you pick up and turn.

The icon came with it. What was there was a placeholder logo from a template,
with nothing to do with this app — so the icons are now renders of the
instrument itself, framed on a rosette, with a wider crop for the maskable one
so Android's circular mask lands inside the figure rather than on an edge.

## The glass bead

### ~~A glass bead over the end~~ — done, as a model

`throughBead` in `lib/compositor.ts`, behind a **Bead** slider that sits with
the mirrors because it is an optic rather than a content — so it applies to the
chamber, a photograph and the camera alike.

It is a model and not a ray trace: a gain curve shaped to behave like the real
thing, magnifying the middle and reaching far at the rim, rather than Snell's
law across two surfaces. Two bugs worth remembering, both found by looking at
the picture rather than at a number. Inverting about the triangle's corner
instead of the middle of the painted source sent every coordinate negative, and
the glass vanished into bare ground. And the wedge surface was only painted over
the part the current zoom used, so anything the bead sampled beyond it came back
as transparent black — holes punched clean through the figure.

Still wanted: the specular highlight below, and a rim dispersion tied to the
bead's own edge rather than to distance from the axis.

A third bug, found only once the round cell gave the pile a direction: the
bead's inversion — real marble optics, and half of what makes it read as one —
flipped the chamber's gravity. The pile hung from the ceiling, opposite the
debug arrow, and every avalanche was crushed into the rings around the apex
corners, because the inversion maps the pile's active surface onto them. The
triangular cell had hidden it completely: glass pinned inside the one visible
triangle looks much the same either way up. A half-turn of the painted cell
was tried first, cancelling the inversion and keeping the magnification; the
owner's ruling is simpler and final — **the bead never touches the chamber.**
A real instrument with an object cell has no open end to put a marble over,
so the compositor sends the shader no bead at all when the chamber is the
source, and the slider is the teleidoscope optic for a photograph and the
camera alone. Worth remembering the shape of the hunt: the renderer's mapping
was point-exact when measured in isolation, and the bug was a correct model
applied to the one source that cannot bear it.

### Teleidoscope optics in camera mode

The biggest single change in what the app _is_. A real teleidoscope has a solid
glass sphere at the objective end, and its optics are specific: n≈1.5 puts the
focus just outside the surface, so the sphere forms an **inverted, heavily
compressed fisheye of the whole hemisphere in front of it**, with the
compression going nonlinear toward the rim.

Camera mode today is a mirrored webcam. This makes it an instrument.

**GL** for the real thing. A **2D** approximation exists — draw the frame as
~32 concentric annuli, each scaled by the sphere's own r→r′ curve — and is
worth building first if the renderer move is not imminent, because it proves
the mapping is right before any shader is written.

### Rim dispersion

Glass balls separate colour hard at the edge. Red and blue pull apart visibly in
the outer third. Falls out of the bead mapping almost for free once it exists.
**GL.**

A first version of this already ships as part of the fold: the outer channels
are read from folds of their own, so the split obeys the mirrors rather than
smearing across them. It is small and tied to distance from the axis. The bead
wants a much stronger version, tied to the sphere's own rim.

### The highlight on the bead

One bright specular spot, fixed to the room rather than to the pattern. It is
what gives the bead roundness; without it the fisheye reads as a filter. **2D.**

### ~~The bead over the object chamber too~~ — answered: never

The open question closed when the round cell landed and the bead's inversion
hung the pile against gravity (see "A glass bead over the end" above). The
owner's ruling: the bead does not affect the chamber, ever. It is the
teleidoscope optic, for a photograph and the camera.

## Light and colour

### Iridescent sheen, driven by tilt

Oil-slick colours across the glass, as a conic gradient in `overlay` or
`soft-light`.

The trap: it must **not** mirror with the pattern. Real glare comes from the
objective lens and the room, not from inside the chamber, so a sheen that
repeats six times reads as a sticker. It lives in screen space, after the
tiling.

The thing that sells it: rotate it with the device tilt, which `lib/tilt.ts`
already reads live. Tip the phone and the sheen slides across the glass. That
one connection is the difference between a surface and a filter. **2D**, better
in **GL**.

### Facet sparks

Brief specular hits on individual pieces as they tumble, alpha driven by each
piece's `rotation` against a virtual light. One small radial gradient per lit
piece. Makes a settling pile feel alive rather than merely animated. **2D.**

### ~~Glitter~~ — done, then done properly, then made a substance of its own

`lib/glitter.ts`, behind a **Glitter** slider. It began as `glitterAt` in the
compositor and has been taken out of there.

Real glitter is thousands of tiny flat mirrors at random orientations, and it
does not glow — it _flashes_, one flake at a time, as the angle between you, the
flake and the light passes through alignment.

That is the whole trick, and it is why glitter looks fake when it is drawn as
sparkly dots: the flashes have to be driven by something real. We have the real
thing already — device tilt. Each flake gets a fixed random normal, and its
brightness is a sharp power of the half-vector alignment. Tilt the phone and
they fire in waves across the field.

Suspended in the oil cell below, this is probably the single prettiest thing on
this list. **GL** — thousands of instanced points with per-flake normals is a
shader's home ground and a 2D canvas's worst case.

That last paragraph was wrong twice, and both were worth finding.

**The flakes were nowhere.** A lattice in the source triangle's frame, evaluated
per pixel, is fixed to the triangle — so it sat perfectly still while the glass
avalanched underneath it and the fluid swept past. The flash was right and the
matter was missing. They are particles now, seven hundred of them, and a flake
goes wherever what surrounds it goes: caught on a piece of glass in a dry cell,
riding it as it tumbles; loose in the fluid in a liquid one, swept round by the
swirl long after the glass has given up. The count is what the slider spends, so
a fifth of the way up costs a fifth.

**A flash alone is invisible.** Light added to a white ground is still white, and
this chamber's ground is white — so half the cell's flakes could not be seen at
all and the rest only tinged the glass they lay on. Which is true of the real
thing as well: a mirror cannot be brighter than a lit white page. What it can do
is _sit on_ it. A flake is drawn twice now, once as itself and once as the flash.

And the 2D canvas was not the worst case after all, because the count that
matters is the count in the cell rather than the count on the screen. Seven
hundred specks and their flashes are about a thousand sprite draws a frame, next
to the four hundred and fifty the glass already costs.

### Thin-film interference on piece edges

Soap-bubble colours mapped from piece thickness. Physically motivated rather
than invented. **GL.**

### ~~Mirrors that are green~~ — already done when this list was written

Silvered mirrors are green — iron in the glass — and every bounce multiplies it.
Photograph a real kaleidoscope and the outer reflections go dimmer _and_ greener
while the middle stays neutral.

Listing this was a mistake on my part: `MIRROR_TINT` has been per-channel since
long before, at `{0.958, 0.983, 0.975}`, and both renderers raise it to the
bounce count. The shader made it _more_ right, because the count it is raised to
is now exact rather than a radial estimate — but the green itself was never
missing.

### Bloom on the bright facets

Glass catches light and blooms. Cheap in **GL**, painful in 2D.

## Distortion

### Barrel and pincushion

Same annulus technique as the bead, applied to the whole field. Reads as a cheap
plastic tube lens, which is authentic to actual toy kaleidoscopes rather than a
defect. **2D**, trivial in **GL**.

### Wavy antique glass

Sample in horizontal strips with a sinusoidal offset — old hand-rolled glass. Very
cheap: N strip draws. **2D.**

### Refraction at the mirror joins

Real mirrors bend the image in a thin band either side of their cut edges. The
geometry is already in hand — `#drawSeams` knows where every join is. **GL.**

### Depth of field

Pieces nearer the eye slightly soft. We have a per-piece radius to drive it.
Needs `ctx.filter` in 2D, which wants Safari 17+ and a fallback; free in **GL.**

## The chamber

### ~~Make the chamber round~~ — done

The cell is now the disc the mirror triangle is inscribed in, which is how
most real instruments are built. `lib/chamber.ts` keeps a single circular wall
and none of the three flat ones; `CORNER` and the corner-wedging compromise
went with them, and so did the `bounds` parameter — a circle is
rotation-invariant, so turning the tube is gravity's business alone.

The broad phase went in with it, inlined this time: the pair loops in
`separate` and `tumble` sweep the pieces in left-edge order from a persistent
sorted array, insertion-sorted each pass because a settled pile barely moves
between passes, with no callback anywhere near the pairs that survive. This
time it paid — same process, same machine:

| pieces | ms/frame, pairwise | ms/frame, swept |
| ------ | ------------------ | --------------- |
| 60     | 0.49               | 0.26            |
| 120    | 1.50               | 0.63            |
| 250    | 5.36               | 2.06            |
| 400    | 13.2               | 4.72            |

What the plan did not anticipate: **"more pieces" has a ceiling of its own,
and it arrives before full coverage does.** Measured on settled piles of
default-sized glass, at about three quarters packed by collision area the pile
still rests and still avalanches when turned; by 160 pieces it wedges solid —
tip it and nothing moves, which takes the whole mechanism with it, the same
death the sixty-degree corners used to cause, now caused by fill. Between
"rests" and "wedges" there is also a band where the pile never stops creeping.
So the default is 150 pieces, the most the mechanism affords; the shard slider
treats that as full and only empties from there. At that fill the mirror
triangle measures about 97% covered with the worst wall band in the low
eighties — against 43% covered and one wall fully bare for the old default —
and what remains is a chink of ground that can open along whichever wall
stands highest at rest. Closing the last of it means raising the ceiling, not
the count: the
rate-independent solver below is the road, since what wedges the pile is
per-pass corrections specified in step-sized units.

Verified both ways this repo insists on: the table above is a one-process
comparison, and the picture was looked at — the old default renders as
garlands of glass on bare ground, the new one as a full field. A coverage test
in `scene.test.ts` now samples the settled triangle so the bare strip cannot
quietly come back.

### The media axis, still wrong for photographs

Carried over from the round-cell notes, and still to do: the bead's axis is
the triangle's middle, which is wrong for a photograph, because `drawMedia`
centres a picture on the apex. Centring on the apex is worse — most of the
picture is clipped off-canvas around it and the figure goes black. It needs
the media given somewhere on the surface to be drawn around. A grid photograph
shows the fault immediately and is the test to use.

### Two things that were tried and did not work

Both were proposed off the back of the WebGL move, on the reasoning that
compositing had left the CPU and the freed budget should go into physics. Both
were measured and neither paid. Written down because they are the obvious ideas,
and without the numbers they will be had again.

**A broad phase.** The solver tests every pair against every other, so cost goes
up as the square: thirty pieces to four hundred is thirteen times the glass and
fifty-two times the work. A uniform grid over the chamber does prune well — 71%
of pairs at sixty pieces, 74% at four hundred. It was still **slower**: 0.435
ms/frame against 0.332 at sixty pieces.

The reason is that the pairs it prunes are two subtractions and a compare, while
every pair it keeps costs a function call through the visitor. Measured with the
grid disabled but the callback still in place, sixty pieces cost 0.427 ms — so
almost all of the loss was indirection, not the grid.

Since rebuilt, inlined, as part of the round cell above — a sweep rather than a
grid, and it pays at every count now that the round cell wants a hundred and
fifty pieces. These numbers stand as the record of why the first build did not.

**More substeps.** The theory is Macklin's, and it is why there are four rather
than one. Going further does nothing:

| substeps | ms/frame | overlap mean / 95th | creep |
| -------- | -------- | ------------------- | ----- |
| 2        | 0.184    | 6.75% / 19.3%       | 0.025 |
| 4        | 0.358    | 6.64% / 20.6%       | 0.055 |
| 8        | 0.677    | 6.68% / 21.4%       | 0.144 |
| 16       | 1.347    | 6.93% / 19.2%       | 0.196 |

Accuracy is flat and the pile jitters roughly eight times as much, for seven
times the cost.

### Make the solver rate-independent

Which is what the table above is really saying. The constants are all _per pass_
— `SEPARATION` resolves 80% of an overlap per pass, `FRICTION` converts 55% of
the slip per pass, and the sleep thresholds are velocities. So changing the
number of passes changes the material rather than refining the answer, and there
is no reason for accuracy to improve.

Creep rising is the same fact from the other end: velocity is read back as
`(x - previous) / step`, so a correction of a fixed size reads back as a larger
velocity when the step is smaller, and a settled pile stops falling under
`SLEEP_SPEED` and never gets to sleep.

The fix is to say those things in units that do not depend on the step —
compliance for the contact rather than a fraction, a Coulomb coefficient against
the actual normal impulse rather than a share of the separation, and sleep
measured on how far a piece moved rather than how fast it is going. Then
substeps would converge, and the chamber would be tunable in numbers that mean
something.

Worth doing, and not casually: it re-tunes a feel that took a long time to get
right, and every number in it would move. **2D** — nothing here needs the GPU.

The round cell raised what this is worth. A full disc of glass never gets every
piece under the sleep thresholds at once, so `settleChamber` pays its whole cap
on load rather than returning at rest; and the fill ceiling recorded above —
rest at three quarters packed, wedged solid at 160 pieces — is made of the same
step-sized units. Raising that ceiling is what would close the last chinks of
bare ground at the apex corners.

A second road exists now: `lib/chamberRapier.ts` runs this chamber on Rapier —
a rate-independent solver with real polygon colliders — behind `?solver=rapier`
while it is being measured. First numbers, and a caution: on traced slivers it
is 2.5× cheaper than the chains of circles at 150 pieces, but a crude 90°-tip
test did not show it raising the fill ceiling. See "The Rapier spike, measured"
in RESEARCH.md.

### ~~An oil cell~~ — done

`Medium` in `lib/chamber.ts`, behind the **Liquid** tab, with a **Thickness**
slider running from a thin oil to a gel. It was the best value on this list for
the effort and it turned out to be that: the solver did not change, it was
told what the glass is moving through.

Three terms, and the third is the one the plan did not have. Buoyancy is
Archimedes — a piece falls under `1 - density` of its own weight, the fluid's
density quoted as a fraction of the glass's — and damping is drag, which turns
that reduced weight into a terminal drift rather than a slow acceleration. One
piece dropped the height of the cell takes 1.1 s dry, 3.2 s in a thin oil, 6.9 s
at the default and 45 s in the gel.

Drag is also where **size** comes in, which the first version of this missed and
which is the first thing anybody notices: every piece sank at the same rate.
Gravity is an acceleration, so it moves a boulder and a grain alike — which is
right for the dry cell, where the damping stands for the pile rattling energy
out of itself rather than for air resistance. In a fluid the resistance goes
with the surface and the weight with the bulk, so for a disc the drag rate goes
as `1/r` and the settling speed as `r`. Twice across, twice as fast down; a 0.12
piece now falls 1.8× as far in a second as a 0.04 one, and in air the two still
land together.

The third is that **a liquid does not turn with the tube**. It lags while the
tube is turning and then carries on after it has stopped, and that one number —
how fast the wall drags the body of fluid up to its own rate — is most of what
the hand feels. Without it a wet cell is only a slow dry one. Drag is taken
against the fluid rather than against the cell, so a piece riding a swirl feels
none of it and a piece adrift in one is carried round.

Two things were worth being careful about, both of them about not disturbing
what was already tuned. Air's density is written as **nought** rather than the
twelve ten-thousandths it really is, and its stir is read as _no fluid at all_
rather than as one that catches up instantly — a large finite number would have
left a whisper of swirl behind on a fast display, which is a retuned chamber
arriving by the back door. A test drives the two cells side by side and expects
them equal piece for piece.

And **nothing sleeps in a liquid**: the thresholds that stop a dry pile
jittering would catch a slow sink and freeze the cell solid. Which means a fresh
liquid cell cannot be settled by running it until it stops, because it never
does — so it is _unpacked_ instead, a second and a bit to push the glass out of
itself, and it opens on the field as it was scattered rather than on a pile on
the floor. Measured the way the round cell was, the mirror triangle stays about
99% covered through a minute of sinking at every thickness.

Still a medium and not a fluid: nothing displaces it, there is no surface to
slosh, and the only current is the one the wall stirs up. The two below are what
would change that.

### ~~One size of glass, and every size~~ — done

`pieceRadius` in `lib/scene.ts`, behind a **Variety** slider on both chamber
tabs. Nought is a cell cut to one size — "normal", whatever the pinch has set
that to — and opening it spreads the sizes about that middle, so the smallest
get smaller as the biggest get bigger. At the widest the biggest piece is ten
times the smallest, which is everything from grit to beads.

In proportion rather than in width, because size is felt as a ratio: a piece
twice its neighbour reads the same way whether the two are specks or boulders.
So the sizes are spread evenly in the logarithm, and the slider is the width of
that spread.

The part worth writing down is what it took to make the slider mean **only** what
it says. A piece three times across is nine times the glass, so a wider spread
would have filled the chamber as well as mixed it, and there would have been no
way to ask for one without the other. With `r = m·e^(u·h)` for `u` even over
`[-1, 1]`, the mean of `r²` is `m²·sinh(2h)/2h` — so dividing the middle by the
root of that holds the total area of glass constant across the whole range. How
full the cell is stays the piece count's business, which is where the fill
ceiling in "Make the chamber round" measured it.

The middle is the same size a medium's drag is quoted at, deliberately: "normal"
ought to mean one thing in the chamber.

### ~~A lava lamp~~ — done

`lib/lava.ts`, and it is the substance the Liquid tab opens on. Blobs of a
second liquid that will not mix with the first: they climb, flatten against the
top, cool, sink, gather, and run into each other on the way.

**The heat cycle** is what a lava lamp is, and it is four lines. A blob near the
bottom warms, warm is lighter than what it floats in so it rises, near the top
it cools and comes back down. Nothing else lifts a blob, which is why the cell
never settles.

**Metaballs** are what make it read as liquid rather than as a bag of circles.
The fields add and the surface is the contour of the sum, so two blobs
approaching pinch into one shape before their circles touch and one coming apart
necks first. Merging adds areas and mixes colours; anything that grows past a
fraction of the cell is pulled into two, because merging only runs one way and
without that every cell ends as one lump.

Five things were got wrong first and every one of them looked reasonable.

**The heat cycle was a spring.** Aiming each blob at a temperature read off its
own height, everywhere, makes lift point at the middle from both directions —
so the cell converged on its own centre and stopped, and the only motion left
was blobs merging and splitting. A lamp works because of the _lag_: the wax
does not cool until it has been at the top a while, so it overshoots at both
ends. Nothing in the middle should touch its temperature at all. Fixed, a blob
takes about ten seconds to go up and come back, and the cell moves faster than
it did on the churn that was standing in for it.

**And the churn staggered.** Merging makes a blob bigger and splitting makes it
smaller, so the two are a loop; with the split threshold sitting exactly where a
merge lands and the halves placed close enough to meet again, the loop ran at
frame rate and the whole cell alternated between two arrangements sixty times a
second. On the field a typical frame moved it by 1.23 where it should move 0.015.
Wax that has just pinched apart now keeps to itself for a second and a half, and
the halves are left overlapping what they came off so the shape necks rather than
popping. **Every other measurement was happy the whole time** — blobs inside the
wall, wax conserved, colours mixing, count steady — which is the lesson worth
keeping: the only thing that would have caught it is measuring the picture from
one frame to the next, and `lava.test.ts` does that now.

The other three: sizing the blobs by how far their fields reach rather than by
where the surface lands (0.54 of it) gave dots; sizing them on the areas of blobs
that never overlap — when the whole point is that the fields add — filled the
cell with one shape; and a palette drawn from opposite sides of the colour wheel
averaged, through merge after merge, to the colour of a puddle.

### Actual fluid, on the solver we already built

The unusual-physics one, and the reason it is realistic to want it: **Position
Based Fluids** (Macklin & Müller, 2013) is XPBD with a density constraint, and
`lib/chamber.ts` is already an XPBD solver doing substeps and constraint
projection. A fluid is not a different engine here. It is another constraint in
the loop we have.

That gives real liquid in the cell — glass pieces displacing it, glitter carried
in the currents, the whole cell sloshing when you tilt the phone, because the
gravity vector feeding it is already the real one. The oil cell above is the
cheap half of this and is not on the way to it: it is a medium the glass moves
through, with no liquid of its own to push about. What it does supply is the
tab, the thickness control and somewhere for this to land when it is built.

The ink below is nearer than it looks, and still not this. It holds a real
velocity field that the glass stirs — so the coupling exists in one direction
already — but it is a grid on the Eulerian side of the fence and the glass
never feels it back. Giving the shards the fluid's push would be the first half
of this, and cheap; the density constraint that makes the fluid itself a pile of
particles is the other half, and is the job.

Rendered as screen-space metaballs, which is another piece of luck: pieces are
_already_ chains of 2–4 circles for collision, so the metaball field is sitting
there waiting to be drawn. **GL** to render; the solver work is **2D**-agnostic.

### ~~Smoke and ink~~ — done, on the CPU, and then given the cell to itself

`lib/smoke.ts`, and it is one of the three substances a cell of liquid can hold
rather than a tint poured around a pile of glass. The standard Stam solver, and
it did look like nothing else.

Two things had to be added before it looked like _smoke_ rather than fog, and
both are known techniques that exist for exactly this reason: semi-Lagrangian
advection is stable because it averages, and what an average takes out first is
the smallest swirls. **Vorticity confinement** (Fedkiw, Stam and Jensen, 2001)
measures the curl and pushes it back — but pointed straight at the raw curl it
chases single cells, and drew a row of grid-aligned comb teeth along the edge of
every ribbon; one pass of blur over the curl's size first points it at the swirl
instead of at the grid. **MacCormack advection** takes the blur off by measuring
it: carry the field forward again from where it landed, and the miss is the
error the trace introduced.

Between them was a wrong turn worth recording, because it is the obvious idea:
an unsharp mask, taking a little of the local average back out of every cell.
Sharpening by amplifying the difference from the neighbours amplifies the
_shortest_ wavelength hardest, and the shortest wavelength a grid has is a
checkerboard.

The grid went from 64 to 96 when this stopped being a tint and became the whole
picture, and the cost with it: **1.9 ms per rendered frame** against the 0.6 a
chamber of glass costs — and a cell of smoke is not running one.

**GL** turned out not to be needed, and the reason is worth writing down: ink is
smooth. It has no edges of its own to resolve, only ribbons, so the picture at
64×64 is nearly the picture at twice that — and four thousand cells stepped at
30 Hz, with the time banked so the drift rate does not depend on the frame rate,
measures **0.9 ms per rendered frame** against the rest of the chamber's 0.6.
Being on the CPU is what lets the ink live with the rest of the chamber instead
of in the compositor: it is painted into the source triangle and folded by the
mirrors along with everything else, six reflections of the same ribbon.

Three things drive the field. The wall drags the body of fluid round at the rate
`advanceFlow` already tracks — the swirl was indeed waiting to be used. The dye
is a little heavier than what it floats in, so a ribbon sags. And **the glass
stirs it**: a piece sinking through pulls a wake, an avalanche leaves the whole
cell churning. That last one has a trap in it. Pulling the fluid towards every
piece's velocity is the same rule read backwards — a cell packed with settled
glass then holds the fluid still everywhere the glass is, which is nearly
everywhere, and the ink stops dead the moment the pile does. Only moving glass
stirs, and in proportion to how fast.

Three dyes, subtractive, each taking its own primary out of the light, so the
drawing composites with `multiply` and two dyes folded together read as the
mixture rather than as the brighter of the pair.

What it is not: the dye is advected, not suspended. Tracing backwards and
sampling bilinearly loses a little of the field every step, and over a minute
that would turn ribbons into a flat wash — which real ink in oil does not do,
because it is suspended rather than dissolved. Modelling that means tracking the
surface between two fluids. So the blur is fought instead: a little of the local
average is taken back out of every cell each step. It is a countermeasure to a
fault of the method, and it is written down as one.

**One thing was tried and did not pay.** The wall is a circle on a square grid,
so nine cells in ten have all four neighbours inside it and could read them
straight out of the array rather than asking about each one. Marking those cells
and giving the pressure solve and the advection a path of their own for them
measured **0.862 ms against 0.899** — four per cent, for a field to build and
keep and three more branches in the hottest loops in the chamber. The engine was
already inlining the check. It was taken out again.

### Polarised mode

Polarising film plus cellophane is how real kaleidoscopes get those electric
interference colours. Map piece thickness to an interference hue. Striking, and
physically motivated. **2D.**

## Housekeeping

### ~~A Liquid tab~~ — done, and then done for the right reason

**The first version of this had the idea backwards, and the note below is what
that mistake looked like from inside it.** It read "a chamber of liquid" as
_glass suspended in a liquid_ — the same pile of shards, sinking more slowly,
with dye poured around it and flakes sprinkled over it. The owner's correction
was one sentence: instead of chunks there is a different substance in the
chamber. A lava lamp. Smoke in air. Glitter.

So a cell of liquid now holds **no glass at all**. The substance _is_ the
content, and there are three of them behind a picker in the tab: `lib/lava.ts`,
`lib/smoke.ts` and `lib/glitter.ts`. The oil cell below stays exactly as it was
and is still what the **Shards** tab's chamber falls through; what went is the
idea that suspending glass in it was the interesting thing to do with it.

Worth keeping the shape of the mistake: every piece of it worked, was measured,
was tested and was documented, and all of that was in service of an answer to
the wrong question. Nothing in the numbers could have caught it — only the
picture, and only somebody who knew what the thing was supposed to be.

### ~~A Liquid tab~~ — the note from the first version

The oil cell above landed, so it is a tab: **Shards**, **Liquid**, **View**. A
checkbox on the shard tab would have filed the difference between two
instruments as a setting of one.

It carries everything the shard tab carries — the glass, the piece count, the
glitter, the seed — because a liquid cell is a chamber and all of that still
means what it meant, plus the **Thickness** that is only true of it. It is also
the first thing about a source that travels in a shared link: which cell the
glass hangs in is a property of the look, unlike a photo or a camera, which name
something at the recipient's end that a link cannot carry.

The tabs were three when this was written and are three again; Photo and Camera
had already merged into View by then, being one instrument pointed at two
things.

### Replace or drop `bright-gems` and `cut-stones`

The two remaining stand-ins, keyed out of flattened stock previews, not cleared
for redistribution. Blocked on new pictures.

### `flowers.webp` has no alpha channel

The only set of the seven without one. It works — the tracer falls back to
keying against the border colour and finds twelve objects — but a
transparent-background export would trace more precisely.
