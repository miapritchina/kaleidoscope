import type { Chamber } from './chamber';
import { createGlassChamber } from './glassChamber';
import type { MediaElement } from './media';
import { createMediaChamber } from './mediaChamber';
import { createSubstanceChamber } from './substanceChamber';
import type { Settings, SourceId, SubstanceId } from './settings';

/**
 * The chambers this instrument has, and the one line that picks between them.
 *
 * Everything else in the program is written against `Chamber` and does not
 * know this file exists. That is the point: the switch below is the *whole* of
 * what the app knows about which chamber is which, so a new one costs a file
 * and a case — see `lib/mediaChamber.ts` for what a file has to contain.
 */

/**
 * What a chamber is built from, and what it takes to rebuild it.
 *
 * Only the settled things are here. A chamber is rebuilt when one of these
 * changes, because each of them is geometry: a bigger piece displaces its
 * neighbours and settles into a different pile, and no amount of drawing the
 * old pile differently will produce the new one. Everything that can be
 * answered by drawing — the magnification, the thickness of the fluid, which
 * pictures are loaded — is read live through {@link ChamberInputs} instead, and
 * changing it does not cost a rebuild.
 */
export interface ChamberCut {
  /** Which chamber to build. */
  source: SourceId;
  /** The seed the contents are laid out from. */
  seed: string;
  /** How many pieces of glass, for a chamber that holds glass. */
  shards: number;
  /** Multiplies every piece's size. */
  scale: number;
  /** How far the piece sizes spread, 0 for one size to 1 for the widest. */
  variety: number;
  /** Which substance, for a chamber that holds one. */
  substance: SubstanceId;
  /** How much of it there is. */
  amount: number;
}

/** Everything a chamber reads fresh rather than being rebuilt for. */
export interface ChamberInputs {
  /** The live settings. A function: the chamber outlives any one of them. */
  settings: () => Settings;
  /** The photograph or camera frame, for a chamber that shows one. */
  media: () => MediaElement | null;
  /** The pictures the glass is cut out of. */
  skins: () => readonly MediaElement[];
  /** How far the instrument is being held over, in radians. */
  tilt: () => number;
}

/** The settled part of the settings: what a rebuild actually depends on. */
export function chamberCut(settings: Settings): ChamberCut {
  return {
    source: settings.source,
    seed: settings.seed,
    shards: settings.shards,
    scale: settings.sourceScale,
    variety: settings.variety,
    substance: settings.substance,
    amount: settings.amount,
  };
}

/** Whether two cuts describe the same chamber, so nothing need be rebuilt. */
export function sameCut(a: ChamberCut, b: ChamberCut): boolean {
  return (
    a.source === b.source &&
    a.seed === b.seed &&
    a.shards === b.shards &&
    a.scale === b.scale &&
    a.variety === b.variety &&
    a.substance === b.substance &&
    a.amount === b.amount
  );
}

/**
 * Whether a change of cut is worth making the viewer wait for.
 *
 * Switching tabs or substances is not a drag and should hand back the other
 * instrument at once. Dragging a slider asks for a rebuild on every pointer
 * move, and building a chamber settles a pile of a hundred and fifty pieces —
 * so those are held back until the hand comes to rest.
 */
export function isSameInstrument(a: ChamberCut, b: ChamberCut): boolean {
  return a.source === b.source && a.substance === b.substance;
}

/** Builds whichever chamber the settings are asking for. */
export function createChamber(cut: ChamberCut, inputs: ChamberInputs): Chamber {
  switch (cut.source) {
    case 'objects':
      return createGlassChamber(
        { seed: cut.seed, count: cut.shards, scale: cut.scale, variety: cut.variety },
        { skins: inputs.skins, scale: () => inputs.settings().sourceScale },
      );
    case 'liquid':
      return createSubstanceChamber(
        {
          seed: cut.seed,
          substance: cut.substance,
          amount: cut.amount,
          scale: cut.scale,
        },
        { thickness: () => inputs.settings().thickness, tilt: inputs.tilt },
      );
    case 'image':
    case 'camera':
      return createMediaChamber({
        media: inputs.media,
        zoom: () => inputs.settings().sourceScale,
      });
  }
}
