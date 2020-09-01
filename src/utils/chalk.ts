import chalk from 'chalk';

export const chalkString = (s: unknown): string => chalk.green(`'${s}'`);
export const chalkKeyword = (s: unknown): string => chalk.blue(`${s}`);
export const chalkJson = (s: unknown): string => chalk.grey(JSON.stringify(s));
export const chalkStringArray = (a: Array<unknown>): string => `[ ${a.map(chalkString).join(', ')} ]`;
export const chalkNumber = (n: unknown): string => chalk.yellow(`${n}`);
export const chalkBoolean = (b: unknown): string => chalk.yellow(b ? 'true' : 'false');
export const chalkDate = (d: Date): string => chalk.magenta(d.toISOString());
