import { blue, bold, gray, green, magenta, red, yellow } from "kolorist";

type Stringable = string | number | boolean | null | undefined;

export const chalkString = (s: Stringable): string => green(`'${s}'`);
export const chalkKeyword = (s: Stringable): string => blue(`${s}`);
export const chalkJson = (s: unknown): string => gray(JSON.stringify(s));
export const chalkStringArray = (a: Stringable[]): string => `[ ${a.map(chalkString).join(", ")} ]`;
export const chalkNumber = (n: Stringable): string => yellow(`${n}`);
export const chalkBoolean = (b: Stringable): string => yellow(b ? "true" : "false");
export const chalkDate = (d: Date): string => magenta(d.toISOString());

export const chalkVal = (n: Stringable): string => yellow(`${n}`);
export const chalkGet = (n: Stringable): string => bold(green(`${n}`));
export const chalkUpd = (n: Stringable): string => bold(yellow(`${n}`));
export const chalkSet = (n: Stringable): string => bold(red(`${n}`));
