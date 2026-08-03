import { HOMEBRIDGE_TYDOM_LOCALE } from "./env.js";
import en from "./i18n/en.js";
import fr from "./i18n/fr.js";

export const locales = { en, fr };
const locale = locales[HOMEBRIDGE_TYDOM_LOCALE as "en" | "fr"];
export default locale;
