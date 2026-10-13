import { describe, expect, it } from "vitest";

import i18n, { i18nReady, supportedLanguages, withMany } from "./index";

const files = import.meta.glob<Record<string, unknown>>("./locales/*.json", {
  eager: true,
  import: "default",
});
const file = (lng: string) => files[`./locales/${lng}.json`];

// Recursively collect dotted key paths from a nested object.
function keyPaths(obj: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) => {
    const path = prefix ? `${prefix}.${k}` : k;
    return typeof v === "object" && v !== null
      ? keyPaths(v as Record<string, unknown>, path)
      : [path];
  });
}

describe("i18n locales", () => {
  it("define the same keys across every language", () => {
    const reference = keyPaths(file("en")).sort();
    for (const lng of supportedLanguages) {
      const keys = keyPaths(file(lng)).sort();
      expect(keys, `locale ${lng} key set`).toEqual(reference);
    }
  });
});

// The register's "hidden newer rows" notice is the first string in the app to
// use i18next plurals, so pin that it actually resolves: a missing _one form
// silently renders the key itself, which the key-parity test above would not
// catch. Every language but English is loaded on demand here, as in the app.
describe("plurals", () => {
  it("picks the singular and the plural form in every language", async () => {
    await i18nReady;
    for (const lng of supportedLanguages) {
      await i18n.changeLanguage(lng);
      const one = i18n.t("register.hiddenNewer.title", { count: 1 });
      const many = i18n.t("register.hiddenNewer.title", { count: 3 });
      expect(one, `${lng} singular`).toContain("1");
      expect(many, `${lng} plural`).toContain("3");
      expect(one, `${lng} forms differ`).not.toEqual(many);
      expect(one).not.toContain("hiddenNewer");
    }
    await i18n.changeLanguage("en");
  });

  // Italian calls a round million "many"; without its own form it fell back
  // to English (#608).
  it("reads a million in the language on the page", async () => {
    await i18nReady;
    await i18n.changeLanguage("it");
    const million = i18n.t("register.hiddenNewer.title", { count: 1000000 });
    expect(million).toBe(
      i18n.t("register.hiddenNewer.title", { count: 3 }).replace("3", "1000000"),
    );
    await i18n.changeLanguage("en");
  });

  it("fills a missing _many from _other, and keeps one that is there", () => {
    const tree = withMany({ a: { n_one: "1", n_other: "x" }, m_other: "y", m_many: "z" });
    expect(tree).toEqual({
      a: { n_one: "1", n_other: "x", n_many: "x" },
      m_other: "y",
      m_many: "z",
    });
  });
});

describe("<html lang>", () => {
  it("follows the app's language", async () => {
    await i18nReady;
    await i18n.changeLanguage("it");
    expect(document.documentElement.lang).toBe("it");
    await i18n.changeLanguage("en");
    expect(document.documentElement.lang).toBe("en");
  });
});
