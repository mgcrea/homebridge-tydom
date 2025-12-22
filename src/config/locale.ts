import { HOMEBRIDGE_TYDOM_LOCALE } from "./env";
import en from "./i18n/en";
import fr from "./i18n/fr";

export const locales = { en, fr };
const locale = locales[HOMEBRIDGE_TYDOM_LOCALE as "en" | "fr"];
export default locale;
