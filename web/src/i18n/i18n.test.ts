import { describe, expect, it } from "vitest";

import { resources, supportedLanguages } from "./index";

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
    const reference = keyPaths(resources.en.translation).sort();
    for (const lng of supportedLanguages) {
      const keys = keyPaths(resources[lng].translation).sort();
      expect(keys, `locale ${lng} key set`).toEqual(reference);
    }
  });
});

// The register's "hidden newer rows" notice is the first string in the app to
// use i18next plurals, so pin that it actually resolves: a missing _one form
// silently renders the key itself, which the key-parity test above would not
// catch.
describe("plurals", () => {
  it("picks the singular and the plural form in every language", async () => {
    const i18n = (await import("./index")).default;
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
});
