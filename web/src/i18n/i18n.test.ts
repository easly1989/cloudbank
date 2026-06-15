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
