import { describe, expect, it } from "vitest";

import {
  correctionUrl,
  languageOf,
  languages,
  normalizeLanguage,
  orderedLanguages,
  type Language,
} from "./languages";

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
    expect(normalizeLanguage("nl-NL")).toBeUndefined();
    expect(languageOf("nl-NL").code).toBe("en");
    expect(languageOf("it-CH").code).toBe("it");
    expect(languageOf("pt-PT").code).toBe("pt-BR");
  });
});

describe("the selectors' order and the corrections link", () => {
  const row = (code: string, name: string, beta: boolean): Language => ({
    code,
    name,
    beta,
    weekStart: 1,
    correction: beta ? `Fix ${code}` : undefined,
  });

  it("puts the complete languages first, then the beta ones by their own name", () => {
    const list = [
      row("en", "English", false),
      row("pt-BR", "Português (Brasil)", true),
      row("it", "Italiano", false),
      row("fr", "Français", true),
      row("de", "Deutsch", true),
      row("es", "Español", true),
    ];
    expect(orderedLanguages(list).map((l) => l.code)).toEqual([
      "en",
      "it",
      "de",
      "es",
      "fr",
      "pt-BR",
    ]);
  });

  it("opens the translation form with the language chosen and the title started", () => {
    expect(correctionUrl("de")).toBe(
      "https://github.com/easly1989/cloudbank/issues/new?template=translation.yml&language=de&title=%5Bde%5D%20",
    );
    const url = new URL(correctionUrl("pt-BR"));
    expect(url.searchParams.get("template")).toBe("translation.yml");
    expect(url.searchParams.get("language")).toBe("pt-BR");
    expect(url.searchParams.get("title")).toBe("[pt-BR] ");
  });

  it("gives every beta language its invitation to correct it", () => {
    for (const l of languages as readonly Language[]) {
      if (l.beta) expect(l.correction, l.code).toBeTruthy();
    }
  });
});
