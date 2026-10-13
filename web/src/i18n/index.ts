import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";

import { DEFAULT_LANGUAGE, languages, normalizeLanguage, type LanguageCode } from "./languages";
import en from "./locales/en.json";
import it from "./locales/it.json";

export const resources = {
  en: { translation: en },
  it: { translation: it },
} as const satisfies Record<LanguageCode, unknown>;

export const supportedLanguages = languages.map((l) => l.code);
export type SupportedLanguage = LanguageCode;

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: supportedLanguages,
    interpolation: { escapeValue: false },
    detection: {
      order: ["localStorage", "navigator"],
      caches: ["localStorage"],
      // The browser's it-CH reads Italian, the same way the server reads it;
      // a language CloudBank does not speak passes through and falls back.
      convertDetectedLanguage: (lng) => normalizeLanguage(lng) ?? lng,
    },
  });

export default i18n;
