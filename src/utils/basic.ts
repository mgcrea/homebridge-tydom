import {xor} from 'lodash';

export const stringIncludes = (array: unknown[], value: string | number): boolean =>
  array.includes(value) || array.includes(`${value}`);

export const sameArrays = (source: unknown[], array: unknown[]): boolean =>
  source.length === array.length && xor(source, array).length === 0;

export const asNumber = (maybeNumber: unknown): number => parseInt(`${maybeNumber}`, 10);

export const waitFor = async (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
