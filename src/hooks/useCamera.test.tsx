import { render, waitFor } from '@testing-library/react';
import { act, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useCamera, type Camera } from './useCamera';

/**
 * The hook hands its ref to a real element, so the tests mount a real
 * component. Calling `ref` from a bare `renderHook` callback would fire a
 * render-phase state update on every pass.
 */
function Harness({ active, expose }: { active: boolean; expose: (camera: Camera) => void }) {
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const camera = useCamera(active, video);
  expose(camera);

  return <video ref={setVideo} />;
}

function renderCamera(active: boolean) {
  let camera!: Camera;
  const view = render(<Harness active={active} expose={(value) => (camera = value)} />);
  const video = view.container.querySelector('video')!;

  return {
    ...view,
    video,
    get camera() {
      return camera;
    },
    setActive(next: boolean) {
      view.rerender(<Harness active={next} expose={(value) => (camera = value)} />);
    },
  };
}

function fakeStream() {
  const stop = vi.fn();
  const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;

  return { stop, stream };
}

function mockGetUserMedia() {
  return vi.mocked(navigator.mediaDevices.getUserMedia);
}

beforeEach(() => {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn() },
  });
  // jsdom does not implement media playback.
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useCamera', () => {
  it('stays idle and asks for nothing while inactive', () => {
    const view = renderCamera(false);

    expect(view.camera.status).toBe('idle');
    expect(mockGetUserMedia()).not.toHaveBeenCalled();
  });

  it('requests video only, never audio', async () => {
    mockGetUserMedia().mockResolvedValue(fakeStream().stream);

    const view = renderCamera(true);

    await waitFor(() => {
      expect(view.camera.status).toBe('active');
    });
    expect(mockGetUserMedia()).toHaveBeenCalledWith({
      video: { facingMode: 'user' },
      audio: false,
    });
  });

  it('attaches the stream to the element and plays it', async () => {
    const { stream } = fakeStream();
    mockGetUserMedia().mockResolvedValue(stream);

    const view = renderCamera(true);

    await waitFor(() => {
      expect(view.camera.status).toBe('active');
    });
    expect(view.video.srcObject).toBe(stream);
    expect(view.video.play).toHaveBeenCalled();
  });

  it('stops every track when switched off, so the camera light goes out', async () => {
    const { stop, stream } = fakeStream();
    mockGetUserMedia().mockResolvedValue(stream);

    const view = renderCamera(true);
    await waitFor(() => {
      expect(view.camera.status).toBe('active');
    });

    view.setActive(false);

    expect(stop).toHaveBeenCalledOnce();
    expect(view.video.srcObject).toBeNull();
    expect(view.camera.status).toBe('idle');
  });

  it('stops the stream on unmount', async () => {
    const { stop, stream } = fakeStream();
    mockGetUserMedia().mockResolvedValue(stream);

    const view = renderCamera(true);
    await waitFor(() => {
      expect(view.camera.status).toBe('active');
    });

    view.unmount();

    expect(stop).toHaveBeenCalledOnce();
  });

  it('releases a stream that arrives after being switched off', async () => {
    const { stop, stream } = fakeStream();
    let resolve: (value: MediaStream) => void = () => undefined;
    mockGetUserMedia().mockReturnValue(
      new Promise<MediaStream>((r) => {
        resolve = r;
      }),
    );

    const view = renderCamera(true);
    view.setActive(false);

    // The permission prompt resolves only after the user gave up on it.
    await act(async () => {
      resolve(stream);
      await Promise.resolve();
    });

    expect(stop).toHaveBeenCalledOnce();
  });

  it('reports a blocked permission', async () => {
    mockGetUserMedia().mockRejectedValue(new DOMException('denied', 'NotAllowedError'));

    const view = renderCamera(true);

    await waitFor(() => {
      expect(view.camera.status).toBe('denied');
    });
    expect(view.camera.message).toMatch(/blocked/i);
  });

  it('reports a missing camera', async () => {
    mockGetUserMedia().mockRejectedValue(new DOMException('none', 'NotFoundError'));

    const view = renderCamera(true);

    await waitFor(() => {
      expect(view.camera.status).toBe('unavailable');
    });
    expect(view.camera.message).toMatch(/no camera/i);
  });

  it('reports an unexpected failure without crashing', async () => {
    mockGetUserMedia().mockRejectedValue(new Error('camera on fire'));

    const view = renderCamera(true);

    await waitFor(() => {
      expect(view.camera.status).toBe('error');
    });
    expect(view.camera.message).toBe('camera on fire');
  });

  it('reports an insecure or unsupported context', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });

    const view = renderCamera(true);

    await waitFor(() => {
      expect(view.camera.status).toBe('unavailable');
    });
    expect(view.camera.message).toMatch(/https/i);
  });

  it('survives a play() rejection, which autoplay rules can cause', async () => {
    mockGetUserMedia().mockResolvedValue(fakeStream().stream);
    HTMLMediaElement.prototype.play = vi
      .fn()
      .mockRejectedValue(new DOMException('blocked', 'NotAllowedError'));

    const view = renderCamera(true);

    await waitFor(() => {
      expect(view.camera.status).toBe('active');
    });
  });
});
