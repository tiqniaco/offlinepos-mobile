/**
 * i18next setup. Arabic is the default and RTL; English is second (LTR).
 * Changing language changes layout direction, which needs an app reload (React Native rule).
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { I18nManager } from 'react-native';
import * as Updates from 'expo-updates';
import ar from './ar.json';
import en from './en.json';

export type Lang = 'ar' | 'en';

export function initI18n(lang: Lang = 'ar') {
  if (!i18n.isInitialized) {
    void i18n.use(initReactI18next).init({
      resources: { ar: { translation: ar }, en: { translation: en } },
      lng: lang,
      fallbackLng: 'ar',
      interpolation: { escapeValue: false },
      returnNull: false,
    });
  } else if (i18n.language !== lang) {
    void i18n.changeLanguage(lang);
  }
  return i18n;
}

/** Make layout direction match the language. Returns true if a reload was triggered. */
export async function ensureDirection(lang: Lang): Promise<boolean> {
  const rtl = lang === 'ar';
  if (I18nManager.isRTL === rtl) return false;
  I18nManager.allowRTL(rtl);
  I18nManager.forceRTL(rtl);
  try {
    await Updates.reloadAsync();
    return true;
  } catch {
    // In development (no expo-updates runtime) the change applies on next app start.
    return false;
  }
}

export default i18n;
