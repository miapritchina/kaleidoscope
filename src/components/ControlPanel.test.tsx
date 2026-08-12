import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { OBJECT_SETS } from '../lib/objectSets';
import { DEFAULT_SETTINGS } from '../lib/settings';
import { ControlPanel, type ControlPanelProps } from './ControlPanel';

/**
 * Opens the source chooser and reads what it offers, by name.
 *
 * It is a listbox rather than a select — an `option` cannot carry a picture —
 * so the options only exist while it is open.
 */
async function sourcesOf(user: ReturnType<typeof userEvent.setup>): Promise<string[]> {
  await user.click(screen.getByRole('combobox', { name: /source/i }));

  return screen.getAllByRole('option').map((option) => option.textContent);
}

/** Opens the source chooser and takes the option with the given name. */
async function chooseSource(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole('combobox', { name: /source/i }));
  await user.click(screen.getByRole('option', { name }));
}

/** What the chooser is showing as chosen. */
function shownSource(): string {
  return screen.getByRole('combobox', { name: /source/i }).textContent;
}

function renderPanel(overrides: Partial<ControlPanelProps> = {}) {
  const props: ControlPanelProps = {
    settings: DEFAULT_SETTINGS,
    onChange: vi.fn(),
    onRandomize: vi.fn(),
    onReset: vi.fn(),
    onSave: vi.fn(),
    onShare: vi.fn(),
    onSelectImage: vi.fn(),
    onClearImage: vi.fn(),
    cameraStatus: 'idle',
    tiltStatus: 'idle',
    ...overrides,
  };

  return { ...render(<ControlPanel {...props} />), props };
}

describe('ControlPanel', () => {
  it('labels every control', () => {
    renderPanel();

    expect(screen.getByRole('combobox', { name: /source/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Pieces')).toBeInTheDocument();
    expect(screen.getByLabelText('Mirror size')).toBeInTheDocument();
    expect(screen.getByLabelText('Seed')).toBeInTheDocument();
  });

  it('shows the current values next to their labels', () => {
    renderPanel({ settings: { ...DEFAULT_SETTINGS, zoom: 1.5 } });

    expect(screen.getByText('1.50x')).toBeInTheDocument();
  });

  it('tells the viewer how to turn the tube, now that no slider does', () => {
    renderPanel();

    expect(screen.getByText(/swipe to turn/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Spin')).not.toBeInTheDocument();
  });

  it('reports slider changes', () => {
    const { props } = renderPanel();

    // jsdom does not implement arrow-key stepping on range inputs, so the
    // change event is dispatched directly.
    fireEvent.change(screen.getByLabelText('Pieces'), { target: { value: '20' } });

    expect(props.onChange).toHaveBeenCalledWith('shards', 20);
  });

  // The gestures size what is being looked at; the tube it is looked at through
  // is the slider. Neither is the other's job.
  it('sizes the mirrors on a slider and the pieces by hand', () => {
    renderPanel();

    expect(screen.getByLabelText('Mirror size')).toBeInTheDocument();
    expect(screen.queryByLabelText('Chip size')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Trails')).not.toBeInTheDocument();
    expect(screen.getByText(/pinch or scroll to size the pieces/i)).toBeInTheDocument();
  });

  // A real tube has three mirrors and nothing else. There is no arrangement to
  // choose between, so there is no control for one.
  it('offers no count of mirrors, since a tube has three', () => {
    renderPanel();

    expect(screen.queryByLabelText('Fold')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Segments')).not.toBeInTheDocument();
  });

  it('sizes the mirrors without touching what is in them', () => {
    const { props } = renderPanel();

    fireEvent.change(screen.getByLabelText('Mirror size'), { target: { value: '2' } });

    expect(props.onChange).toHaveBeenCalledWith('zoom', 2);
    expect(props.onChange).not.toHaveBeenCalledWith('sourceScale', expect.anything());
  });

  it('describes slider values to assistive tech', () => {
    renderPanel({ settings: { ...DEFAULT_SETTINGS, zoom: 2 } });

    expect(screen.getByLabelText('Mirror size')).toHaveAttribute('aria-valuetext', '2.00x');
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

  // Tipping a real one does not turn the figure — the mirrors are fixed in the
  // tube. What changes is which way the pieces fall.
  // The triangle everything is reflected from is invisible by design; seeing it
  // is the whole of understanding the figure.
  it('offers a way to see the mirrors', async () => {
    const user = userEvent.setup();
    const { props } = renderPanel();

    await user.click(screen.getByLabelText('Show the mirrors'));

    expect(props.onChange).toHaveBeenCalledWith('debug', true);
  });

  it('reports switching gravity over to the phone', async () => {
    const user = userEvent.setup();
    const { props } = renderPanel();

    await user.click(screen.getByLabelText('Real gravity'));

    expect(props.onChange).toHaveBeenCalledWith('tilt', true);
  });

  it('says why tilting is unavailable rather than offering it silently', () => {
    renderPanel({ tiltStatus: 'denied' });

    expect(screen.getByText(/motion access is blocked/i)).toBeInTheDocument();
  });

  it('reports a change to an uploaded set', async () => {
    const user = userEvent.setup();
    const { props } = renderPanel();

    await chooseSource(user, 'Upload a photo…');

    expect(props.onChange).toHaveBeenCalledWith('objects', 'custom');
  });

  // The pieces can be cut out of a photo while the mirrors go on repeating the
  // shard field, so the picker follows whichever setting is asking for one.
  it('offers the photo picker when the pieces are cut out of one', () => {
    renderPanel({ settings: { ...DEFAULT_SETTINGS, objects: 'custom' } });

    expect(screen.getByLabelText('Photo')).toBeInTheDocument();
    expect(shownSource()).toContain('Upload a photo…');
  });

  // One group now, not two: the input and what it is made of are the same
  // question asked twice.
  it('keeps the source and the pieces in one group', () => {
    renderPanel();

    const groups = screen.getAllByRole('group').map((group) => group.textContent);
    const source = groups.find((text) => text.includes('Source'))!;

    expect(source).toContain('Pieces');
    expect(source).toContain('Seed');
  });

  // One list, not two. A separate input control decided whether the object
  // sets were rendered at all, so leaving it on Photo took the sets out of the
  // panel entirely, with nothing to say why.
  it('asks what the mirrors are pointed at once, sets and all', async () => {
    const user = userEvent.setup();
    renderPanel();

    const names = await sourcesOf(user);

    expect(names).toContain('Mirror a photo');
    expect(names).toContain('Camera (teleidoscope)');
    // Every bundled set, and the one that is not a file.
    expect(names.length).toBeGreaterThan(3);
    expect(screen.queryByLabelText('Input')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Objects')).not.toBeInTheDocument();
  });

  // The names alone are no help: "Cut gems" and "Bright gems" are two different
  // pictures and one description.
  it('shows what each set looks like beside its name', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole('combobox', { name: /source/i }));

    const withPictures = screen
      .getAllByRole('option')
      .filter((option) => option.querySelector('img') !== null);

    expect(withPictures.length).toBeGreaterThan(1);
    // And the chosen one carries its picture on the closed control too.
    await user.keyboard('{Escape}');
    expect(screen.getByRole('combobox', { name: /source/i }).querySelector('img')).not.toBeNull();
  });

  // Whatever it is pointed at, every set is still one tap away.
  it('still lists the sets while the mirrors are on a photo', async () => {
    const user = userEvent.setup();
    renderPanel({ settings: { ...DEFAULT_SETTINGS, source: 'image' } });

    expect(shownSource()).toContain('Mirror a photo');

    const names = await sourcesOf(user);

    expect(names.length).toBeGreaterThan(3);
  });

  it('reports a change to the camera', async () => {
    const user = userEvent.setup();
    const { props } = renderPanel();

    await chooseSource(user, 'Camera (teleidoscope)');

    expect(props.onChange).toHaveBeenCalledWith('source', 'camera');
  });

  // Picking a set has to say both things: which set, and that the mirrors are
  // on the chamber rather than on a photo.
  it('reports a change of set as a set and a chamber', async () => {
    const user = userEvent.setup();
    const { props } = renderPanel({ settings: { ...DEFAULT_SETTINGS, source: 'image' } });

    // Whatever the default set is called, by the name the panel shows for it.
    const named = OBJECT_SETS.find((set) => set.id === DEFAULT_SETTINGS.objects)!;
    await chooseSource(user, named.name);

    expect(props.onChange).toHaveBeenCalledWith('source', 'objects');
    expect(props.onChange).toHaveBeenCalledWith('objects', DEFAULT_SETTINGS.objects);
  });

  it('hides shard-only controls when a photo is the source', () => {
    renderPanel({ settings: { ...DEFAULT_SETTINGS, source: 'image' } });

    // Chamber-specific
    expect(screen.queryByLabelText('Pieces')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Seed')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Randomize' })).not.toBeInTheDocument();

    // Shared across every source
    expect(screen.getByRole('combobox', { name: /source/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save PNG' })).toBeInTheDocument();
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

    expect(screen.getByText(/frames stay in this browser/i)).toBeInTheDocument();
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
