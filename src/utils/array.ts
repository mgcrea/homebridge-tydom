export const stringIncludes = (array: unknown[], value: string | number) =>
  array.includes(value) || array.includes(`${value}`);
