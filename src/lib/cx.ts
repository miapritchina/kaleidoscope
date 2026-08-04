/**
 * Joins class names, dropping anything falsy.
 *
 * CSS-module lookups are typed as possibly `undefined` under
 * `noUncheckedIndexedAccess`, so this keeps call sites free of assertions.
 */
export function cx(...values: (string | false | null | undefined)[]): string {
  return values.filter(Boolean).join(' ');
}
