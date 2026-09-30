import { describe, expect, it } from "vitest";

import type { Account, Currency } from "../../api/client";
import {
  buildRows,
  formatProblem,
  inverseText,
  latestEcbDate,
  preview,
  rateText,
} from "./currencyList";

const cur = (id: number, isoCode: string, extra: Partial<Currency> = {}): Currency => ({
  id,
  isoCode,
  name: isoCode,
  symbol: "",
  symbolPrefix: false,
  decimalChar: ",",
  groupChar: ".",
  fracDigits: 2,
  isBase: false,
  rate: 1,
  ...extra,
});

const eur = cur(1, "EUR", { symbol: "€", isBase: true });
const usd = cur(2, "USD", {
  symbol: "$",
  symbolPrefix: true,
  decimalChar: ".",
  groupChar: ",",
  rate: 0.88066,
  rateSource: "frankfurter",
  rateDate: "2026-09-29",
});
const aed = cur(3, "AED", { rate: 0.2331, rateSource: "manual", rateDate: "2026-09-30" });
const chf = cur(4, "CHF", { rate: 1 });

const acc = (id: number, currencyId: number) => ({ id, currencyId }) as Account;

describe("buildRows", () => {
  const rows = buildRows([usd, chf, eur, aed], [acc(1, 1), acc(2, 1), acc(3, 2)]);

  it("puts the base first, then goes by code", () => {
    expect(rows.map((r) => r.currency.isoCode)).toEqual(["EUR", "AED", "CHF", "USD"]);
  });

  it("counts the accounts kept in each", () => {
    expect(rows.map((r) => r.accounts)).toEqual([2, 0, 0, 1]);
  });

  it("says where each rate came from", () => {
    expect(rows.map((r) => r.origin)).toEqual(["base", "manual", "none", "ecb"]);
  });

  it("finds the latest ECB date", () => {
    expect(latestEcbDate(rows)).toBe("2026-09-29");
    expect(latestEcbDate(buildRows([eur, aed], []))).toBeNull();
  });
});

// The symbols are set apart with Unicode isolates; the tests read past them.
const plain = (s: string) => s.replace(/[\u2068\u2069]/g, "");

describe("rate words", () => {
  it("writes a rate and its inverse with the base's separators", () => {
    expect(plain(rateText(usd, eur))).toBe("1 $ = 0,8807 €");
    expect(plain(inverseText(usd.rate, usd, eur))).toBe("1 € = 1,1355 $");
    expect(plain(rateText(chf, eur))).toBe("1 CHF = 1,0000 €");
  });

  it("sets a right-to-left symbol apart", () => {
    expect(rateText(cur(5, "AED", { symbol: "د.إ", rate: 0.2331 }), eur)).toBe(
      "1 \u2068د.إ\u2069 = 0,2331 \u2068€\u2069",
    );
  });

  it("has no inverse for a rate of zero", () => {
    expect(inverseText(0, usd, eur)).toBe("");
  });
});

describe("format", () => {
  it("previews an amount in the format", () => {
    expect(plain(preview(usd))).toBe("-$1,234.56");
    expect(plain(preview({ ...eur, fracDigits: 0 }))).toBe("-1.235 €");
    expect(plain(preview({ ...eur, fracDigits: 3 }))).toBe("-1.234,560 €");
  });

  it("refuses a format that cannot write an amount", () => {
    expect(formatProblem(eur)).toBeNull();
    expect(formatProblem({ ...eur, groupChar: "" })).toBeNull();
    expect(formatProblem({ ...eur, groupChar: "," })).toBe("same");
    expect(formatProblem({ ...eur, decimalChar: "" })).toBe("mark");
  });
});
