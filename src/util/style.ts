import { blue, bold, gray, green, magenta, red, yellow } from "kolorist";

export const styleString = (s: unknown): string => green(`'${s}'`);
export const styleKeyword = (s: unknown): string => blue(`${s}`);
export const styleJson = (s: unknown): string => gray(JSON.stringify(s));
export const styleStringArray = (a: unknown[]): string => `[ ${a.map(styleString).join(", ")} ]`;
export const styleNumber = (n: unknown): string => yellow(`${n}`);
export const styleBoolean = (b: unknown): string => yellow(b ? "true" : "false");
export const styleDate = (d: Date): string => magenta(d.toISOString());

export const styleVal = (n: unknown): string => yellow(`${n}`);
export const styleGet = (n: unknown): string => bold(green(`${n}`));
export const styleUpd = (n: unknown): string => bold(yellow(`${n}`));
export const styleSet = (n: unknown): string => bold(red(`${n}`));
