import { describe, expect, it, vi } from 'vitest';

import { Compositor } from './compositor';

/**
 * What can be checked without a GPU, which is not the picture.
 *
 * Nothing here draws. jsdom has no WebGL at all, so these tests are about the
 * one thing that has to hold in an environment like that: the compositor
 * refuses to build, quietly and without throwing, and the body's 2D path
 * carries the frame. `renderer.test.ts` is what proves the picture still
 * appears when it does; the shader's own output is checked in a real browser,
 * because there is nowhere else it can be.
 */
describe('Compositor', () => {
  it('refuses to build where there is no WebGL2', () => {
    expect(Compositor.create()).toBeNull();
  });

  it('does not even ask for a context when the type is missing', () => {
    const getContext = vi.fn();

    Compositor.create(() => ({ getContext }) as unknown as HTMLCanvasElement);

    // jsdom has no WebGL2RenderingContext, so the class is the cheap thing to
    // test first — and asking anyway makes jsdom log that it is not implemented.
    expect(getContext).not.toHaveBeenCalled();
  });

  it('survives a canvas it cannot make', () => {
    expect(
      Compositor.create(() => {
        throw new Error('no surfaces left');
      }),
    ).toBeNull();
  });
});
