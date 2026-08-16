import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { OBJECT_SETS } from '../lib/objectSets';
import { DEFAULT_SETTINGS, type Settings } from '../lib/settings';
import { ControlPanel, type ControlPanelProps } from './ControlPanel';

/** Opens the glass chooser and reads what it offers, by name. */
async function glassOf(user: ReturnType<typeof userEvent.setup>): Promise<string[]> {
  await user.click(screen.getByRole('combobox', { name: /glass/i }));

  return screen.getAllByRole('option').map((option) => option.textContent);
}

function renderPanel(overrides: Partial<ControlPanelProps> = {}) {
  const props: ControlPanelProps = {
    settings: DEFAULT_SETTINGS,
    onChange: vi.fn(),
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

/** The panel as it looks with one setting changed. */
function withSettings(settings: Partial<Settings>, overrides: Partial<ControlPanelProps> = {}) {
  return renderPanel({ settings: { ...DEFAULT_SETTINGS, ...settings }, ...overrides });
}

describe('ControlPanel', () => {
  describe('the three kinds', () => {
    it('offers them as tabs, with the current one chosen', () => {
      renderPanel();

      expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
        'Shards',
        'View',
      ]);
      expect(screen.getByRole('tab', { name: 'Shards' })).toHaveAttribute('aria-selected', 'true');
    });

    it('switches the source when a tab is taken', async () => {
      const user = userEvent.setup();
      const { props } = renderPanel();

      await user.click(screen.getByRole('tab', { name: 'View' }));

      expect(props.onChange).toHaveBeenCalledWith('source', 'image');
    });

    // A tablist is expected to move on the arrows rather than on Tab, which is
    // reserved for leaving the group.
    it('moves between tabs on the arrow keys', async () => {
      const user = userEvent.setup();
      const { props } = renderPanel();

      screen.getByRole('tab', { name: 'Shards' }).focus();
      await user.keyboard('{ArrowRight}');

      expect(props.onChange).toHaveBeenCalledWith('source', 'image');
    });

    it('wraps around at the ends', async () => {
      const user = userEvent.setup();
      const { props } = renderPanel();

      screen.getByRole('tab', { name: 'Shards' }).focus();
      await user.keyboard('{ArrowLeft}');

      expect(props.onChange).toHaveBeenCalledWith('source', 'image');
    });

    it('keeps only the chosen tab in the tab order', () => {
      renderPanel();

      expect(screen.getByRole('tab', { name: 'Shards' })).toHaveAttribute('tabindex', '0');
      expect(screen.getByRole('tab', { name: 'View' })).toHaveAttribute('tabindex', '-1');
    });

    it('names the panel after the tab that opened it', () => {
      renderPanel();

      expect(screen.getByRole('tabpanel')).toHaveAccessibleName('Shards');
    });
  });

  describe('what each tab carries', () => {
    it('gives the shards their own settings and nobody else’s', () => {
      renderPanel();

      expect(screen.getByRole('combobox', { name: /glass/i })).toBeInTheDocument();
      expect(screen.getByLabelText('Pieces')).toBeInTheDocument();
      expect(screen.getByLabelText('Glitter')).toBeInTheDocument();
      expect(screen.getByLabelText('Seed')).toBeInTheDocument();
      expect(screen.queryByLabelText('Facing')).not.toBeInTheDocument();
    });

    // The point of the tabs: a seed and a piece count mean nothing while a
    // photograph is being mirrored, and used to sit there anyway.
    it('puts the chamber away when a photo is being mirrored', () => {
      withSettings({ source: 'image' });

      expect(screen.queryByLabelText('Pieces')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Seed')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Glitter')).not.toBeInTheDocument();
      expect(screen.getByLabelText('Picture')).toBeInTheDocument();
    });

    // A still and a live feed share a tab, because they are the same instrument
    // pointed at two things. The switch between them is inside it.
    it('switches to the camera from inside the view tab', async () => {
      const user = userEvent.setup();
      const { props } = withSettings({ source: 'image' });

      await user.click(screen.getByLabelText('Live camera'));

      expect(props.onChange).toHaveBeenCalledWith('source', 'camera');
    });

    it('offers the lens only once the camera is live', () => {
      withSettings({ source: 'image' });
      expect(screen.queryByLabelText('Facing')).not.toBeInTheDocument();

      withSettings({ source: 'camera' });
      expect(screen.getByLabelText('Facing')).toBeInTheDocument();
    });

    it('keeps the camera on the view tab, not one of its own', () => {
      withSettings({ source: 'camera' });

      expect(screen.getByRole('tab', { name: 'View' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      expect(screen.queryByRole('tab', { name: 'Camera' })).not.toBeInTheDocument();
    });

    it('keeps the mirrors on every tab, since they are the instrument', () => {
      for (const source of ['objects', 'image', 'camera'] as const) {
        const { unmount } = withSettings({ source });

        expect(screen.getByLabelText('Mirror size')).toBeInTheDocument();
        expect(screen.getByLabelText('Mirror angle')).toBeInTheDocument();
        expect(screen.getByLabelText('Bead')).toBeInTheDocument();
        unmount();
      }
    });

    // Gravity tips the glass in the chamber; a photograph and the camera have
    // no physics, so on the View tab the switch would do nothing at all.
    it('offers gravity only where there is a pile for it to move', () => {
      for (const source of ['objects', 'image', 'camera'] as const) {
        const { unmount } = withSettings({ source });

        if (source === 'objects') {
          expect(screen.getByLabelText('Real gravity')).toBeInTheDocument();
        } else {
          expect(screen.queryByLabelText('Real gravity')).not.toBeInTheDocument();
        }

        unmount();
      }
    });
  });

  describe('the glass', () => {
    it('lists every set, with a picture of each', async () => {
      const user = userEvent.setup();
      renderPanel();

      expect(await glassOf(user)).toEqual(OBJECT_SETS.map((set) => set.name));
      expect(
        screen.getByRole('combobox', { name: /glass/i }).querySelector('img'),
      ).not.toBeNull();
    });

    it('reports a change of set', async () => {
      const user = userEvent.setup();
      const { props } = renderPanel();
      const other = OBJECT_SETS.find((set) => set.id !== DEFAULT_SETTINGS.objects)!;

      await user.click(screen.getByRole('combobox', { name: /glass/i }));
      await user.click(screen.getByRole('option', { name: other.name }));

      expect(props.onChange).toHaveBeenCalledWith('objects', other.id);
    });

    it('asks for a picture when the pieces are to be cut out of one', () => {
      withSettings({ objects: 'custom' });

      expect(screen.getByLabelText('Picture')).toBeInTheDocument();
    });
  });

  describe('the controls', () => {
    it('reports a change to a slider', () => {
      const { props } = renderPanel();

      fireEvent.change(screen.getByLabelText('Pieces'), { target: { value: '120' } });

      expect(props.onChange).toHaveBeenCalledWith('shards', 120);
    });

    it('says what a slider is set to, in its own units', () => {
      withSettings({ zoom: 1.5, glitter: 0.4 });

      expect(screen.getByText('1.50x')).toBeInTheDocument();
      expect(screen.getByText('40%')).toBeInTheDocument();
    });

    it('says "none" rather than nought per cent', () => {
      withSettings({ glitter: 0 });

      expect(screen.getByText('none')).toBeInTheDocument();
    });

    it('reports the toggles', async () => {
      const user = userEvent.setup();
      const { props } = renderPanel();

      await user.click(screen.getByLabelText('Show the mirrors'));
      await user.click(screen.getByLabelText('Real gravity'));

      expect(props.onChange).toHaveBeenCalledWith('debug', true);
      expect(props.onChange).toHaveBeenCalledWith('tilt', true);
    });
  });

  describe('the actions', () => {
    // Named, not merely drawn: an icon is a thing to aim at once you know what
    // it does, and is no use at all to a screen reader.
    it('names every icon button', async () => {
      const user = userEvent.setup();
      const { props } = renderPanel();

      await user.click(screen.getByRole('button', { name: 'Save this frame' }));
      await user.click(screen.getByRole('button', { name: 'Copy link' }));
      await user.click(screen.getByRole('button', { name: 'Reset' }));

      expect(props.onSave).toHaveBeenCalled();
      expect(props.onShare).toHaveBeenCalled();
      expect(props.onReset).toHaveBeenCalled();
    });

    // The toolbar over the artwork already reshuffles. Two buttons of the same
    // name on one screen is ambiguous to a screen reader and clutter to anyone.
    it('leaves reshuffling to the toolbar', () => {
      renderPanel();

      expect(screen.queryByRole('button', { name: /arrangement|randomi/i })).not.toBeInTheDocument();
    });
  });

  describe('what it says out loud', () => {
    // Explanations of what a control obviously does were removed; the ones that
    // report a state nobody can otherwise see were not.
    it('says when motion is blocked', () => {
      renderPanel({ tiltStatus: 'denied' });

      expect(screen.getByText(/allow motion access/i)).toBeInTheDocument();
    });

    it('says nothing about tilting when there is nothing to say', () => {
      renderPanel({ tiltStatus: 'idle' });

      expect(screen.queryByText(/allow motion access/i)).not.toBeInTheDocument();
    });

    it('says when the camera will not start', () => {
      withSettings({ source: 'camera' }, { cameraStatus: 'denied' });

      expect(screen.getByText(/camera access is blocked/i)).toBeInTheDocument();
    });

    it('says nothing about a camera that is working', () => {
      withSettings({ source: 'camera' }, { cameraStatus: 'active' });

      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('reports a photo that could not be read', () => {
      withSettings({ source: 'image' }, { imageError: 'That file is not an image.' });

      expect(screen.getByRole('alert')).toHaveTextContent('That file is not an image.');
    });
  });

  describe('which build this is', () => {
    // A cached page looks exactly like a fresh one, and this app is a picture:
    // without this there is nothing on screen that says which copy is running.
    it('always shows one', () => {
      const { container } = renderPanel();

      expect(container.textContent).toMatch(/dev|[0-9a-f]{7}/);
    });
  });
});
