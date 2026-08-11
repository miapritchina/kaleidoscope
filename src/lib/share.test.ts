import { describe, expect, it, vi } from 'vitest';

import { sharePicture, type ShareDeps } from './share';

const file = () => new File(['x'], 'pattern.png', { type: 'image/png' });

function deps(overrides: Partial<ShareDeps> = {}) {
  const link = { href: '', download: '', click: vi.fn() } as unknown as HTMLAnchorElement;

  const base: ShareDeps = {
    navigator: { canShare: vi.fn(() => true), share: vi.fn(() => Promise.resolve()) },
    createObjectUrl: vi.fn(() => 'blob:pattern'),
    revokeObjectUrl: vi.fn(),
    createLink: vi.fn(() => link),
    ...overrides,
  };

  return { ...base, link };
}

describe('sharePicture', () => {
  // The sheet is what offers "Save Image", which is what puts it in the photo
  // library. A download lands in Files, which is not where a picture belongs.
  it('offers it to the share sheet where there is one', async () => {
    const it_ = deps();

    await expect(sharePicture(file(), it_)).resolves.toBe('shared');
    expect(it_.navigator.share).toHaveBeenCalledOnce();
    expect(it_.createLink).not.toHaveBeenCalled();
  });

  it('saves it where there is no sheet', async () => {
    const it_ = deps({ navigator: {} as Navigator });

    await expect(sharePicture(file(), it_)).resolves.toBe('saved');
    expect(it_.link.download).toBe('pattern.png');
    expect(it_.link.click).toHaveBeenCalledOnce();
  });

  it('saves it when the sheet will not take a file', async () => {
    const it_ = deps({
      navigator: { canShare: vi.fn(() => false), share: vi.fn(() => Promise.resolve()) },
    });

    await expect(sharePicture(file(), it_)).resolves.toBe('saved');
    expect(it_.navigator.share).not.toHaveBeenCalled();
  });

  // Someone who dismissed the sheet said no. Downloading it anyway would be
  // doing the thing they just declined, behind their back.
  it('does nothing at all when the sheet is dismissed', async () => {
    const it_ = deps({
      navigator: {
        canShare: vi.fn(() => true),
        share: vi.fn(() =>
          Promise.reject(Object.assign(new Error('cancelled'), { name: 'AbortError' })),
        ),
      } as unknown as Navigator,
    });

    await expect(sharePicture(file(), it_)).resolves.toBe('dismissed');
    expect(it_.createLink).not.toHaveBeenCalled();
  });

  // A browser that claims it can share and then fails is worth falling back
  // for, rather than leaving them with nothing.
  it('falls back to saving when sharing fails for any other reason', async () => {
    const it_ = deps({
      navigator: {
        canShare: vi.fn(() => true),
        share: vi.fn(() => Promise.reject(new Error('no transport'))),
      } as unknown as Navigator,
    });

    await expect(sharePicture(file(), it_)).resolves.toBe('saved');
    expect(it_.link.click).toHaveBeenCalledOnce();
  });

  // Let go of, but not before the browser has taken what it needs: revoking
  // inside the same task has been known to leave one holding a handle to
  // nothing, and it leaves the link's own `href` pointing at a dead url.
  it('lets go of the object url, on a later turn', async () => {
    const it_ = deps({ navigator: {} as Navigator });

    await sharePicture(file(), it_);
    expect(it_.revokeObjectUrl).not.toHaveBeenCalled();

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(it_.revokeObjectUrl).toHaveBeenCalledWith('blob:pattern');
  });

  it('reports a save that could not happen rather than claiming one', async () => {
    const it_ = deps({
      navigator: {} as Navigator,
      createLink: () =>
        ({
          click: () => {
            throw new Error('blocked');
          },
        }) as unknown as HTMLAnchorElement,
    });

    await expect(sharePicture(file(), it_)).resolves.toBe('failed');
    // Straight away in this case: there is no download holding on to it.
    expect(it_.revokeObjectUrl).toHaveBeenCalledOnce();
  });
});
