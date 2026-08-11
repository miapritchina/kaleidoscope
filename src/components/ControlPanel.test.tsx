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
    onSavePattern: vi.fn(),
    onShare: vi.fn(),
    onSelectImage: vi.fn(),
    onClearImage: vi.fn(),
    cameraStatus: 'idle',
    ...overrides,
  };

  return { ...render(<ControlPanel {...props} />), props };
}

describe('ControlPanel', () => {
  it('labels every control', () => {
    renderPanel();

    expect(screen.getByLabelText('Zoom')).toBeInTheDocument();
    expect(screen.getByLabelText('Count')).toBeInTheDocument();
    expect(screen.getByLabelText('Chip size')).toBeInTheDocument();
    expect(screen.getByLabelText('Trails')).toBeInTheDocument();
    expect(screen.getByLabelText('Palette')).toBeInTheDocument();
    expect(screen.getByLabelText('Pieces')).toBeInTheDocument();
    expect(screen.getByLabelText('Metallic')).toBeInTheDocument();
    expect(screen.getByLabelText('Seed')).toBeInTheDocument();
  });

  it('shows the current values next to their labels', () => {
    renderPanel({ settings: { ...DEFAULT_SETTINGS, zoom: 2, trails: 0.5 } });

    expect(screen.getByText('2.00x')).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();
  });

  it('tells the viewer how to turn the tube, now that no slider does', () => {
    renderPanel();

    expect(screen.getByText(/swipe across the artwork/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Spin')).not.toBeInTheDocument();
  });

  it('reports slider changes', () => {
    const { props } = renderPanel();

    // jsdom does not implement arrow-key stepping on range inputs, so the
    // change event is dispatched directly.
    fireEvent.change(screen.getByLabelText('Zoom'), { target: { value: '2' } });

    expect(props.onChange).toHaveBeenCalledWith('zoom', 2);
  });

  // A real tube has three mirrors and nothing else. There is no arrangement to
  // choose between, so there is no control for one.
  it('offers no mirror control, and describes the tube instead', () => {
    renderPanel();

    expect(screen.queryByLabelText('Mirrors')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Fold')).not.toBeInTheDocument();
    expect(screen.getByText(/three mirrors/i)).toBeInTheDocument();
  });

  it('sizes the glass without changing how much of it there is', () => {
    const { props } = renderPanel();

    fireEvent.change(screen.getByLabelText('Chip size'), { target: { value: '1.5' } });

    expect(props.onChange).toHaveBeenCalledWith('chipSize', 1.5);
    // Count is what sets the amount; the two are separate controls.
    expect(props.onChange).not.toHaveBeenCalledWith('shards', expect.anything());
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

  it('reports finish toggles', async () => {
    const user = userEvent.setup();
    const { props } = renderPanel();

    await user.click(screen.getByLabelText('Metallic'));

    expect(props.onChange).toHaveBeenCalledWith('metallic', !DEFAULT_SETTINGS.metallic);
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
    await user.click(screen.getByRole('button', { name: 'Save pattern' }));
    await user.click(screen.getByRole('button', { name: 'Copy link' }));
    await user.click(screen.getByRole('button', { name: 'Reset' }));

    expect(props.onRandomize).toHaveBeenCalledOnce();
    expect(props.onSave).toHaveBeenCalledOnce();
    expect(props.onSavePattern).toHaveBeenCalledOnce();
    expect(props.onShare).toHaveBeenCalledOnce();
    expect(props.onReset).toHaveBeenCalledOnce();
  });

  it('reports a change of what the pieces are', async () => {
    const user = userEvent.setup();
    const { props } = renderPanel();

    await user.selectOptions(screen.getByLabelText('Pieces'), 'photo');

    expect(props.onChange).toHaveBeenCalledWith('skin', 'photo');
  });

  // The pieces can be cut out of a photo while the mirrors go on repeating the
  // shard field, so the picker follows whichever setting is asking for one.
  it('offers the photo picker when the pieces are cut out of one', () => {
    renderPanel({ settings: { ...DEFAULT_SETTINGS, skin: 'photo' } });

    expect(screen.getByLabelText('Photo')).toBeInTheDocument();
    expect(screen.getByLabelText('Input')).toHaveValue('shards');
  });

  // One group now, not two: the input and what it is made of are the same
  // question asked twice.
  it('keeps the source and the pieces in one group', () => {
    renderPanel();

    const groups = screen.getAllByRole('group').map((group) => group.textContent);
    const source = groups.find((text) => text.includes('Input'))!;

    expect(source).toContain('Count');
    expect(source).toContain('Palette');
    expect(source).toContain('Seed');
  });

  it('offers the three input sources', () => {
    renderPanel();

    const input = screen.getByLabelText('Input');

    expect(input).toHaveValue('shards');
    expect([...(input as HTMLSelectElement).options].map((option) => option.value)).toEqual([
      'shards',
      'image',
      'camera',
    ]);
  });

  it('reports source changes', async () => {
    const user = userEvent.setup();
    const { props } = renderPanel();

    await user.selectOptions(screen.getByLabelText('Input'), 'camera');

    expect(props.onChange).toHaveBeenCalledWith('source', 'camera');
  });

  it('hides shard-only controls when a photo is the source', () => {
    renderPanel({ settings: { ...DEFAULT_SETTINGS, source: 'image' } });

    // Shard-specific
    expect(screen.queryByLabelText('Count')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Palette')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Seed')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Randomize' })).not.toBeInTheDocument();

    // Shared across every source
    expect(screen.getByLabelText('Zoom')).toBeInTheDocument();
    expect(screen.getByLabelText('Trails')).toBeInTheDocument();
  });

  it('shows the photo picker only for the photo source', () => {
    const { unmount } = renderPanel();
    expect(screen.queryByLabelText('Photo')).not.toBeInTheDocument();
    unmount();

    renderPanel({ settings: { ...DEFAULT_SETTINGS, source: 'image' } });
    expect(screen.getByLabelText('Photo')).toBeInTheDocument();
  });

  it('passes a chosen photo to the handler', async () => {
    const user = userEvent.setup();
    const { props } = renderPanel({ settings: { ...DEFAULT_SETTINGS, source: 'image' } });
    const file = new File(['x'], 'holiday.png', { type: 'image/png' });

    await user.upload(screen.getByLabelText('Photo'), file);

    expect(props.onSelectImage).toHaveBeenCalledWith(file);
  });

  it('offers to remove a chosen photo', async () => {
    const user = userEvent.setup();
    const { props } = renderPanel({
      settings: { ...DEFAULT_SETTINGS, source: 'image' },
      imageName: 'holiday.png',
    });

    expect(screen.getByText('holiday.png')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove photo' }));

    expect(props.onClearImage).toHaveBeenCalledOnce();
  });

  it('surfaces an image error as an alert', () => {
    renderPanel({
      settings: { ...DEFAULT_SETTINGS, source: 'image' },
      imageError: 'notes.txt is not an image.',
    });

    expect(screen.getByRole('alert')).toHaveTextContent('notes.txt is not an image.');
  });

  it('explains the camera state', () => {
    renderPanel({
      settings: { ...DEFAULT_SETTINGS, source: 'camera' },
      cameraStatus: 'denied',
      cameraMessage: 'Camera access was blocked. Allow it in your browser, then try again.',
    });

    expect(screen.getByText(/Camera access was blocked/)).toBeInTheDocument();
  });

  it('states that camera frames stay local', () => {
    renderPanel({ settings: { ...DEFAULT_SETTINGS, source: 'camera' }, cameraStatus: 'active' });

    expect(screen.getByText(/nothing is uploaded/i)).toBeInTheDocument();
  });

  // Shown, but not announced from here. The panel can be off screen, so the app
  // keeps the live region and this is only the visible copy of it — left in the
  // accessibility tree it would be read out twice.
  it('shows the latest status without announcing it a second time', () => {
    renderPanel({ status: 'Link copied to the clipboard.' });

    expect(screen.getByText('Link copied to the clipboard.')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
