import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useDeviceTilt } from './useDeviceTilt';

/** Stands in for the sensor event, which jsdom does not have. */
class FakeOrientationEvent extends Event {
  alpha: number | null;
  beta: number | null;
  gamma: number | null;

  constructor(
    type: string,
    init: { alpha?: number | null; beta?: number | null; gamma?: number | null } = {},
  ) {
    super(type);
    this.alpha = init.alpha ?? null;
    this.beta = init.beta ?? null;
    this.gamma = init.gamma ?? null;
  }
}

function installSensor(requestPermission?: () => Promise<string>) {
  const sensor = FakeOrientationEvent as unknown as {
    requestPermission?: () => Promise<string>;
  };

  if (requestPermission) {
    sensor.requestPermission = requestPermission;
  } else {
    delete sensor.requestPermission;
  }

  Object.defineProperty(window, 'DeviceOrientationEvent', {
    configurable: true,
    value: FakeOrientationEvent,
  });
}

function holdUpright() {
  window.dispatchEvent(new FakeOrientationEvent('deviceorientation', { beta: 90, gamma: 0 }));
}

afterEach(() => {
  delete (window as { DeviceOrientationEvent?: unknown }).DeviceOrientationEvent;
});

describe('useDeviceTilt', () => {
  it('listens straight away where no permission is needed', async () => {
    installSensor();

    const { result } = renderHook(() => useDeviceTilt(true));

    act(holdUpright);

    await waitFor(() => {
      expect(result.current.status).toBe('active');
    });
    expect(result.current.angleRef.current).toBeCloseTo(0, 5);
  });

  // iOS refuses even to ask unless the asking happens inside a user gesture,
  // and a fresh open of an installed app with the switch already on has no
  // gesture to offer. That refusal is the question being refused, not the
  // permission being denied — so the hook must not report "denied", and must
  // ask again on the first touch, where iOS grants a previously granted origin
  // without showing anything.
  it('asks again on the first touch when asking without a gesture is refused', async () => {
    const ask = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('needs a user gesture'))
      .mockResolvedValue('granted');
    installSensor(ask);

    const { result } = renderHook(() => useDeviceTilt(true));

    await waitFor(() => {
      expect(ask).toHaveBeenCalledTimes(1);
    });
    expect(result.current.status).toBe('asking');

    act(() => {
      window.dispatchEvent(new Event('pointerdown'));
    });

    await waitFor(() => {
      expect(ask).toHaveBeenCalledTimes(2);
    });

    act(holdUpright);

    await waitFor(() => {
      expect(result.current.status).toBe('active');
    });
  });

  it("takes a person's refusal as final", async () => {
    const ask = vi.fn<() => Promise<string>>().mockResolvedValue('denied');
    installSensor(ask);

    const { result } = renderHook(() => useDeviceTilt(true));

    await waitFor(() => {
      expect(result.current.status).toBe('denied');
    });

    // A refusal from a person is not re-asked on the next touch.
    act(() => {
      window.dispatchEvent(new Event('pointerdown'));
    });

    expect(ask).toHaveBeenCalledTimes(1);
  });

  it('stops asking once switched off, even with a retry armed', async () => {
    const ask = vi.fn<() => Promise<string>>().mockRejectedValue(new Error('needs a gesture'));
    installSensor(ask);

    const { unmount } = renderHook(() => useDeviceTilt(true));

    await waitFor(() => {
      expect(ask).toHaveBeenCalledTimes(1);
    });

    unmount();

    act(() => {
      window.dispatchEvent(new Event('pointerdown'));
    });

    expect(ask).toHaveBeenCalledTimes(1);
  });
});
