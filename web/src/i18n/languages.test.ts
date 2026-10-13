import { describe, expect, it } from "vitest";

import { languageOf, languages, normalizeLanguage } from "./languages";

// Every translation file, read from disk: a row without its file, or a file
// without its row, fails here (the server has the same test for internal/locale).
const files = Object.keys(import.meta.glob("./locales/*.json")).map((p) =>
  p.replace("./locales/", "").replace(".json", ""),
);

describe("the languages list", () => {
  it("matches the translation files", () => {
    expect(languages.map((l) => l.code).sort()).toEqual([...files].sort());
  });

  it("reads browser variants as the language CloudBank speaks", () => {
    // The six languages of 3.8.0, so the variants are checked before they ship.
    const six = ["en", "it", "es", "fr", "de", "pt-BR"].map((code) => ({ code }));
    const cases: Record<string, string | undefined> = {
      it: "it",
      "it-CH": "it",
      IT_it: "it",
      "en-GB": "en",
      "es-MX": "es",
      "fr-CA": "fr",
      "de-AT": "de",
      "pt-br": "pt-BR",
      "pt-PT": "pt-BR",
      pt: "pt-BR",
      xx: undefined,
      "": undefined,
      italic: undefined,
    };
    for (const [tag, want] of Object.entries(cases)) {
      expect(normalizeLanguage(tag, six), tag).toBe(want);
    }
  });

  it("opens in English for a language it does not speak yet", () => {
    expect(normalizeLanguage("pt-PT")).toBeUndefined();
    expect(languageOf("pt-PT").code).toBe("en");
    expect(languageOf("it-CH").code).toBe("it");
  });
});
