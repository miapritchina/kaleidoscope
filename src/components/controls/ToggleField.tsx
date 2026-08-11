import { useId } from 'react';

import { cx } from '../../lib/cx';

import styles from './Field.module.css';

export interface ToggleFieldProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Extra context announced with the control. */
  description?: string;
}

export function ToggleField({ label, checked, onChange, description }: ToggleFieldProps) {
  const id = useId();
  const descriptionId = `${id}-description`;

  return (
    <div className={cx(styles.field, styles.inline)}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className={styles.checkbox}
        type="checkbox"
        checked={checked}
        aria-describedby={description ? descriptionId : undefined}
        onChange={(event) => {
          onChange(event.currentTarget.checked);
        }}
      />
      {description ? (
        <p id={descriptionId} className={styles.description}>
          {description}
        </p>
      ) : null}
    </div>
  );
}
