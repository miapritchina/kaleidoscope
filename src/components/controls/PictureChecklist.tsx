import { useId } from 'react';

import styles from './Field.module.css';

export interface PictureChecklistOption {
  value: string;
  label: string;
  /** A postage stamp of what choosing it loads, or `null` for the ones with no picture. */
  picture?: string | null;
}

export interface PictureChecklistProps {
  label: string;
  options: readonly PictureChecklistOption[];
  /** The values currently checked. */
  selected: readonly string[];
  onChange: (selected: string[]) => void;
}

/**
 * A list of choices, any number of which can be on at once, each shown with a
 * picture of what it loads.
 *
 * The glass was a single-choice listbox once: one set at a time, because the
 * chamber held one. It holds several now — a pile can be gems and beads and
 * splinters together — so mixing two sets is checking two boxes, and the
 * control is a list of checkboxes rather than a chooser. The pictures earn
 * their place for the same reason they did on the old control: "Cut gems" and
 * "Bright gems" are two pictures and one description, and a name is no help in
 * telling them apart.
 */
export function PictureChecklist({ label, options, selected, onChange }: PictureChecklistProps) {
  const id = useId();

  const toggle = (value: string) => {
    const chosen = new Set(selected);

    if (chosen.has(value)) {
      chosen.delete(value);
    } else {
      chosen.add(value);
    }

    // Emitted in the options' own order, so a shared link reads the same
    // however the boxes were checked, and two people who chose the same sets
    // get the same link.
    onChange(options.map((option) => option.value).filter((other) => chosen.has(other)));
  };

  return (
    <fieldset className={styles.checklist}>
      <legend className={styles.checklistLegend}>{label}</legend>
      <ul className={styles.checkOptions}>
        {options.map((option) => {
          const optionId = `${id}-${option.value}`;

          return (
            <li key={option.value} className={styles.checkOption}>
              <input
                id={optionId}
                type="checkbox"
                className={styles.checkbox}
                checked={selected.includes(option.value)}
                onChange={() => {
                  toggle(option.value);
                }}
              />
              <Stamp option={option} />
              <label htmlFor={optionId} className={styles.pickerName}>
                {option.label}
              </label>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

/** The picture beside a name, or a space the size of one when there is none. */
function Stamp({ option }: { option: PictureChecklistOption }) {
  if (!option.picture) {
    return <span className={styles.stamp} aria-hidden="true" />;
  }

  return (
    <img
      className={styles.stamp}
      src={option.picture}
      alt=""
      loading="lazy"
      width={40}
      height={40}
    />
  );
}
