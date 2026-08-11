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
const drawer = () => document.getElementById('controls')!;

describe('App', () => {
  // The artwork has the whole window. Nothing else is on it but the two
  // buttons, so the panel starts away.
  it('opens with the controls out of the way', () => {
    render(<App />);

    expect(controls()).toHaveAttribute('aria-expanded', 'false');
    expect(drawer()).toHaveAttribute('inert');
  });

  it('shows them when the button is pressed, and hides them again', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(controls());
    expect(controls()).toHaveAttribute('aria-expanded', 'true');
    expect(drawer()).not.toHaveAttribute('inert');
    expect(screen.getByLabelText('Zoom')).toBeInTheDocument();

    await user.click(controls());
    expect(controls()).toHaveAttribute('aria-expanded', 'false');
    expect(drawer()).toHaveAttribute('inert');
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
    expect(drawer().contains(live)).toBe(false);
  });

  // The visible heading is in the drawer, which is not always on screen.
  it('keeps a heading in the document either way', () => {
    render(<App />);

    expect(screen.getByRole('heading', { level: 1, name: 'Kaleidoscope' })).toBeInTheDocument();
  });

  it('leaves the play control on the artwork, not behind the button', () => {
    render(<App />);

    const play = screen.getByRole('button', { name: /play|pause/i });

    expect(drawer().contains(play)).toBe(false);
  });
});
