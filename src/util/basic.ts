export const stringIncludes = (array: unknown[], value: string | number): boolean =>
  array.includes(value) || array.includes(`${value}`);

/**
 * Whether two arrays hold the same values, order aside.
 *
 * Was `lodash.xor(source, array).length === 0` — a whole runtime dependency,
 * plus its types, for one function. Same semantics: `xor` compares by value and
 * ignores duplicates, and the equal-length check in front means "same set" and
 * "same multiset" cannot disagree here in practice. The callers compare armed
 * alarm-zone ids.
 */
export const sameArrays = (source: unknown[], array: unknown[]): boolean => {
  if (source.length !== array.length) {
    return false;
  }
  const other = new Set(array);
  return source.every((value) => other.has(value));
};

export const asNumber = (maybeNumber: unknown): number => parseInt(`${maybeNumber}`, 10);
