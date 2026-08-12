import { useEffect, useId, useRef, useState } from 'react';

import { cx } from '../../lib/cx';

import styles from './Field.module.css';

export interface PictureOption<T extends string> {
  value: T;
  label: string;
  /** A postage stamp of what choosing it loads, or `null` for the ones with no picture. */
  picture?: string | null;
}

export interface PictureFieldProps<T extends string> {
  label: string;
  value: T;
  options: readonly PictureOption<T>[];
  onChange: (value: T) => void;
  description?: string;
}

/**
 * A chooser that shows what each choice looks like.
 *
 * A native `select` cannot carry a picture — `option` takes text and nothing
 * else, on every browser — and the names of these are no help at all: "Cut
 * gems" and "Bright gems" are two different pictures and one description. So
 * this is a listbox rather than a select, which means keyboard and screen
 * reader behaviour has to be built rather than inherited: arrows move through
 * the list, Enter and Space choose, Escape closes without choosing, and the
 * whole thing is labelled and announced as a combobox.
 */
export function PictureField<T extends string>({
  label,
  value,
  options,
  onChange,
  description,
}: PictureFieldProps<T>) {
  const id = useId();
  const listId = `${id}-list`;
  const descriptionId = `${id}-description`;
  const [open, setOpen] = useState(false);
  // Where the keyboard is in the list, which is not the same as what is chosen:
  // moving through the options must not change the picture until it is taken.
  const [at, setAt] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);

  const chosen = options.find((option) => option.value === value) ?? options[0];
  const index = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    list.current?.focus();
  }, [open]);

  // A click anywhere else is a decision not to choose.
  useEffect(() => {
    if (!open) {
      return;
    }

    const onDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener('pointerdown', onDown);

    return () => {
      document.removeEventListener('pointerdown', onDown);
    };
  }, [open]);

  // Opening puts the keyboard on whatever is already chosen, so the first arrow
  // press moves from there rather than from the top of the list.
  const show = () => {
    setAt(index);
    setOpen(true);
  };

  const take = (option: PictureOption<T>) => {
    onChange(option.value);
    setOpen(false);
    button.current?.focus();
  };

  const close = () => {
    setOpen(false);
    button.current?.focus();
  };

  return (
    <div className={styles.field} ref={root}>
      <span className={styles.label} id={`${id}-label`}>
        {label}
      </span>

      <button
        ref={button}
        id={id}
        type="button"
        className={styles.picker}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-haspopup="listbox"
        aria-labelledby={`${id}-label ${id}`}
        aria-describedby={description ? descriptionId : undefined}
        onClick={() => {
          if (open) {
            setOpen(false);
          } else {
            show();
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            show();
          }
        }}
      >
        <Stamp option={chosen} />
        <span className={styles.pickerName}>{chosen?.label}</span>
        <svg className={styles.chevron} viewBox="0 0 24 24" aria-hidden="true">
          <path d="m7 10 5 5 5-5z" />
        </svg>
      </button>

      {open && (
        <ul
          ref={list}
          id={listId}
          className={styles.options}
          role="listbox"
          tabIndex={-1}
          aria-labelledby={`${id}-label`}
          aria-activedescendant={`${id}-option-${String(at)}`}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setAt((was) => Math.min(options.length - 1, was + 1));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setAt((was) => Math.max(0, was - 1));
            } else if (event.key === 'Home') {
              event.preventDefault();
              setAt(0);
            } else if (event.key === 'End') {
              event.preventDefault();
              setAt(options.length - 1);
            } else if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              const option = options[at];

              if (option) {
                take(option);
              }
            } else if (event.key === 'Escape' || event.key === 'Tab') {
              event.preventDefault();
              close();
            }
          }}
        >
          {options.map((option, position) => (
            <li
              key={option.value}
              id={`${id}-option-${String(position)}`}
              role="option"
              aria-selected={option.value === value}
              className={cx(
                styles.option,
                position === at && styles.here,
                option.value === value && styles.taken,
              )}
              onPointerDown={(event) => {
                // Kept off the document listener above, which would close the
                // list before the click landed.
                event.stopPropagation();
              }}
              onClick={() => {
                take(option);
              }}
            >
              <Stamp option={option} />
              <span className={styles.pickerName}>{option.label}</span>
            </li>
          ))}
        </ul>
      )}

      {description ? (
        <p id={descriptionId} className={styles.description}>
          {description}
        </p>
      ) : null}
    </div>
  );
}

/** The picture beside a name, or a space the size of one when there is none. */
function Stamp<T extends string>({ option }: { option: PictureOption<T> | undefined }) {
  if (!option?.picture) {
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
