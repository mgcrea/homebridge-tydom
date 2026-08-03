import en from "./en.json" with { type: "json" };
import fr from "./fr.json" with { type: "json" };

/**
 * The Delta Dore label tables, as data.
 *
 * These are 2050 lines of `KEY: "Label"` pairs — a third of the repository — and
 * they were TypeScript modules, so every one of those lines was linted,
 * formatted and type-checked to establish that a string is a string. As JSON
 * they are inert.
 *
 * The two tables are deliberately *not* keyed identically (`fr` has fourteen
 * keys `en` lacks) and lookups are dynamic anyway: the `nameStd` an alarm
 * reports can be any key Delta Dore ships. So this is a string map with a
 * runtime fallback, not a union of the two shapes — and the tables cannot be
 * trimmed to the keys we happen to use today.
 */
export type LocaleTable = Record<string, string>;

export type Locale = "en" | "fr";

const TABLES: Record<Locale, LocaleTable> = { en, fr };

/**
 * Look a label up, falling back when the table does not have it.
 *
 * `"N/A"` is the historical default and is what users see in the Home app for
 * an unknown key, so it stays the default here.
 */
export type Translator = (key: string, fallback?: string) => string;

export const createTranslator = (locale: Locale): Translator => {
  const table = TABLES[locale];
  // `hasOwn`, not a plain lookup: keys come off the wire, and `nameStd` of
  // "constructor" would otherwise resolve up the prototype chain and get
  // stringified into a HomeKit service name.
  return (key, fallback = "N/A") =>
    Object.hasOwn(table, key) ? (table[key] ?? fallback) : fallback;
};
