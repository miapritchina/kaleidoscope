import { useEffect, useRef, useState } from 'react';

import type { DeviceReadings } from '../lib/readings';
import { motionOf } from '../lib/shake';

/**
 * How often the numbers on screen are replaced, in milliseconds.
 *
 * The sensors report at sixty a second and a readout changing that fast cannot
 * be read at all — the digits blur into a grey band. Eight a second is quick
 * enough to follow a hand moving and slow enough to see what it says.
 */
const SHOWN_EVERY = 125;

/**
 * The raw sensor readings, for the debug overlay.
 *
 * Separate from `useDeviceTilt`, which turns the same readings into one angle
 * for gravity and keeps them in a ref because the animation loop wants them
 * every frame. These are for a person to read, so they are state, and they are
 * throttled to a speed a person can read at.
 *
 * Asks for no permission. On iOS nothing arrives until **Real gravity** has
 * been switched on, which is where the prompt lives; the readout says so rather
 * than putting a second prompt in front of anyone.
 */
export function useDeviceReadings(enabled: boolean): DeviceReadings {
  const latest = useRef<DeviceReadings>({ orientation: null, motion: null, supported: false });
  const [shown, setShown] = useState<DeviceReadings>({
    orientation: null,
    motion: null,
    supported: false,
  });

  const supported =
    typeof window !== 'undefined' &&
    ('DeviceOrientationEvent' in window || 'DeviceMotionEvent' in window);

  useEffect(() => {
    if (!enabled || !supported) {
      return;
    }

    latest.current = { ...latest.current, supported: true };

    const onOrientation = (event: DeviceOrientationEvent) => {
      if (event.alpha === null && event.beta === null && event.gamma === null) {
        return;
      }

      latest.current = {
        ...latest.current,
        orientation: { alpha: event.alpha ?? 0, beta: event.beta ?? 0, gamma: event.gamma ?? 0 },
      };
    };

    const onMotion = (event: DeviceMotionEvent) => {
      const motion = motionOf(event);

      if (motion) {
        latest.current = { ...latest.current, motion };
      }
    };

    window.addEventListener('deviceorientation', onOrientation);
    window.addEventListener('devicemotion', onMotion);

    const tick = window.setInterval(() => {
      setShown(latest.current);
    }, SHOWN_EVERY);

    return () => {
      window.clearInterval(tick);
      window.removeEventListener('deviceorientation', onOrientation);
      window.removeEventListener('devicemotion', onMotion);
    };
  }, [enabled, supported]);

  return enabled ? shown : { orientation: null, motion: null, supported };
}
