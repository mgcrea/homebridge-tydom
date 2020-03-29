import {HOMEBRIDGE_TYDOM_LOCALE} from './env';
import fr from './i18n/fr';
import en from './i18n/en';

export const locales = {en, fr};
const locale = locales[HOMEBRIDGE_TYDOM_LOCALE as 'en' | 'fr'];
export default locale;
