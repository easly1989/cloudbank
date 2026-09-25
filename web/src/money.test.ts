import { describe, expect, it } from "vitest";

import {
  formatAxisMinor,
  formatMinor,
  type MoneyFormat,
  parseAmountSmart,
  parseMinor,
} from "./money";

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

describe("formatAxisMinor", () => {
  const eur: MoneyFormat = {
    fracDigits: 2,
    decimalChar: ",",
    groupChar: ".",
    symbol: "€",
    symbolPrefix: false,
  };
  const usd: MoneyFormat = {
    ...eur,
    decimalChar: ".",
    groupChar: ",",
    symbol: "$",
    symbolPrefix: true,
  };

  it("shows a whole tick in major units, without cents", () => {
    // The dashboard's axis read 230,000 for a month of 2.300 € (#477).
    expect(formatAxisMinor(230000, eur)).toBe("2.300 €");
    expect(formatAxisMinor(-100000, eur)).toBe("-1.000 €");
    expect(formatAxisMinor(0, eur)).toBe("0 €");
    expect(formatAxisMinor(150000, usd)).toBe("$1,500");
  });

  it("keeps the decimals when a tick is not a whole unit", () => {
    expect(formatAxisMinor(1250, eur)).toBe("12,50 €");
    expect(formatAxisMinor(-50, usd)).toBe("-$0.50");
  });

  it("rounds the float noise ECharts can put on a tick", () => {
    expect(formatAxisMinor(99999.99999, eur)).toBe("1.000 €");
  });

  it("handles a currency with no minor unit", () => {
    const jpy: MoneyFormat = { ...usd, fracDigits: 0, symbol: "¥" };
    expect(formatAxisMinor(1500, jpy)).toBe("¥1,500");
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
