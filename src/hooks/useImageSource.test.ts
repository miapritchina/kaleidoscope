import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useImageSource } from './useImageSource';

let created: string[] = [];
let revoked: string[] = [];
let counter = 0;

/** Fires the load/error handler the hook attached to the pending Image. */
let settle: (outcome: 'load' | 'error') => void = () => undefined;

beforeEach(() => {
  created = [];
  revoked = [];
  counter = 0;

  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => {
      counter += 1;
      const url = `blob:mock/${counter}`;
      created.push(url);
      return url;
    }),
    revokeObjectURL: vi.fn((url: string) => {
      revoked.push(url);
    }),
  });

  // jsdom does not decode images, so drive the callbacks by hand.
  vi.stubGlobal(
    'Image',
    class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      decoding = 'auto';
      alt = '';
      naturalWidth = 640;
      naturalHeight = 480;

      set src(_value: string) {
        settle = (outcome) => {
          if (outcome === 'load') {
            this.onload?.();
          } else {
            this.onerror?.();
          }
        };
      }
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function imageFile(name = 'holiday.png', type = 'image/png') {
  return new File(['pixels'], name, { type });
}

describe('useImageSource', () => {
  it('starts empty', () => {
    const { result } = renderHook(() => useImageSource());

    expect(result.current.image).toBeNull();
    expect(result.current.fileName).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('loads a picked image', async () => {
    const { result } = renderHook(() => useImageSource());

    act(() => {
      result.current.select(imageFile());
    });
    act(() => {
      settle('load');
    });

    await waitFor(() => {
      expect(result.current.image).not.toBeNull();
    });
    expect(result.current.fileName).toBe('holiday.png');
  });

  it('rejects a file that is not an image, without touching the URL store', () => {
    const { result } = renderHook(() => useImageSource());

    act(() => {
      result.current.select(new File(['x'], 'notes.txt', { type: 'text/plain' }));
    });

    expect(result.current.error).toBe('notes.txt is not an image.');
    expect(result.current.image).toBeNull();
    expect(created).toHaveLength(0);
  });

  it('reports a file it cannot decode', async () => {
    const { result } = renderHook(() => useImageSource());

    act(() => {
      result.current.select(imageFile('broken.png'));
    });
    act(() => {
      settle('error');
    });

    await waitFor(() => {
      expect(result.current.error).toBe('Could not decode broken.png.');
    });
    expect(revoked).toEqual(created);
  });

  it('revokes the previous blob when a new photo replaces it', async () => {
    const { result } = renderHook(() => useImageSource());

    act(() => {
      result.current.select(imageFile('first.png'));
    });
    act(() => {
      settle('load');
    });
    await waitFor(() => {
      expect(result.current.fileName).toBe('first.png');
    });

    act(() => {
      result.current.select(imageFile('second.png'));
    });
    act(() => {
      settle('load');
    });

    await waitFor(() => {
      expect(result.current.fileName).toBe('second.png');
    });
    expect(revoked).toEqual([created[0]]);
  });

  it('ignores a stale decode that finishes after a newer pick', async () => {
    const { result } = renderHook(() => useImageSource());

    act(() => {
      result.current.select(imageFile('slow.png'));
    });
    const finishSlow = settle;

    act(() => {
      result.current.select(imageFile('fast.png'));
    });
    act(() => {
      settle('load');
    });
    await waitFor(() => {
      expect(result.current.fileName).toBe('fast.png');
    });

    act(() => {
      finishSlow('load');
    });

    expect(result.current.fileName).toBe('fast.png');
  });

  it('clears and releases on demand', async () => {
    const { result } = renderHook(() => useImageSource());

    act(() => {
      result.current.select(imageFile());
    });
    act(() => {
      settle('load');
    });
    await waitFor(() => {
      expect(result.current.image).not.toBeNull();
    });

    act(() => {
      result.current.clear();
    });

    expect(result.current.image).toBeNull();
    expect(result.current.fileName).toBeNull();
    expect(revoked).toEqual(created);
  });

  it('releases the blob on unmount', async () => {
    const { result, unmount } = renderHook(() => useImageSource());

    act(() => {
      result.current.select(imageFile());
    });
    act(() => {
      settle('load');
    });
    await waitFor(() => {
      expect(result.current.image).not.toBeNull();
    });

    unmount();

    expect(revoked).toEqual(created);
  });
});
