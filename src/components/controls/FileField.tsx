import { useId, useRef } from 'react';

import styles from './Field.module.css';

export interface FileFieldProps {
  label: string;
  accept: string;
  /** Name of the current selection, shown instead of the browser's default. */
  fileName?: string | null | undefined;
  buttonLabel?: string;
  onSelect: (file: File) => void;
}

/**
 * A file picker with a real label.
 *
 * The native control is kept in the accessibility tree and merely hidden from
 * view, so it stays keyboard reachable and screen-reader announced — unlike the
 * usual `display: none` plus a button, which strips both.
 */
export function FileField({
  label,
  accept,
  fileName,
  buttonLabel = 'Choose file',
  onSelect,
}: FileFieldProps) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      <input
        ref={inputRef}
        id={id}
        className={styles.file}
        type="file"
        accept={accept}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];

          if (file) {
            onSelect(file);
          }

          // Reset, so picking the same file twice still fires a change event.
          event.currentTarget.value = '';
        }}
      />
      <div className={styles.fileRow}>
        <button
          type="button"
          className={styles.fileButton}
          onClick={() => inputRef.current?.click()}
        >
          {buttonLabel}
        </button>
        <span className={styles.fileName}>{fileName ?? 'No file chosen'}</span>
      </div>
    </div>
  );
}
