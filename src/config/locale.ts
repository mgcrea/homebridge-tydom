import type { TydomLocale } from "../config.js";
import en from "./i18n/en.js";
import fr from "./i18n/fr.js";

export const locales = { en, fr };

/**
 * The label tables are not key-identical — `en` is missing fourteen keys `fr`
 * has — and lookups are dynamic anyway: `nameStd` coming back from an alarm can
 * be any Delta Dore key. So this is a string map with a runtime fallback rather
 * than a union of the two shapes.
 */
export type LocaleTable = Record<string, string>;

/**
 * The active label table.
 *
 * Transitional: the three accessories that need labels still reach for this
 * module directly, so the platform sets it once at construction. It replaces a
 * binding resolved at *import* time from `HOMEBRIDGE_TYDOM_LOCALE` alone, which
 * meant a `locale` set in config.json could never have taken effect, and made
 * the choice untestable.
 *
 * Phase 6 injects a translator through AccessoryDeps and this goes away.
 */
let active: LocaleTable = fr;

export const setLocale = (locale: TydomLocale): void => {
  active = locales[locale];
};

export const getLocale = (): LocaleTable => active;

/**
 * Kept as a default export for the accessories that still import it.
 *
 * A Proxy rather than the table itself, because those imports are evaluated
 * before the platform constructor runs — a plain re-export would capture the
 * default table forever.
 */
export default new Proxy({} as LocaleTable, {
  get: (_target, prop: string) => active[prop as keyof LocaleTable],
  has: (_target, prop: string) => prop in active,
  ownKeys: () => Reflect.ownKeys(active),
  getOwnPropertyDescriptor: (_target, prop) => ({
    ...Reflect.getOwnPropertyDescriptor(active, prop),
    configurable: true,
    enumerable: true,
  }),
});
