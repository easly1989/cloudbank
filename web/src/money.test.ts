import { describe, expect, it } from "vitest";

import { formatMinor, parseAmountSmart, parseMinor } from "./money";

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

describe("parseAmountSmart", () => {
  it("reads either '.' or ',' as the decimal separator", () => {
    expect(parseAmountSmart("12.40", 2)).toBe(1240);
    expect(parseAmountSmart("12,40", 2)).toBe(1240);
  });
  it("treats the rightmost separator as the decimal, the rest as grouping", () => {
    expect(parseAmountSmart("1.234,56", 2)).toBe(123456);
    expect(parseAmountSmart("1,234.56", 2)).toBe(123456);
    expect(parseAmountSmart("1,234,567.89", 2)).toBe(123456789);
  });
  it("handles plain integers and negatives/parentheses", () => {
    expect(parseAmountSmart("1234", 2)).toBe(123400);
    expect(parseAmountSmart("-12.40", 2)).toBe(-1240);
    expect(parseAmountSmart("(12,40)", 2)).toBe(-1240);
  });
  it("ignores symbols and spaces, rounds extra fractional digits half away", () => {
    expect(parseAmountSmart("€ 12,409", 2)).toBe(1241);
    expect(parseAmountSmart("12.404", 2)).toBe(1240);
  });
  it("respects the currency's fractional digits", () => {
    expect(parseAmountSmart("1.234", 0)).toBe(1234);
    expect(parseAmountSmart("12,4", 3)).toBe(12400);
  });
  it("returns null on no digits", () => {
    expect(parseAmountSmart("", 2)).toBeNull();
    expect(parseAmountSmart("abc", 2)).toBeNull();
  });
});
