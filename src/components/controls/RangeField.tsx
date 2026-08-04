import { useId } from 'react';

import type { NumericLimit } from '../../lib/settings';

import styles from './Field.module.css';

export interface RangeFieldProps {
  label: string;
  value: number;
  limit: NumericLimit;
  onChange: (value: number) => void;
  /** Renders the value next to the label, e.g. `1.20x`. */
  format?: (value: number) => string;
  /** Extra context announced with the control. */
  description?: string;
}

export function RangeField({
  label,
  value,
  limit,
  onChange,
  format = String,
  description,
}: RangeFieldProps) {
  const id = useId();
  const descriptionId = `${id}-description`;

  return (
    <div className={styles.field}>
      <div className={styles.header}>
        <label className={styles.label} htmlFor={id}>
          {label}
        </label>
        {/* Hidden from assistive tech: the slider announces the same value via
            `aria-valuetext`, and an `<output>` here would be a live region that
            re-announced it on every drag. */}
        <span className={styles.value} aria-hidden="true">
          {format(value)}
        </span>
      </div>
      <input
        id={id}
        className={styles.range}
        type="range"
        min={limit.min}
        max={limit.max}
        step={limit.step}
        value={value}
        aria-valuetext={format(value)}
        aria-describedby={description ? descriptionId : undefined}
        onChange={(event) => {
          onChange(event.currentTarget.valueAsNumber);
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
