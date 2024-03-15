import {green, blue, gray, yellow, magenta, bold, red} from 'kolorist';

export const chalkString = (s: unknown): string => green(`'${s}'`);
export const chalkKeyword = (s: unknown): string => blue(`${s}`);
export const chalkJson = (s: unknown): string => gray(JSON.stringify(s));
export const chalkStringArray = (a: Array<unknown>): string => `[ ${a.map(chalkString).join(', ')} ]`;
export const chalkNumber = (n: unknown): string => yellow(`${n}`);
export const chalkBoolean = (b: unknown): string => yellow(b ? 'true' : 'false');
export const chalkDate = (d: Date): string => magenta(d.toISOString());

export const chalkVal = (n: unknown): string => yellow(`${n}`);
export const chalkGet = (n: unknown): string => bold(green(`${n}`));
export const chalkUpd = (n: unknown): string => bold(yellow(`${n}`));
export const chalkSet = (n: unknown): string => bold(red(`${n}`));
