import { render, waitFor } from '@testing-library/react';
import { StrictMode, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useImageUrls } from './useImageUrls';

/**
 * A picture that decodes when the test says so, not when a network does.
 *
 * jsdom's own `Image` never loads anything, and the whole of what these tests
 * are about is *when* a picture lands relative to the effect that asked for it.
 */
class TestImage extends EventTarget {
  static made: TestImage[] = [];

  crossOrigin: string | null = null;
  naturalWidth = 0;
  #src = '';

  constructor() {
    super();
    TestImage.made.push(this);
  }

  get src(): string {
    return this.#src;
  }

  set src(value: string) {
    this.#src = value;
  }

  /** The picture arrives. */
  decode(width = 64): void {
    this.naturalWidth = width;
    this.dispatchEvent(new Event('load'));
  }
}

function Harness({
  urls,
  expose,
}: {
  urls: string[];
  expose: (ready: readonly unknown[]) => void;
}) {
  expose(useImageUrls(urls));

  return null;
}

function renderUrls(urls: string[], strict: boolean) {
  let ready: readonly unknown[] = [];
  const tree = <Harness urls={urls} expose={(value) => (ready = value)} />;
  const view = render(strict ? <StrictMode>{tree}</StrictMode> : tree);

  return {
    ...view,
    get ready() {
      return ready;
    },
  };
}

let original: typeof Image;

beforeEach(() => {
  original = globalThis.Image;
  TestImage.made = [];
  globalThis.Image = TestImage as unknown as typeof Image;
});

afterEach(() => {
  globalThis.Image = original;
});

describe('useImageUrls', () => {
  it('hands back a picture that decodes after the effect has been torn down and set up again', async () => {
    // Which is every effect in StrictMode, and any change of the chosen mix.
    // The picture used to land on the first run's listener, whose closure had
    // already been marked dead by its own cleanup, and the caller never heard
    // about it: the chamber sat empty asking to be filled with glass it had
    // already fetched. It was a race — decode against remount — so it looked
    // intermittent, and it emptied the chamber outright when it lost.
    const view = renderUrls(['/glass.webp'], true);

    expect(view.ready).toHaveLength(0);
    expect(TestImage.made).toHaveLength(1);

    TestImage.made[0]!.decode();

    await waitFor(() => {
      expect(view.ready).toHaveLength(1);
    });
  });

  it('fetches each picture once however often the effect runs', () => {
    renderUrls(['/glass.webp'], true);

    expect(TestImage.made).toHaveLength(1);
  });

  it('keeps the order asked for and leaves out what has not decoded', async () => {
    const view = renderUrls(['/a.webp', '/b.webp'], false);

    TestImage.made[1]!.decode();

    await waitFor(() => {
      expect(view.ready).toEqual([TestImage.made[1]]);
    });

    TestImage.made[0]!.decode();

    await waitFor(() => {
      expect(view.ready).toEqual([TestImage.made[0], TestImage.made[1]]);
    });
  });

  it('hears a picture that lands after the mix has changed under it', async () => {
    function Changing({ expose }: { expose: (ready: readonly unknown[]) => void }) {
      const [urls, setUrls] = useState(['/a.webp']);

      expose(useImageUrls(urls));

      return (
        <button
          type="button"
          onClick={() => {
            setUrls(['/a.webp', '/b.webp']);
          }}
        >
          add
        </button>
      );
    }

    let ready: readonly unknown[] = [];
    const view = render(<Changing expose={(value) => (ready = value)} />);

    // A second set is chosen while the first is still in flight, which tears
    // the effect down and sets it up again around a picture nobody has heard
    // from yet.
    view.container.querySelector('button')!.click();

    await waitFor(() => {
      expect(TestImage.made).toHaveLength(2);
    });

    TestImage.made[0]!.decode();

    await waitFor(() => {
      expect(ready).toEqual([TestImage.made[0]]);
    });
  });

  it('stops listening once it is unmounted', () => {
    const view = renderUrls(['/glass.webp'], false);

    view.unmount();

    // Nothing to assert but that this does not throw a state update on an
    // unmounted tree, which is what the `live` flag is for.
    expect(() => {
      TestImage.made[0]!.decode();
    }).not.toThrow();
  });
});
