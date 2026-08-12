import { useEffect, useRef } from 'react';

import { createShakeDetector, motionOf } from '../lib/shake';

interface MotionPermission {
  requestPermission?: () => Promise<string>;
}

/**
 * Calls back when the phone is shaken.
 *
 * No toggle of its own and nothing to switch on: shaking a kaleidoscope is what
 * a hand does with one, and a setting for it would be a setting for something
 * nobody would go looking for.
 *
 * iOS gates the accelerometer behind a permission that has to be asked for from
 * a user gesture, and there is no gesture here to hang that on. Rather than
 * putting a prompt in front of someone who only wanted to look at the picture,
 * this asks for nothing: where the reading is free — every other browser — it
 * works straight away, and on iOS it starts working the moment **Real gravity**
 * is switched on, since Safari's prompt covers motion and orientation together.
 */
export function useShake(onShake: () => void, permitted: boolean): void {
  // Kept in a ref so a new callback each render does not tear the listener down
  // and put it back, which on iOS would mean asking again.
  const latest = useRef(onShake);

  useEffect(() => {
    latest.current = onShake;
  }, [onShake]);

  useEffect(() => {
    if (typeof window === 'undefined' || !('DeviceMotionEvent' in window)) {
      return;
    }

    const gated =
      typeof (window.DeviceMotionEvent as unknown as MotionPermission).requestPermission ===
      'function';

    // Nothing will arrive until the prompt has been answered, and the prompt
    // belongs to the toggle rather than to this.
    if (gated && !permitted) {
      return;
    }

    const detector = createShakeDetector();

    const onMotion = (event: DeviceMotionEvent) => {
      const motion = motionOf(event);

      if (motion && detector.push(motion, event.timeStamp)) {
        latest.current();
      }
    };

    window.addEventListener('devicemotion', onMotion);

    return () => {
      window.removeEventListener('devicemotion', onMotion);
    };
  }, [permitted]);
}
