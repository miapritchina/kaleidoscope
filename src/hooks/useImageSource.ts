import { useCallback, useEffect, useRef, useState } from 'react';

export interface ImageSource {
  /** The decoded image, once it has loaded. */
  image: HTMLImageElement | null;
  /** Name of the chosen file, for display. */
  fileName: string | null;
  error: string | null;
  /** Accepts a picked or dropped file. Rejects anything that is not an image. */
  select: (file: File) => void;
  clear: () => void;
}

/**
 * Loads a user-chosen image.
 *
 * The file never leaves the browser: it is read through an object URL, drawn to
 * a canvas, and released. The URL is revoked whenever it is replaced and on
 * unmount, so picking a dozen photos does not pin a dozen blobs in memory.
 */
export function useImageSource(): ImageSource {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);

  const release = useCallback(() => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  }, []);

  useEffect(() => release, [release]);

  const select = useCallback(
    (file: File) => {
      if (!file.type.startsWith('image/')) {
        setError(`${file.name} is not an image.`);
        return;
      }

      release();
      setError(null);

      const url = URL.createObjectURL(file);
      urlRef.current = url;

      const element = new Image();
      element.decoding = 'async';
      element.alt = '';

      element.onload = () => {
        // A newer pick may have landed while this one decoded.
        if (urlRef.current === url) {
          setImage(element);
          setFileName(file.name);
        }
      };

      element.onerror = () => {
        if (urlRef.current === url) {
          release();
          setImage(null);
          setFileName(null);
          setError(`Could not decode ${file.name}.`);
        }
      };

      element.src = url;
    },
    [release],
  );

  const clear = useCallback(() => {
    release();
    setImage(null);
    setFileName(null);
    setError(null);
  }, [release]);

  return { image, fileName, error, select, clear };
}
