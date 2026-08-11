import { useEffect, useState } from 'react';

/**
 * Loads a bundled picture and hands back the element once it has pixels.
 *
 * Only once it has decoded: an `<img>` handed to `drawImage` before that paints
 * nothing, and the renderer would fall back to the drawn shapes for a frame or
 * two and then jump.
 *
 * @param url The picture to load, or `null` for none.
 */
export function useImageUrl(url: string | null): HTMLImageElement | null {
  // The url is kept with the picture so a change of set reads as "nothing yet"
  // straight away, rather than showing the last one until the next has decoded.
  // It also means nothing has to be cleared, so the effect never sets state
  // synchronously and no render cascades from it.
  const [loaded, setLoaded] = useState<{ url: string; image: HTMLImageElement } | null>(null);

  useEffect(() => {
    if (!url) {
      return;
    }

    let live = true;
    const element = new Image();

    // `load` rather than `decode()`: the promise is the nicer of the two, but
    // it is missing in older Safari and in jsdom, and this only has to know
    // that `drawImage` will find pixels.
    const onLoad = () => {
      if (live) {
        setLoaded({ url, image: element });
      }
    };

    element.addEventListener('load', onLoad);
    // A missing or corrupt file is not worth breaking the app over: nothing is
    // set, and the pieces fall back to the drawn shapes.
    element.addEventListener('error', () => undefined);
    // Bundled alongside the app, so same-origin; set anyway, since the cut-out
    // finder reads the pixels back and a tainted canvas cannot be read.
    element.crossOrigin = 'anonymous';
    element.src = url;

    return () => {
      live = false;
      element.removeEventListener('load', onLoad);
    };
  }, [url]);

  return loaded !== null && loaded.url === url ? loaded.image : null;
}
