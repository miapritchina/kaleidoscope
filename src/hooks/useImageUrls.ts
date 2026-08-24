import { useEffect, useRef, useState } from 'react';

/**
 * Loads several bundled pictures and hands back the ones that have decoded.
 *
 * The chamber can be loaded with more than one object set at once, and each set
 * is a picture of its own. The result keeps the order of the urls asked for and
 * omits any that are not decoded yet, so a set still loading simply is not in
 * the mix until it lands rather than drawing nothing in its place.
 *
 * Once decoded, an element stays cached across changes of the chosen mix, so
 * checking a set off and back on does not fetch it again.
 *
 * @param urls The pictures to load. Order is preserved in the result.
 */
export function useImageUrls(urls: readonly string[]): readonly HTMLImageElement[] {
  const cache = useRef(new Map<string, HTMLImageElement>());
  const [ready, setReady] = useState<readonly HTMLImageElement[]>([]);
  // The urls are a fresh literal on every render, so the effect depends on them
  // joined into one string and reads the list back from that: what matters is
  // the set of pictures by value, not the identity of the array carrying them.
  // A newline cannot occur in a bundled asset url, so it is a safe separator.
  const key = urls.join('\n');

  useEffect(() => {
    let live = true;
    const list = key ? key.split('\n') : [];

    // The decoded pictures, in the order asked for. Set only when it actually
    // differs, so a load that adds nothing new does not cascade a render.
    const settle = () => {
      if (!live) {
        return;
      }

      const loaded = list
        .map((url) => cache.current.get(url))
        .filter((image): image is HTMLImageElement => image != null && image.naturalWidth > 0);

      setReady((was) =>
        was.length === loaded.length && was.every((image, index) => image === loaded[index])
          ? was
          : loaded,
      );
    };

    for (const url of list) {
      if (cache.current.has(url)) {
        continue;
      }

      const image = new Image();
      cache.current.set(url, image);
      // Bundled alongside the app, so same-origin; set anyway, since the
      // cut-out finder reads the pixels back and a tainted canvas cannot be.
      image.crossOrigin = 'anonymous';
      image.addEventListener('load', settle);
      // A missing or corrupt file is not worth breaking the app over: it just
      // never joins the mix.
      image.addEventListener('error', () => undefined);
      image.src = url;
    }

    // Pick up anything already decoded from an earlier mix, then whatever the
    // fresh loads report as they land.
    settle();

    return () => {
      live = false;
    };
  }, [key]);

  return ready;
}
