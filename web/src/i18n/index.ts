import i18n, { type BackendModule, type ResourceKey } from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";

import { DEFAULT_LANGUAGE, languages, normalizeLanguage, type LanguageCode } from "./languages";
import en from "./locales/en.json";

type Tree = { [key: string]: string | Tree };

/**
 * Gives every plural without a `_many` form one, copied from its `_other`.
 * Italian, Spanish, French and Portuguese use "many" for round millions, and a
 * missing form falls back to English: "1000000 accounts" on an Italian page.
 * The files leave it out (it reads the same as `_other` in all of them), so it
 * is filled in when a language loads.
 */
export function withMany<T extends Tree>(tree: T): T {
  const out: Tree = {};
  for (const [key, value] of Object.entries(tree)) {
    out[key] = typeof value === "string" ? value : withMany(value);
  }
  for (const [key, value] of Object.entries(tree)) {
    if (!key.endsWith("_other")) continue;
    const many = `${key.slice(0, -"_other".length)}_many`;
    if (!(many in out)) out[many] = value;
  }
  return out as T;
}

// Every language but English is a file of its own, fetched the first time it
// is used (the service worker keeps it for offline use afterwards). English is
// in the bundle: it is the fallback, so it must be there before anything else.
const loaders = import.meta.glob<{ default: Tree }>(["./locales/*.json", "!./locales/en.json"]);

const lazyLocales: BackendModule = {
  type: "backend",
  init() {},
  read(lng, _ns, done) {
    const load = loaders[`./locales/${lng}.json`];
    if (!load) {
      done(null, {});
      return;
    }
    load().then(
      (m) => done(null, withMany(m.default) as ResourceKey),
      (err: unknown) => done(err instanceof Error ? err : new Error(String(err)), null),
    );
  },
};

export const supportedLanguages = languages.map((l) => l.code);
export type SupportedLanguage = LanguageCode;

// <html lang> follows the app, for screen readers, hyphenation and the
// browser's own translate offer.
i18n.on("languageChanged", (lng) => {
  document.documentElement.lang = lng;
});

/** Settles once the first language is loaded: main.tsx renders after it. */
export const i18nReady = i18n
  .use(lazyLocales)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { en: { translation: withMany(en) } },
    partialBundledLanguages: true,
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
    // The first language is loaded before the first render, and a switch
    // loads the new one before showing it, so nothing waits on a suspense.
    react: { useSuspense: false },
  });

export default i18n;
