import { describe, expect, it } from "vitest";

import { asTitle } from "./dates";

describe("asTitle", () => {
  it("raises only the first letter of a month name", () => {
    expect(asTitle("octubre de 2026", "es")).toBe("Octubre de 2026");
    expect(asTitle("outubro de 2026", "pt-BR")).toBe("Outubro de 2026");
    expect(asTitle("ottobre 2026", "it")).toBe("Ottobre 2026");
    expect(asTitle("October 2026", "en")).toBe("October 2026");
    expect(asTitle("", "en")).toBe("");
  });
});
