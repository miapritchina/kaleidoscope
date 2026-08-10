/**
 * Which way a camera points.
 *
 * Lives here rather than beside the hook that uses it because it is part of the
 * saved settings, and everything under `lib/` has to stay free of React — a
 * settings module that reaches into a hook file drags the whole of React into
 * the plain-TypeScript half of the app.
 *
 * The names are the ones `getUserMedia` uses.
 */
export const CAMERA_FACINGS = ['environment', 'user'] as const;

export type CameraFacing = (typeof CAMERA_FACINGS)[number];

export function isCameraFacing(value: unknown): value is CameraFacing {
  return typeof value === 'string' && (CAMERA_FACINGS as readonly string[]).includes(value);
}
