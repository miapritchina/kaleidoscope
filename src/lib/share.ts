/**
 * Handing a picture to the person who made it.
 *
 * On a phone a download lands in Files, which is not where a picture belongs.
 * The share sheet is what offers "Save Image", and that puts it in the photo
 * library — so the sheet is tried first and a download is the fallback for a
 * browser that has no such thing.
 */

export type ShareOutcome = 'shared' | 'saved' | 'dismissed' | 'failed';

export interface ShareDeps {
  navigator: Pick<Navigator, 'share' | 'canShare'>;
  createObjectUrl: (blob: Blob) => string;
  revokeObjectUrl: (url: string) => void;
  createLink: () => HTMLAnchorElement;
}

function browserDeps(): ShareDeps {
  return {
    navigator,
    createObjectUrl: (blob) => URL.createObjectURL(blob),
    revokeObjectUrl: (url) => {
      URL.revokeObjectURL(url);
    },
    createLink: () => document.createElement('a'),
  };
}

/**
 * Offers a picture to the share sheet, or saves it if there is none.
 *
 * @returns What happened, so the caller can say so — or say nothing, which is
 *   the right answer when the sheet was dismissed. That case is a rejection
 *   rather than a return value, and taking it for a failure would mean
 *   downloading the file behind the back of someone who just said no.
 */
export async function sharePicture(
  file: File,
  deps: ShareDeps = browserDeps(),
): Promise<ShareOutcome> {
  const { navigator: nav } = deps;

  if (typeof nav.canShare === 'function' && nav.canShare({ files: [file] })) {
    try {
      await nav.share({ files: [file] });

      return 'shared';
    } catch (error) {
      if (isDismissal(error)) {
        return 'dismissed';
      }

      // Anything else — a browser that claims to share and then does not — is
      // worth falling back for rather than leaving them with nothing.
    }
  }

  return save(file, deps);
}

function save(file: File, deps: ShareDeps): ShareOutcome {
  const url = deps.createObjectUrl(file);
  // Let go of it on the next turn rather than this one. The download is started
  // by the click, but the url is still the link's `href` until the browser is
  // finished with it, and revoking inside the same task has been known to leave
  // a browser holding a handle to nothing.
  const release = () => {
    deps.revokeObjectUrl(url);
  };

  try {
    const link = deps.createLink();
    link.href = url;
    link.download = file.name;
    link.click();

    setTimeout(release, 0);

    return 'saved';
  } catch {
    release();

    return 'failed';
  }
}

/** Dismissing the sheet rejects with `AbortError`. That is not a failure. */
function isDismissal(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
