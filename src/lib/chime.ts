import type { Shard } from './scene';

/**
 * The sound of the instrument: glass on glass, and fluid on the move.
 *
 * A kaleidoscope is not silent in the hand. The chamber ticks and rustles as
 * the pile shifts, and each of those sounds is a collision — so that is what
 * is synthesised, from the collisions the simulation is already computing,
 * rather than from a loop of "kaleidoscope ambience" that would repeat and
 * have nothing to do with what is on screen. A clink is a burst of ringing at
 * a pitch set by the piece's size — small glass rings high, the physics of
 * any struck object — with strength set by how hard the impulse was, so an
 * avalanche is a rush of ticks and a settling pile is one or two.
 *
 * Everything is synthesised on a `AudioContext`: two inharmonic partials per
 * clink (glass is not a tuned bar; its overtones do not land on harmonics)
 * with fast exponential decay, plus a filtered-noise wash for the liquid
 * cell, its level following how fast the fluid is actually swirling. There
 * are no samples to load and nothing to loop.
 *
 * Browsers gate audio behind a user gesture, deliberately, so this is built
 * only when the sound setting is switched on — the switch is the gesture —
 * and disposed when it is switched off. Where there is no AudioContext (an
 * old browser, a test) `createChime` answers null and the caller carries on
 * silent.
 */

export interface Chime {
  /** One glass tick. Strength 0 to 1; size in cell units picks the pitch. */
  clink(strength: number, size: number): void;
  /** The fluid wash's target level, 0 to 1. Smoothed inside. */
  wash(level: number): void;
  /** Silences and releases everything. */
  dispose(): void;
}

/** Most clinks a second. A pile is a rustle, not a machine gun. */
const MOST_CLINKS_PER_SECOND = 9;

/** Master level. Quiet: this is an instrument in a hand, not a sound effect. */
const LEVEL = 0.5;

/**
 * A piece's ring, in hertz, from its size in cell units.
 *
 * Pitch falls as size grows — a struck object's modes scale inversely with
 * its dimensions — anchored so the chamber's normal piece rings near the top
 * of a wine-glass tap and bounded to keep every piece audible on a phone
 * speaker.
 */
export function pitchOf(size: number): number {
  const normal = 0.08;
  const anchored = 1500 * Math.pow(normal / Math.max(0.01, size), 0.7);

  return Math.min(3800, Math.max(500, anchored));
}

/** Builds the sound, or answers null where there is no audio to be had. */
export function createChime(context?: AudioContext): Chime | null {
  const ctx = context ?? (typeof AudioContext !== 'undefined' ? new AudioContext() : null);

  if (!ctx) {
    return null;
  }

  // Everything funnels through one compressor: an avalanche of clinks sums
  // well past full scale, and clipping reads as a broken speaker.
  const out = ctx.createDynamicsCompressor();
  const master = ctx.createGain();

  master.gain.value = LEVEL;
  out.connect(master);
  master.connect(ctx.destination);

  // The wash: looped noise through a low pass, silent until asked for.
  const washGain = ctx.createGain();
  const washFilter = ctx.createBiquadFilter();
  const washSource = ctx.createBufferSource();
  const seconds = 2;
  const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const samples = buffer.getChannelData(0);

  for (let i = 0; i < samples.length; i += 1) {
    samples[i] = Math.random() * 2 - 1;
  }

  washGain.gain.value = 0;
  washFilter.type = 'lowpass';
  washFilter.frequency.value = 420;
  washFilter.Q.value = 0.4;
  washSource.buffer = buffer;
  washSource.loop = true;
  washSource.connect(washFilter);
  washFilter.connect(washGain);
  washGain.connect(out);
  washSource.start();

  let lastClink = 0;
  let disposed = false;

  return {
    clink(strength, size) {
      if (disposed) {
        return;
      }

      const now = ctx.currentTime;

      if (now - lastClink < 1 / MOST_CLINKS_PER_SECOND) {
        return;
      }

      lastClink = now;

      const gain = ctx.createGain();
      const loud = Math.min(1, Math.max(0, strength)) * 0.5;
      const ring = pitchOf(size);
      // Struck glass decays fast, and harder hits ring a hair longer.
      const decay = 0.06 + 0.1 * loud;

      gain.gain.setValueAtTime(loud, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + decay * 4);
      gain.connect(out);

      // Two partials, deliberately inharmonic: glass is not a tuned bar, and
      // 2.32 is far enough from any harmonic to read as material rather than
      // as a note. A whisper of detune keeps two ticks from phasing.
      for (const [ratio, share] of [
        [1, 1],
        [2.32, 0.4],
      ] as const) {
        const partial = ctx.createOscillator();
        const voice = ctx.createGain();

        partial.type = 'sine';
        partial.frequency.value = ring * ratio * (1 + (Math.random() - 0.5) * 0.02);
        voice.gain.value = share;
        partial.connect(voice);
        voice.connect(gain);
        partial.start(now);
        partial.stop(now + decay * 4 + 0.05);
      }
    },

    wash(level) {
      if (disposed) {
        return;
      }

      // A time constant rather than a jump, so the wash swells and subsides
      // the way the fluid it is following does.
      washGain.gain.setTargetAtTime(Math.min(1, Math.max(0, level)) * 0.25, ctx.currentTime, 0.25);
    },

    dispose() {
      if (disposed) {
        return;
      }

      disposed = true;
      washSource.stop();
      washSource.disconnect();
      washFilter.disconnect();
      washGain.disconnect();
      out.disconnect();
      master.disconnect();
      void ctx.close();
    },
  };
}

/** One collision worth hearing: how hard, and how big the glass was. */
export interface Impact {
  strength: number;
  size: number;
}

/**
 * Reads this frame's collisions off the glass, by what the solver already
 * did to it.
 *
 * The chamber does not report contacts, and does not need to: a collision
 * *is* a sudden change of a piece's velocity, so comparing each piece's
 * velocity with the frame before finds every hit whichever solver ran —
 * classic or Rapier — with no hooks into either. Impulse is mass times the
 * change, so a boulder's dull knock and a grain's tick come out at their own
 * strengths. Gravity's steady pull changes velocity too, which is why there
 * is a floor under what counts.
 *
 * @param shards The glass, after this frame's update.
 * @param previous Scratch owned by the caller: `vx, vy` pairs from last
 *   frame, resized here as needed. Pass the same array every frame.
 * @param into Where the loudest impacts land, strongest first.
 * @param most How many to report.
 */
export function readImpacts(
  shards: readonly Shard[],
  previous: { velocities: Float32Array },
  into: Impact[],
  most = 3,
): void {
  into.length = 0;

  const wanted = shards.length * 2;

  if (previous.velocities.length !== wanted) {
    previous.velocities = new Float32Array(wanted);

    for (let i = 0; i < shards.length; i += 1) {
      previous.velocities[i * 2] = shards[i]!.vx;
      previous.velocities[i * 2 + 1] = shards[i]!.vy;
    }

    return;
  }

  for (let i = 0; i < shards.length; i += 1) {
    const shard = shards[i]!;
    const jolt = Math.hypot(
      shard.vx - previous.velocities[i * 2]!,
      shard.vy - previous.velocities[i * 2 + 1]!,
    );

    previous.velocities[i * 2] = shard.vx;
    previous.velocities[i * 2 + 1] = shard.vy;

    // Mass goes with area, so what is heard is the impulse and not the speed.
    const impulse = jolt * shard.shape.bulk * shard.radius * shard.radius;

    // Below this is gravity and jitter, not a hit.
    if (impulse < 0.0016) {
      continue;
    }

    const impact: Impact = { strength: Math.min(1, impulse * 90), size: shard.radius };

    // Kept sorted, strongest first, capped at `most`.
    let at = into.length;

    while (at > 0 && into[at - 1]!.strength < impact.strength) {
      at -= 1;
    }

    into.splice(at, 0, impact);

    if (into.length > most) {
      into.length = most;
    }
  }
}
