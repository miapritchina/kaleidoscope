/**
 * Noticing that the instrument has been shaken.
 *
 * A real kaleidoscope gets shaken. It is the thing a hand does with one without
 * being told to, and what it does to the glass is not a tip or a turn — it
 * throws the whole pile up and lets it come down somewhere else entirely. That
 * is a new arrangement, which here is a new seed.
 */

/** One reading of the accelerometer, in metres per second squared. */
export interface Motion {
  x: number;
  y: number;
  z: number;
}

/**
 * How hard the reading has to change between samples to count towards a shake.
 *
 * The change between samples rather than the reading itself, because the
 * reading includes gravity: a phone lying still on a table reads about 9.8 and
 * a phone held still in a hand reads about 9.8 in some other direction. What a
 * shake looks like is that number moving, quickly and repeatedly.
 *
 * High enough that walking with the phone, or setting it down, does not reach
 * it; low enough that a deliberate flick of the wrist does.
 */
const JOLT = 12;

/**
 * How many jolts, inside {@link WINDOW}, make a shake rather than a knock.
 *
 * A phone set down hard is one spike, which is two jolts — into the table and
 * out of it — so two is not enough to tell them apart. A deliberate shake is
 * several reversals a second and clears this in the first half of it.
 */
const JOLTS = 4;

/** Milliseconds the jolts have to fall inside. */
const WINDOW = 700;

/**
 * Milliseconds of quiet after a shake before another one counts.
 *
 * A shake is several seconds of movement and a hand does not stop cleanly, so
 * without this one waggle reseeds the chamber a dozen times over and the figure
 * never settles long enough to be seen.
 */
const REST = 1200;

export interface ShakeDetector {
  /**
   * Feeds in a reading. True when this one completes a shake.
   *
   * @param at Milliseconds on any steady clock. Passed in rather than read here
   *   so the whole thing stays a function of its arguments.
   */
  push: (motion: Motion, at: number) => boolean;
}

export function createShakeDetector(): ShakeDetector {
  let previous: Motion | null = null;
  let jolts: number[] = [];
  let last = Number.NEGATIVE_INFINITY;

  return {
    push(motion, at) {
      const before = previous;
      previous = motion;

      if (!before || !Number.isFinite(at)) {
        return false;
      }

      const change = Math.hypot(motion.x - before.x, motion.y - before.y, motion.z - before.z);

      if (change < JOLT) {
        return false;
      }

      jolts = [...jolts.filter((when) => at - when < WINDOW), at];

      if (jolts.length < JOLTS || at - last < REST) {
        return false;
      }

      last = at;
      jolts = [];

      return true;
    },
  };
}

/** Reads a device motion event, or `null` if it carries no acceleration. */
export function motionOf(event: DeviceMotionEvent): Motion | null {
  // `acceleration` has gravity taken out and is the better reading, but plenty
  // of devices only ever populate the other one. Either works here, since what
  // is measured is the change between samples and a constant drops out of that.
  const reading = event.acceleration ?? event.accelerationIncludingGravity;

  if (!reading) {
    return null;
  }

  const { x, y, z } = reading;

  if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number') {
    return null;
  }

  return { x, y, z };
}
