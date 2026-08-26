import { type Chamber, type ChamberSound, type ChamberStep, type ChamberView } from './chamber';
import { createChipSprites, type ChipSprites } from './chips';
import { readImpacts, type Impact } from './chime';
import { GROUND } from './color';
import { isMediaReady, type MediaElement } from './media';
import { AIR } from './physics';
import {
  applyCutShape,
  createScene,
  drawChamber,
  SKIN_PATCH,
  updateScene,
  type Glass,
  type SceneCut,
} from './scene';
import { createSkinPatches, measureSource, type SkinPatches } from './skin';

/**
 * A chamber of loose glass.
 *
 * The classic one: a few hundred pieces cut out of a photograph, tumbling in a
 * round cell under gravity. Everything that makes it interesting is in
 * `lib/scene.ts` and `lib/physics.ts`; this file is only the fitting that lets
 * the body hold it — see `lib/chamber.ts` for what that fitting is worth.
 *
 * The two things it does that are its own: it scores each loaded picture for
 * where the pieces should be cut from, and it cuts the pieces to those shapes.
 * Both used to live in the renderer, which meant the optics knew what a
 * photograph was.
 */

/** What the glass chamber reads fresh every frame rather than at build time. */
export interface GlassChamberInputs {
  /**
   * The pictures the pieces are cut out of, mixed together.
   *
   * A function rather than a value: the chosen sets load one at a time and are
   * toggled about while the chamber runs, and rebuilding a settled pile of a
   * hundred and fifty pieces because a checkbox moved is not on.
   */
  skins: () => readonly MediaElement[];
  /**
   * The live piece-size multiplier, from the pinch on the artwork.
   *
   * The glass is only recut once the size holds still — see {@link SceneCut} —
   * so until then the sprites run ahead of the cut by the difference, which is
   * what puts the growing under the fingers.
   */
  scale: () => number;
}

/**
 * Builds a chamber of glass, settled and ready to be looked at.
 *
 * @param cut How the glass is cut: the seed, how many pieces, how big, how
 *   varied. Fixed for the life of the chamber — a different cut is a different
 *   chamber, because a bigger piece displaces its neighbours and piles
 *   differently, which cannot be done by drawing the same pile smaller.
 * @param inputs What is read live instead. Left out, the chamber holds no
 *   pictures and comes up empty, which is what the tests want.
 */
export function createGlassChamber(
  cut: SceneCut & { seed: string; count: number },
  inputs: GlassChamberInputs = { skins: () => [], scale: () => 1 },
): Chamber {
  const scene = createScene(cut.seed, cut.count, { ...cut, holds: 'glass' });
  const sprites: ChipSprites = createChipSprites();

  // One score per picture, kept until the picture itself changes. Keyed by the
  // element so several sets can be scored at once and each is only worked once,
  // however the chosen mix is toggled about.
  const scores = new Map<CanvasImageSource, { patches: SkinPatches | null; stamp: string }>();
  // What the pieces were last cut against, so a chamber that is already right
  // is left alone.
  let cutAgainst: readonly Glass[] = [];

  const heard = { velocities: new Float32Array(0) };
  const impacts: Impact[] = [];

  /**
   * Where in the skin each piece is cut from, scored once per picture.
   *
   * A camera frame changes every frame and is not rescored for each one:
   * reading a canvas back is a pipeline stall, and a live feed is interesting
   * all over anyway — the scoring is there for a still of a subject on a plain
   * backdrop, which is what a picked photo usually is.
   */
  function scoreOf(skin: CanvasImageSource): SkinPatches | null {
    const size = measureSource(skin);
    const stamp = `${String(size.width)}x${String(size.height)}`;
    const cached = scores.get(skin);

    if (cached?.stamp === stamp) {
      return cached.patches;
    }

    const patches = createSkinPatches(skin, { patch: SKIN_PATCH });

    scores.set(skin, { patches, stamp });

    return patches;
  }

  /** Every chosen set that has pixels yet, scored once each and kept. */
  function loaded(): Glass[] {
    return inputs
      .skins()
      .filter((item): item is MediaElement => isMediaReady(item))
      .map((skin) => ({ skin, patches: scoreOf(skin) }));
  }

  return {
    // What the glass is lit against. A cell is lit from behind, and a piece of
    // coloured glass reads as transmitted colour only over something white.
    ground: GROUND,
    // A cell caps the tube: there is no objective in front of it, so no bead
    // goes over it. The owner's standing decision, answered here rather than
    // asked about by the optics.
    open: false,

    update(step: ChamberStep) {
      updateScene(scene, {
        dt: step.dt,
        gravity: step.gravity,
        turn: step.turn,
        // Dry. The liquid cell holds a substance instead of glass, so there is
        // nothing left for the glass to be suspended in.
        medium: AIR,
      });
    },

    paint(ctx: CanvasRenderingContext2D, view: ChamberView) {
      const glasses = loaded();

      // What each piece is cut to is what it should collide on, and that is
      // settled by the glass rather than by the frame. Done here because this
      // is where the two meet: the scene knows nothing about pictures and the
      // pictures know nothing about the scene.
      if (!sameGlasses(cutAgainst, glasses)) {
        cutAgainst = glasses;
        applyCutShape(scene.shards, glasses);
      }

      drawChamber(ctx, scene, {
        scale: view.scale,
        // A pinch in progress, seen live: the glass is only recut once the
        // size rests, so until then the sprites run ahead of the cut by the
        // gap between the live setting and the scale the scene was cut at.
        magnify: Math.max(0.05, inputs.scale()) / scene.chipScale,
        rotation: view.rotation,
        // A pile cannot travel further than its own cell, so the standard
        // cell's drag is exactly right for it.
        pan: view.pan,
        sprites,
        glasses,
      });
    },

    listen(): ChamberSound {
      readImpacts(scene.shards, heard, impacts);

      // Dry glass in a dry cell: knocks, and no fluid to wash about.
      return { impacts, wash: 0 };
    },
  };
}

/** Whether two lists of loaded glass are the same sets in the same order. */
function sameGlasses(a: readonly Glass[], b: readonly Glass[]): boolean {
  return a.length === b.length && a.every((glass, at) => glass.skin === b[at]?.skin);
}
