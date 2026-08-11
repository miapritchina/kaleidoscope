import { useId } from 'react';

import styles from './Field.module.css';

export interface SelectOption<T extends string> {
  value: T;
  label: string;
}

export interface SelectFieldProps<T extends string> {
  label: string;
  value: T;
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
  /** Extra context announced with the control. */
  description?: string;
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  description,
}: SelectFieldProps<T>) {
  const id = useId();
  const descriptionId = `${id}-description`;

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        className={styles.select}
        value={value}
        aria-describedby={description ? descriptionId : undefined}
        onChange={(event) => {
          onChange(event.currentTarget.value as T);
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {description ? (
        <p id={descriptionId} className={styles.description}>
          {description}
        </p>
      ) : null}
    </div>
  );
}
