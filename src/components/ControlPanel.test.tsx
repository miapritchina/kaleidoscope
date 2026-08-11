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

    expect(screen.getByLabelText('Objects')).toBeInTheDocument();
    expect(screen.getByLabelText('Count')).toBeInTheDocument();
    expect(screen.getByLabelText('Chip size')).toBeInTheDocument();
    expect(screen.getByLabelText('Palette')).toBeInTheDocument();
    expect(screen.getByLabelText('Seed')).toBeInTheDocument();
  });

  it('shows the current values next to their labels', () => {
    renderPanel({ settings: { ...DEFAULT_SETTINGS, chipSize: 1.5 } });

    expect(screen.getByText('1.50x')).toBeInTheDocument();
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
    fireEvent.change(screen.getByLabelText('Count'), { target: { value: '20' } });

    expect(props.onChange).toHaveBeenCalledWith('shards', 20);
  });

  // Zoom is a pinch, or a scroll over the artwork. A slider for it was one more
  // thing in a panel that is now behind a button.
  it('offers no zoom or trail sliders', () => {
    renderPanel();

    expect(screen.queryByLabelText('Zoom')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Trails')).not.toBeInTheDocument();
    expect(screen.getByText(/pinch, or scroll, to zoom/i)).toBeInTheDocument();
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
    renderPanel({ settings: { ...DEFAULT_SETTINGS, chipSize: 2 } });

    expect(screen.getByLabelText('Chip size')).toHaveAttribute('aria-valuetext', '2.00x');
  });

  it('reports palette changes', async () => {
    const user = userEvent.setup();
    const { props } = renderPanel();

    await user.selectOptions(screen.getByLabelText('Palette'), 'ember');

    expect(props.onChange).toHaveBeenCalledWith('paletteId', 'ember');
  });

  // Metallic describes how a drawn facet returns the light. A photograph
  // brought its own, so the toggle is only offered for the drawn shapes.
  it('reports finish toggles, which only the drawn shapes have', async () => {
    const user = userEvent.setup();
    const { props } = renderPanel({ settings: { ...DEFAULT_SETTINGS, objects: 'generated' } });

    expect(screen.getByLabelText('Metallic')).toBeInTheDocument();
    await user.click(screen.getByLabelText('Metallic'));

    expect(props.onChange).toHaveBeenCalledWith('metallic', !DEFAULT_SETTINGS.metallic);
  });

  it('hides the finish toggle when the pieces come out of a picture', () => {
    renderPanel({ settings: { ...DEFAULT_SETTINGS, objects: 'custom' } });

    expect(screen.queryByLabelText('Metallic')).not.toBeInTheDocument();
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

  it('reports a change of which objects the chamber holds', async () => {
    const user = userEvent.setup();
    const { props } = renderPanel();

    await user.selectOptions(screen.getByLabelText('Objects'), 'custom');

    expect(props.onChange).toHaveBeenCalledWith('objects', 'custom');
  });

  // The pieces can be cut out of a photo while the mirrors go on repeating the
  // shard field, so the picker follows whichever setting is asking for one.
  it('offers the photo picker when the pieces are cut out of one', () => {
    renderPanel({ settings: { ...DEFAULT_SETTINGS, objects: 'custom' } });

    expect(screen.getByLabelText('Photo')).toBeInTheDocument();
    expect(screen.getByLabelText('Input')).toHaveValue('shards');
  });

  // One group now, not two: the input and what it is made of are the same
  // question asked twice.
  it('keeps the source and the pieces in one group', () => {
    renderPanel();

    const groups = screen.getAllByRole('group').map((group) => group.textContent);
    const source = groups.find((text) => text.includes('Input'))!;

    expect(source).toContain('Objects');
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

    // Chamber-specific
    expect(screen.queryByLabelText('Objects')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Count')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Palette')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Seed')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Randomize' })).not.toBeInTheDocument();

    // Shared across every source
    expect(screen.getByLabelText('Input')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save pattern' })).toBeInTheDocument();
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
