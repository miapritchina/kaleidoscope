import { useEffect, useRef, useState } from 'react';

import {
  screenAngleFromOrientation,
  screenGravity,
  smoothAngle,
  TILT_FLAT,
  tiltStrength,
  unwrapAngle,
} from '../lib/tilt';

export type TiltStatus = 'unsupported' | 'idle' | 'asking' | 'active' | 'denied';

export interface DeviceTilt {
  /**
   * How far the phone has been turned in its own plane, in radians, or `null`
   * when nothing is listening. Gravity is rotated by it; nothing on screen is.
   * A ref, because the animation loop reads it every frame and re-rendering the
   * app for a sensor reading would be pointless.
   */
  angleRef: { current: number | null };
  status: TiltStatus;
}

interface OrientationPermission {
  requestPermission?: () => Promise<string>;
}

/**
 * The phone's own rotation, for pointing gravity the way the world does.
 *
 * iOS will not report orientation until it has been asked for from a user
 * gesture, so the flag this takes has to be raised by a tap — which the toggle
 * in the panel is. Refused, it says so and stays refused; nothing here asks
 * twice.
 */
export function useDeviceTilt(enabled: boolean): DeviceTilt {
  const angleRef = useRef<number | null>(null);
  // Both are set from a callback rather than from the body of an effect, so
  // nothing here cascades a render. Everything the caller sees is derived from
  // them below.
  const [denied, setDenied] = useState(false);
  const [reading, setReading] = useState(false);

  const supported = typeof window !== 'undefined' && 'DeviceOrientationEvent' in window;

  useEffect(() => {
    if (!enabled || !supported) {
      angleRef.current = null;
      return;
    }

    let live = true;

    const onOrientation = (event: DeviceOrientationEvent) => {
      if (event.beta === null || event.gamma === null) {
        return;
      }

      // Laid flat, down points through the glass and has no direction on
      // screen. Dropped rather than smoothed: a phone put down on a table
      // should leave the pile where it is, not stir it with whichever way the
      // last shake of the hand happened to point.
      if (tiltStrength(screenGravity(event.beta, event.gamma)) < TILT_FLAT) {
        return;
      }

      const held = screenAngleFromOrientation(event.beta, event.gamma);
      const previous = angleRef.current;

      // Unwrapped first, then smoothed: smoothing towards a reading that has
      // just wrapped past half a turn would sweep gravity all the way round
      // through zero, and the pile would slide the wrong way while it did.
      angleRef.current =
        previous === null ? held : smoothAngle(previous, unwrapAngle(previous, held));

      setReading(true);
    };

    const listen = () => {
      window.addEventListener('deviceorientation', onOrientation);
    };

    const ask = (window.DeviceOrientationEvent as unknown as OrientationPermission)
      .requestPermission;

    if (typeof ask === 'function') {
      ask()
        .then((state) => {
          if (!live) {
            return;
          }

          if (state === 'granted') {
            listen();
          } else {
            setDenied(true);
          }
        })
        .catch(() => {
          if (live) {
            setDenied(true);
          }
        });
    } else {
      listen();
    }

    return () => {
      live = false;
      angleRef.current = null;
      setReading(false);
      window.removeEventListener('deviceorientation', onOrientation);
    };
  }, [enabled, supported]);

  return { angleRef, status: statusOf({ supported, enabled, denied, reading }) };
}

function statusOf({
  supported,
  enabled,
  denied,
  reading,
}: {
  supported: boolean;
  enabled: boolean;
  denied: boolean;
  reading: boolean;
}): TiltStatus {
  if (!supported) {
    return 'unsupported';
  }

  if (!enabled) {
    return 'idle';
  }

  if (denied) {
    return 'denied';
  }

  // Switched on and allowed, but nothing has arrived yet: either the permission
  // sheet is up, or the device has not moved since it was granted.
  return reading ? 'active' : 'asking';
}
