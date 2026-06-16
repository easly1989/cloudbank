import { describe, expect, it } from "vitest";

import { formatMinor, parseMinor } from "./money";

describe("formatMinor", () => {
  it("formats with prefix symbol and grouping", () => {
    expect(
      formatMinor(123450, {
        fracDigits: 2,
        decimalChar: ".",
        groupChar: ",",
        symbol: "$",
        symbolPrefix: true,
      }),
    ).toBe("$1,234.50");
  });
  it("formats euro suffix with it-IT separators", () => {
    expect(
      formatMinor(123450, {
        fracDigits: 2,
        decimalChar: ",",
        groupChar: ".",
        symbol: "€",
        symbolPrefix: false,
      }),
    ).toBe("1.234,50 €");
  });
  it("formats a negative amount", () => {
    expect(
      formatMinor(-99, {
        fracDigits: 2,
        decimalChar: ".",
        groupChar: ",",
        symbol: "$",
        symbolPrefix: true,
      }),
    ).toBe("-$0.99");
  });
});

describe("parseMinor", () => {
  it("parses plain and grouped amounts", () => {
    expect(parseMinor("1,234.50", 2, ".")).toBe(123450);
    expect(parseMinor("1.234,50", 2, ",")).toBe(123450);
    expect(parseMinor("$1,234.50", 2, ".")).toBe(123450);
  });
  it("parses the user's example 120,40", () => {
    expect(parseMinor("120,40", 2, ",")).toBe(12040);
    expect(parseMinor("11,00", 2, ",")).toBe(1100);
  });
  it("rounds extra fractional digits half away", () => {
    expect(parseMinor("1.235", 2, ".")).toBe(124);
    expect(parseMinor("1.234", 2, ".")).toBe(123);
  });
  it("returns null on no digits", () => {
    expect(parseMinor("", 2, ".")).toBeNull();
    expect(parseMinor("abc", 2, ".")).toBeNull();
  });
});
