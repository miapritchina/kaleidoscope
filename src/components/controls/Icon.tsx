/**
 * The panel's pictures.
 *
 * One flat set, drawn on a 24-unit grid so they line up with each other, with
 * `currentColor` throughout so a button's own state colours its icon without
 * anything being passed down.
 *
 * None of these carries meaning on its own — every one of them is `aria-hidden`
 * and sits inside a control that has a real name. An icon is a thing to aim at
 * once you know what it does; it is not a label, and a screen reader given a
 * gem to read out is no better off than one given nothing.
 */

export type IconName =
  | 'shards'
  | 'liquid'
  | 'lava'
  | 'drops'
  | 'smoke'
  | 'photo'
  | 'camera'
  | 'shuffle'
  | 'save'
  | 'link'
  | 'reset'
  | 'mirrors'
  | 'gravity'
  | 'glitter'
  | 'film';

const PATHS: Record<IconName, string> = {
  // A cut stone, table uppermost: what the chamber is full of.
  shards: 'M12 2 4 8l8 14 8-14zM4 8h16M12 2 8.5 8 12 22M12 2l3.5 6L12 22',
  // A drop, and a piece of glass adrift in it: the cell that is not dry.
  liquid: 'M12 3c3.4 4 5 6.7 5 9a5 5 0 0 1-10 0c0-2.3 1.6-5 5-9ZM12 9.6l2.2 2.6-2.2 2.6-2.2-2.6z',
  // Two blobs of wax, one climbing past the other.
  lava: 'M13.4 3.2c2.6 3 3.8 5.1 3.8 6.9a3.8 3.8 0 0 1-7.6 0c0-1.8 1.2-3.9 3.8-6.9ZM8.2 13.4c1.8 2.1 2.6 3.5 2.6 4.7a2.6 2.6 0 0 1-5.2 0c0-1.2.8-2.6 2.6-4.7Z',
  // A bead letting go, a bead on its way down, and the pool they are on their
  // way into — level, with the swell of the last one to land.
  drops:
    'M12 2.6c1.8 2.1 2.7 3.5 2.7 4.7a2.7 2.7 0 0 1-5.4 0c0-1.2.9-2.6 2.7-4.7M10.4 13.6a1.6 1.6 0 1 0 3.2 0 1.6 1.6 0 1 0-3.2 0M3.5 19.4h5c1-1.6 2.1-2.4 3.5-2.4s2.5.8 3.5 2.4h5',
  // Three drifts of it, rising and folding.
  smoke:
    'M4 18c2-2.2 4-.2 6-1.4s3.2-3 6-1.6M4 13c2-2.2 4-.2 6-1.4s3.2-3 6-1.6M7 8c1.5-1.7 3 .5 4.5-.6s2.4-2.3 4.5-1.2',
  photo: 'M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6M15.5 8.5h.01',
  camera: 'M3 7h4l2-2h6l2 2h4v12H3zM12 16a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
  // Round arrows: another throw of the same dice.
  shuffle: 'M20 12a8 8 0 1 1-2.3-5.7M20 3v4h-4',
  save: 'M12 3v12m0 0 4-4m-4 4-4-4M4 17v3h16v-3',
  link: 'M9 14a4 4 0 0 0 6 .5l3-3a4 4 0 0 0-5.7-5.7l-1 1M15 10a4 4 0 0 0-6-.5l-3 3A4 4 0 0 0 11.7 18l1-1',
  reset: 'M4 12a8 8 0 1 0 2.3-5.7M4 3v4h4',
  // The mirror triangle itself, which is what the toggle draws on screen.
  mirrors: 'M12 4 3 20h18zM12 4v16M12 20 3 20M3 20 12 4',
  // A plumb line: which way is down.
  gravity: 'M12 3v13m0 0 4-4m-4 4-4-4M6 21h12',
  glitter:
    'M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6zM18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z',
  // A drop, and the bands of colour an oil film wears.
  film: 'M12 3c3.4 4 5 6.7 5 9a5 5 0 0 1-10 0c0-2.3 1.6-5 5-9ZM8.6 12.6c1.2 1 2.4-.6 3.4-.6s2.2 1.6 3.4.6M9.4 15.2c1 .8 1.8-.4 2.6-.4s1.6 1.2 2.6.4',
};

export interface IconProps {
  name: IconName;
  /** Side of the square it draws in, in `em` so it follows the text it sits by. */
  size?: number;
}

export function Icon({ name, size = 1.25 }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={`${String(size)}em`}
      height={`${String(size)}em`}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
