import type { ChamberUpdate } from './physics';
import type { Shard } from './scene';

/**
 * Which solver the dry chamber runs on.
 *
 * The classic solver in `lib/physics.ts` is the instrument as tuned; the
 * Rapier spike in `lib/physicsRapier.ts` is an experiment being measured
 * against it (see RESEARCH.md, phase 6). This module is the seam between
 * them: the scene asks it for an override every frame, and gets one only
 * after the spike has been explicitly asked for *and* its WASM has loaded.
 *
 * The spike is behind a dynamic import so that nobody who has not asked for
 * it downloads a physics engine: Vite splits `physicsRapier.ts` and the
 * `@dimforge/rapier2d-compat` module it imports into their own chunk, and the
 * main bundle carries only this file's few lines.
 */
export type SolverStep = (shards: Shard[], update: ChamberUpdate) => void;

let override: SolverStep | null = null;

/** The active override, or null for the classic solver. Read every frame. */
export function chamberOverride(): SolverStep | null {
  return override;
}

/**
 * Loads the Rapier spike and switches the chamber onto it.
 *
 * Resolves false — leaving the classic solver in place — where the module or
 * its WASM cannot load, so asking for the spike can never cost anyone the
 * chamber they had.
 */
export async function adoptRapierChamber(): Promise<boolean> {
  try {
    const spike = await import('./physicsRapier');

    await spike.initRapier();
    override = spike.updateChamberRapier;

    return true;
  } catch {
    return false;
  }
}

/** Back to the classic solver. For tests, and for measuring one against the other. */
export function dropChamberOverride(): void {
  override = null;
}
