import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_SETTINGS } from '../lib/settings';
import { Kaleidoscope } from './Kaleidoscope';

// jsdom has no canvas backend, so the renderer cannot start. The component is
// expected to degrade quietly rather than take the page down with it.
afterEach(() => {
  vi.restoreAllMocks();
});

describe('Kaleidoscope', () => {
  it('renders a labelled canvas', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(<Kaleidoscope settings={DEFAULT_SETTINGS} paused />);

    const canvas = screen.getByRole('img');

    expect(canvas.tagName).toBe('CANVAS');
    expect(canvas).toHaveAccessibleName(
      `Kaleidoscope with ${String(DEFAULT_SETTINGS.mirrors)} mirrors, seed ${DEFAULT_SETTINGS.seed}`,
    );
  });

  it('survives a missing canvas context instead of crashing the page', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(() => render(<Kaleidoscope settings={DEFAULT_SETTINGS} paused />)).not.toThrow();
    expect(error).toHaveBeenCalled();
  });

  it('does not schedule frames while paused', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const requestFrame = vi.spyOn(globalThis, 'requestAnimationFrame');

    render(<Kaleidoscope settings={DEFAULT_SETTINGS} paused />);

    expect(requestFrame).not.toHaveBeenCalled();
  });

  it('schedules frames when running', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const requestFrame = vi.spyOn(globalThis, 'requestAnimationFrame');

    render(<Kaleidoscope settings={DEFAULT_SETTINGS} />);

    expect(requestFrame).toHaveBeenCalled();
  });
});
