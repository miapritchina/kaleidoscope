import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_SETTINGS } from '../lib/settings';
import { ControlPanel, type ControlPanelProps } from './ControlPanel';

function renderPanel(overrides: Partial<ControlPanelProps> = {}) {
  const props: ControlPanelProps = {
    settings: DEFAULT_SETTINGS,
    onChange: vi.fn(),
    onRandomize: vi.fn(),
    onReset: vi.fn(),
    onSave: vi.fn(),
    onShare: vi.fn(),
    ...overrides,
  };

  return { ...render(<ControlPanel {...props} />), props };
}

describe('ControlPanel', () => {
  it('labels every control', () => {
    renderPanel();

    expect(screen.getByLabelText('Segments')).toBeInTheDocument();
    expect(screen.getByLabelText('Spin')).toBeInTheDocument();
    expect(screen.getByLabelText('Zoom')).toBeInTheDocument();
    expect(screen.getByLabelText('Count')).toBeInTheDocument();
    expect(screen.getByLabelText('Trails')).toBeInTheDocument();
    expect(screen.getByLabelText('Palette')).toBeInTheDocument();
    expect(screen.getByLabelText('Glow')).toBeInTheDocument();
    expect(screen.getByLabelText('Seed')).toBeInTheDocument();
  });

  it('shows the current values next to their labels', () => {
    renderPanel({ settings: { ...DEFAULT_SETTINGS, segments: 18, zoom: 2, trails: 0.5 } });

    expect(screen.getByText('18')).toBeInTheDocument();
    expect(screen.getByText('2.00x')).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();
  });

  it('signs the spin readout so the direction is obvious', () => {
    const { unmount } = renderPanel({ settings: { ...DEFAULT_SETTINGS, speed: 0.25 } });
    expect(screen.getByText('+0.25 rev/s')).toBeInTheDocument();
    unmount();

    renderPanel({ settings: { ...DEFAULT_SETTINGS, speed: -0.25 } });
    expect(screen.getByText('-0.25 rev/s')).toBeInTheDocument();
  });

  it('reports slider changes', () => {
    const { props } = renderPanel();

    // jsdom does not implement arrow-key stepping on range inputs, so the
    // change event is dispatched directly.
    fireEvent.change(screen.getByLabelText('Segments'), { target: { value: '18' } });

    expect(props.onChange).toHaveBeenCalledWith('segments', 18);
  });

  it('describes slider values to assistive tech', () => {
    renderPanel({ settings: { ...DEFAULT_SETTINGS, zoom: 2 } });

    expect(screen.getByLabelText('Zoom')).toHaveAttribute('aria-valuetext', '2.00x');
  });

  it('reports palette changes', async () => {
    const user = userEvent.setup();
    const { props } = renderPanel();

    await user.selectOptions(screen.getByLabelText('Palette'), 'ember');

    expect(props.onChange).toHaveBeenCalledWith('paletteId', 'ember');
  });

  it('reports glow toggles', async () => {
    const user = userEvent.setup();
    const { props } = renderPanel();

    await user.click(screen.getByLabelText('Glow'));

    expect(props.onChange).toHaveBeenCalledWith('glow', !DEFAULT_SETTINGS.glow);
  });

  it('lets the seed field be cleared while typing', async () => {
    const user = userEvent.setup();
    const { props } = renderPanel();
    const seed = screen.getByLabelText('Seed');

    await user.clear(seed);

    expect(seed).toHaveValue('');
    expect(props.onChange).toHaveBeenCalledWith('seed', '');
  });

  it('wires up the action buttons', async () => {
    const user = userEvent.setup();
    const { props } = renderPanel();

    await user.click(screen.getByRole('button', { name: 'Randomize' }));
    await user.click(screen.getByRole('button', { name: 'Save PNG' }));
    await user.click(screen.getByRole('button', { name: 'Copy link' }));
    await user.click(screen.getByRole('button', { name: 'Reset' }));

    expect(props.onRandomize).toHaveBeenCalledOnce();
    expect(props.onSave).toHaveBeenCalledOnce();
    expect(props.onShare).toHaveBeenCalledOnce();
    expect(props.onReset).toHaveBeenCalledOnce();
  });

  it('announces status messages politely', () => {
    renderPanel({ status: 'Link copied to the clipboard.' });

    expect(screen.getByRole('status')).toHaveTextContent('Link copied to the clipboard.');
  });
});
