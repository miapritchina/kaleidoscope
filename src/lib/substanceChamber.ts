import { CHAMBER_RADIUS, type Chamber, type ChamberStep, type ChamberView } from './chamber';
import { GROUND } from './color';
import { paintDrops } from './drops';
import { paintFilm } from './film';
import { paintInk } from './ink';
import { createFlakeSprites, drawGlitter, type FlakeSprites } from './glitter';
import { paintLava } from './lava';
import { liquidCell } from './physics';
import { paintSmoke } from './smoke';
import { createScene, updateScene, type SceneCut } from './scene';
import type { SubstanceId } from './settings';

/**
 * A chamber filled with a substance instead of glass.
 *
 * Lava, a liquid timer, smoke, ink, an oil film, glitter: six things that are
 * liquids or things in a liquid, and none of them a pile of pieces. Each is
 * simulated in `lib/lava.ts` and its siblings and paints itself into a square
 * picture; all this file does is put that picture in the cell and turn it with
 * the bearing.
 *
 * All six are drawn in the cell's own frame — turned with it and moved with
 * the drag — because all six are things *in* the chamber rather than effects
 * on the picture, and the mirrors are meant to fold them exactly as they fold
 * a piece of glass.
 */

/**
 * What a cell of substance is lit against.
 *
 * The dry chamber's ground has always been white, on the reasoning that the
 * objects are the subject and white is what a photographer would stand them on.
 * Lava and smoke want the same thing for the same reason. Glitter does not: a
 * flake is a mirror, a mirror cannot be brighter than a lit white page, and
 * the whole of what glitter does is be brighter than what is behind it. So its
 * cell is a dark liquid, which is also what the real ones are — and the oil
 * film's is too, because interference colours are reflections and an oil
 * slick is vivid on wet asphalt and invisible on a white page.
 */
function groundFor(substance: SubstanceId): string {
  return substance === 'glitter' || substance === 'film' ? DARK_GROUND : GROUND;
}

/** The dark liquid a cell of glitter or oil film hangs in. */
const DARK_GROUND = '#0e1526';

/** What the substance chamber reads fresh every frame. */
export interface SubstanceChamberInputs {
  /**
   * How thick the fluid is, 0 thin to 1 gel.
   *
   * The one thing a cell of substance takes live: how much its fluid resists
   * whatever is moving through it. Which substance and how much of it are
   * geometry, and wait with the rest of the cut.
   */
  thickness: () => number;
  /**
   * Where to make the offscreen surfaces the flake sprites are drawn on.
   *
   * Only for a test running without a canvas backend, as in `lib/glitter.ts`.
   */
  createCanvas?: () => HTMLCanvasElement;
}

/**
 * Builds a chamber of substance.
 *
 * @param cut Which substance, how much of it, how big its pieces are, and the
 *   seed it is built from. Fixed for the life of the chamber: switching
 *   substances is switching instruments, not turning a knob.
 */
export function createSubstanceChamber(
  cut: SceneCut & { seed: string; substance: SubstanceId },
  inputs: SubstanceChamberInputs = { thickness: () => 0.35 },
): Chamber {
  const scene = createScene(cut.seed, 0, { ...cut, holds: 'substance' });
  let flakes: FlakeSprites | null = null;
  // How fast the tube was turning on the last step, for the wash: what is
  // heard is the fluid slipping against the wall, which is the difference
  // between the two rates and not either one of them.
  let turning = 0;

  return {
    ground: groundFor(cut.substance),
    // A cell caps the tube, substance or glass. No bead over it.
    open: false,

    update(step: ChamberStep) {
      turning = step.turn;
      updateScene(scene, {
        dt: step.dt,
        gravity: step.gravity,
        turn: step.turn,
        thickness: inputs.thickness(),
        // The fluid is dragged round by the wall rather than bolted to it, so
        // it trails the tube and then outlives it. That lag is the medium's.
        medium: liquidCell(inputs.thickness()),
        stir: step.touch,
      });
    },

    paint(ctx: CanvasRenderingContext2D, view: ChamberView) {
      // Every substance paints itself into a square that just contains the
      // cell, so the whole disc is covered whatever it is doing — which is the
      // one thing the body asks of a chamber.
      const across = CHAMBER_RADIUS * view.scale;
      const pan = view.pan;

      if (scene.lava) {
        const painted = paintLava(scene.lava);

        if (painted) {
          place(ctx, view, pan);
          ctx.imageSmoothingEnabled = true;
          // Laid on rather than multiplied: the wax is a body of colour with a
          // surface, and what is behind it does not come through.
          ctx.drawImage(painted, -across, -across, across * 2, across * 2);
          ctx.restore();
        }

        return;
      }

      if (scene.drops) {
        const painted = paintDrops(scene.drops);

        if (painted) {
          place(ctx, view, pan);
          ctx.globalCompositeOperation = 'multiply';
          ctx.imageSmoothingEnabled = true;
          // Two transparent liquids, one behind the other: what the beads come
          // out as is the pair multiplied rather than a colour chosen anywhere,
          // which is the whole trick these toys are sold on.
          ctx.drawImage(painted, -across, -across, across * 2, across * 2);
          ctx.restore();
        }

        return;
      }

      if (scene.smoke) {
        const painted = paintSmoke(scene.smoke);

        if (painted) {
          place(ctx, view, pan);
          ctx.globalCompositeOperation = 'multiply';
          ctx.imageSmoothingEnabled = true;
          // Taken out of the light rather than added to it, which is what a dye
          // does: it does not paint the cell, it decides what gets through it.
          ctx.drawImage(painted, -across, -across, across * 2, across * 2);
          ctx.restore();
        }

        return;
      }

      if (scene.ink) {
        const painted = paintInk(scene.ink);

        if (painted) {
          place(ctx, view, pan);
          ctx.globalCompositeOperation = 'multiply';
          ctx.imageSmoothingEnabled = true;
          // Multiplied, which is both what paint does to the light coming
          // through it and what makes the chamber's white ground the paper the
          // Kubelka-Munk layer was solved over.
          ctx.drawImage(painted, -across, -across, across * 2, across * 2);
          ctx.restore();
        }

        return;
      }

      if (scene.film) {
        const painted = paintFilm(scene.film);

        if (painted) {
          place(ctx, view, pan);
          ctx.imageSmoothingEnabled = true;
          // The fluid the slick is floating on, lit — the same wash the flakes
          // hang in. Where the film runs out its alpha runs out with it, and
          // what shows through has to be *water*: against a flat dark fill
          // every shore of every patch read as a hole cut in the picture.
          depth(ctx, across);
          // Laid on over that: these colours are reflections, and a reflection
          // is only as visible as the ground is dark.
          ctx.drawImage(painted, -across, -across, across * 2, across * 2);
          ctx.restore();
        }

        return;
      }

      if (scene.flakes) {
        flakes ??= inputs.createCanvas
          ? createFlakeSprites({ createCanvas: inputs.createCanvas })
          : sharedFlakes();

        // The liquid the flakes hang in, lit. A flat fill behind them is a
        // sheet of paper with specks on it; a cell with light in the middle of
        // it and darkness at the wall is a cylinder of liquid with specks
        // *in* it, and the difference is one gradient.
        depth(ctx, across);
        drawGlitter(ctx, scene.flakes, {
          scale: view.scale,
          rotation: view.rotation,
          pan,
          // Where the body says the room's lamp is. A flake is a mirror; where
          // the light is coming from is the whole of what it has to know.
          light: view.light,
          sprites: flakes,
        });
      }
    },

    listen() {
      // No knocks — there is nothing hard in here to knock. What a cell of
      // substance makes is the wash of its fluid turning against the wall, and
      // that is the lag between the fluid and the tube.
      return { impacts: [], wash: Math.min(1, Math.abs(scene.flow - turning) / 2) };
    },
  };

  /**
   * The light in the body of a dark cell, as a wash over the ground.
   *
   * A cell lit from behind is brightest where the light comes straight through
   * and darkest at the wall, where it has the most liquid to cross and the
   * glass to get past. It costs one gradient and it is what turns a flat
   * backdrop into something the flakes are suspended inside.
   */
  function depth(ctx: CanvasRenderingContext2D, across: number): void {
    const wash = ctx.createRadialGradient(0, 0, 0, 0, 0, across);

    wash.addColorStop(0, 'rgba(126,160,214,0.30)');
    wash.addColorStop(0.55, 'rgba(96,126,178,0.14)');
    wash.addColorStop(1, 'rgba(6,10,20,0.35)');
    ctx.save();
    ctx.fillStyle = wash;
    ctx.fillRect(-across, -across, across * 2, across * 2);
    ctx.restore();
  }

  /** Into the cell's own frame: dragged, then turned. */
  function place(
    ctx: CanvasRenderingContext2D,
    view: ChamberView,
    pan: { x: number; y: number },
  ): void {
    ctx.save();
    ctx.translate(pan.x * view.scale, pan.y * view.scale);
    ctx.rotate(view.rotation);
  }
}

/**
 * The flake shapes, made once for the whole program.
 *
 * Specks of foil in a handful of tints, which depend on nothing a cell can
 * change — so every cell of glitter there has ever been wants the same ones.
 * A test with no canvas backend passes its own factory and gets its own set.
 */
let shared: FlakeSprites | null = null;

function sharedFlakes(): FlakeSprites {
  shared ??= createFlakeSprites();

  return shared;
}
