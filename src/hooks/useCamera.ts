import { useEffect, useState } from 'react';

import type { CameraFacing } from '../lib/camera';

export type CameraStatus = 'idle' | 'starting' | 'active' | 'denied' | 'unavailable' | 'error';

export interface Camera {
  status: CameraStatus;
  /** Human-readable detail for the failure states. */
  message: string | null;
}

const UNSUPPORTED_MESSAGE =
  'This browser will not share a camera with the page. A secure (https) connection is required.';

/**
 * Binds the webcam to a video element while `active` is true.
 *
 * The stream is stopped and released whenever this turns off or the component
 * unmounts — leaving tracks running keeps the camera light on, which users
 * rightly read as the page still watching them.
 *
 * The element is passed in rather than created here: Safari will not play a
 * detached video, so it has to be in the document (visually hidden is fine),
 * which makes it the caller's to own.
 *
 * @param facing Which camera to ask for. A preference, not a requirement: a
 *   laptop with only a front camera still gets that one when the rear is asked
 *   for, whereas `{ exact: ... }` would fail outright.
 */
export function useCamera(
  active: boolean,
  video: HTMLVideoElement | null,
  facing: CameraFacing = 'environment',
): Camera {
  // Only the outcome of a request lives in state. `idle`, `starting` and the
  // unsupported case are derived below, which keeps this hook from having to
  // write state during the effect that starts the stream.
  const [outcome, setOutcome] = useState<Camera | null>(null);
  const [lastVideo, setLastVideo] = useState(video);
  const [lastActive, setLastActive] = useState(active);
  const [lastFacing, setLastFacing] = useState(facing);

  // A restart discards the previous attempt's verdict, so a denial does not
  // linger over the next try.
  if (lastVideo !== video || lastActive !== active || lastFacing !== facing) {
    setLastVideo(video);
    setLastActive(active);
    setLastFacing(facing);
    setOutcome(null);
  }

  const supported = isCameraSupported();

  useEffect(() => {
    if (!active || !video || !supported) {
      return;
    }

    let stream: MediaStream | null = null;
    let cancelled = false;
    // Read through a function: cleanup can flip this while `play()` is awaited,
    // which narrowing on the bare variable would not account for.
    const isCancelled = () => cancelled;

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: facing }, audio: false })
      .then(async (result) => {
        // Toggled off, or swapped elements, while the prompt was open.
        if (isCancelled()) {
          stopStream(result);
          return;
        }

        stream = result;
        video.srcObject = result;

        try {
          await video.play();
        } catch {
          // Autoplay refusals still leave a usable stream in most browsers, and
          // the frame loop skips drawing until there is data either way.
        }

        if (!isCancelled()) {
          setOutcome({ status: 'active', message: null });
        }
      })
      .catch((cause: unknown) => {
        if (!isCancelled()) {
          setOutcome(describeFailure(cause));
        }
      });

    return () => {
      cancelled = true;
      stopStream(stream);
      video.srcObject = null;
    };
  }, [active, video, supported, facing]);

  if (!active || !video) {
    return { status: 'idle', message: null };
  }

  if (!supported) {
    return { status: 'unavailable', message: UNSUPPORTED_MESSAGE };
  }

  return outcome ?? { status: 'starting', message: null };
}

/** `mediaDevices` is absent outside a secure context, whatever the types say. */
function isCameraSupported(): boolean {
  const devices = navigator.mediaDevices as MediaDevices | undefined;

  return typeof devices?.getUserMedia === 'function';
}

function describeFailure(cause: unknown): Camera {
  const name = cause instanceof DOMException ? cause.name : '';

  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return {
      status: 'denied',
      message: 'Camera access was blocked. Allow it in your browser, then try again.',
    };
  }

  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return { status: 'unavailable', message: 'No camera was found on this device.' };
  }

  return {
    status: 'error',
    message: cause instanceof Error ? cause.message : 'The camera could not be started.',
  };
}

function stopStream(stream: MediaStream | null): void {
  for (const track of stream?.getTracks() ?? []) {
    track.stop();
  }
}
