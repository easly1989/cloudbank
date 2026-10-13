import { useMemo } from "react";
import { useTranslation } from "react-i18next";

/** Each language's name in the language the app is showing: "tedesco" for de. */
export function useLanguageNames(): (code: string) => string {
  const { i18n } = useTranslation();
  return useMemo(() => {
    const names = new Intl.DisplayNames([i18n.language], { type: "language" });
    return (code: string) => names.of(code) ?? code;
  }, [i18n.language]);
}
