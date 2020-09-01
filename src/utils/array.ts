export const stringIncludes = (array: unknown[], value: string | number): boolean =>
  array.includes(value) || array.includes(`${value}`);
