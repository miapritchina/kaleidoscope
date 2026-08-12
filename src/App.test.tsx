import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { App } from './App';

beforeAll(() => {
  // jsdom has no canvas backend, so the renderer refuses to start and says so.
  // That is expected here; the layout is what is under test.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

const controls = () => screen.getByRole('button', { name: /controls/i });
const drawer = () => document.getElementById('controls');

describe('App', () => {
  // The artwork has the whole window. Nothing else is on it but the two
  // buttons, so the panel starts away.
  // Not merely hidden: gone. A scroll container that is kept in the DOM and
  // moved off-canvas with a transform is what iOS Safari paints stale, and
  // there is no animation worth that.
  it('opens with the controls out of the way, and out of the document', () => {
    render(<App />);

    expect(controls()).toHaveAttribute('aria-expanded', 'false');
    expect(drawer()).toBeNull();
    expect(screen.queryByLabelText('Count')).not.toBeInTheDocument();
  });

  it('shows them when the button is pressed, and hides them again', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(controls());
    expect(controls()).toHaveAttribute('aria-expanded', 'true');
    expect(drawer()).not.toBeNull();
    expect(screen.getByLabelText('Count')).toBeInTheDocument();

    await user.click(controls());
    expect(controls()).toHaveAttribute('aria-expanded', 'false');
    expect(drawer()).toBeNull();
  });

  // Whatever has covered the artwork, Escape is what a viewer reaches for.
  it('closes on Escape and hands the focus back', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(controls());
    await user.keyboard('{Escape}');

    expect(controls()).toHaveAttribute('aria-expanded', 'false');
    expect(controls()).toHaveFocus();
  });

  it('closes on the panel’s own button, and hands the focus back', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(controls());
    await user.click(screen.getByRole('button', { name: 'Close' }));

    expect(controls()).toHaveAttribute('aria-expanded', 'false');
    expect(controls()).toHaveFocus();
  });

  // Opening it should land a keyboard on the controls rather than leaving the
  // focus on the artwork behind them.
  it('moves the focus into the panel when it opens', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(controls());

    expect(drawer()).toHaveFocus();
  });

  // The panel can be off screen when something worth saying happens — a photo
  // dropped on the artwork, say — so the live region is not inside it.
  it('keeps a live region outside the panel', () => {
    render(<App />);

    const live = screen.getByRole('status');

    expect(live).toBeInTheDocument();
    // Closed, there is no panel at all — which is the point: a message still
    // has to reach a screen reader.
    expect(drawer()).toBeNull();
  });

  // The visible heading is in the drawer, which is not always on screen.
  it('keeps a heading in the document either way', () => {
    render(<App />);

    expect(screen.getByRole('heading', { level: 1, name: 'Kaleidoscope' })).toBeInTheDocument();
  });

  // The three worth reaching without opening anything.
  it('leaves saving and reshuffling on the artwork, not behind the panel', () => {
    render(<App />);

    expect(screen.getByRole('button', { name: 'Save pattern' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New arrangement' })).toBeInTheDocument();
    expect(drawer()).toBeNull();
  });

  // Drawn, not written: three words laid over the artwork is three things
  // competing with the thing they are for. The name is in the accessibility
  // tree, where it costs the picture nothing.
  it('names them for a screen reader without printing anything on the picture', () => {
    render(<App />);

    for (const name of ['Save pattern', 'New arrangement', 'Controls']) {
      expect(screen.getByRole('button', { name }).textContent).toBe('');
    }
  });

  it('reshuffles the pieces and says so', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(controls());
    const seed = () => screen.getByLabelText('Seed').getAttribute('value');
    const before = seed();

    await user.click(screen.getByRole('button', { name: 'New arrangement' }));

    expect(seed()).not.toBe(before);
    expect(screen.getByRole('status')).toHaveTextContent('A new arrangement of the pieces.');
  });
});
