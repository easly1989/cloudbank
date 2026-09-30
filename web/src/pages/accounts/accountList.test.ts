import { describe, expect, it } from "vitest";

import type { Account, Currency } from "../../api/client";
import { belowMinimum, buildGroups, toBase } from "./accountList";

const cur = (
  id: number,
  isoCode: string,
  rate: number,
  isBase = false,
  fracDigits = 2,
): Currency => ({
  id,
  isoCode,
  name: isoCode,
  symbol: isoCode,
  symbolPrefix: false,
  decimalChar: ",",
  groupChar: ".",
  fracDigits,
  isBase,
  rate,
});
const EUR = cur(1, "EUR", 1, true);
const USD = cur(2, "USD", 0.8);
const JPY = cur(3, "JPY", 0.006, false, 0);

let nextId = 1;
const acc = (over: Partial<Account>): Account => ({
  id: nextId++,
  name: "A",
  type: "bank",
  currencyId: EUR.id,
  institution: "",
  number: "",
  initialBalance: 0,
  minimumBalance: 0,
  balance: 0,
  futureBalance: 0,
  reconciledBalance: 0,
  closed: false,
  noSummary: false,
  noBudget: false,
  noReport: false,
  position: 0,
  groupName: "",
  notes: "",
  website: "",
  defaultPaymentMode: 0,
  createdAt: "",
  currencyCode: "EUR",
  currencySymbol: "€",
  currencySymbolPrefix: false,
  currencyDecimalChar: ",",
  currencyGroupChar: ".",
  currencyFracDigits: 2,
  ...over,
});

describe("toBase", () => {
  it("converts at the rate, rescaled for the decimals", () => {
    expect(toBase(10000, USD, EUR)).toBe(8000);
    expect(toBase(1000, JPY, EUR)).toBe(600);
    expect(toBase(1234, EUR, EUR)).toBe(1234);
  });
});

describe("buildGroups", () => {
  const accounts = [
    acc({
      name: "Card",
      type: "creditcard",
      balance: -5000,
      futureBalance: -6000,
      reconciledBalance: -4000,
    }),
    acc({
      name: "Checking",
      type: "bank",
      balance: 10000,
      futureBalance: 9000,
      reconciledBalance: 8000,
    }),
    acc({
      name: "Dollars",
      type: "bank",
      currencyId: USD.id,
      balance: 10000,
      futureBalance: 10000,
      reconciledBalance: 10000,
    }),
    acc({
      name: "Old",
      type: "cash",
      balance: 500,
      futureBalance: 500,
      reconciledBalance: 500,
      closed: true,
    }),
    acc({
      name: "Pension",
      type: "asset",
      balance: 70000,
      futureBalance: 70000,
      reconciledBalance: 70000,
      noSummary: true,
    }),
  ];

  it("groups by type in order, subtotals in the base currency", () => {
    const g = buildGroups(accounts, [EUR, USD], false);
    expect(g.groups.map((x) => x.type)).toEqual(["bank", "creditcard", "asset"]);
    expect(g.groups[0].subtotal).toEqual({ reconciled: 16000, today: 18000, future: 17000 });
    expect(g.converted).toBe(true);
  });

  it("leaves closed accounts and those left out of the totals uncounted", () => {
    const g = buildGroups(accounts, [EUR, USD], false);
    expect(g.total).toEqual({ reconciled: 12000, today: 13000, future: 11000 });
    expect(g.counted).toBe(3);
    // Shown, not counted.
    expect(g.groups[2].accounts.map((a) => a.name)).toEqual(["Pension"]);
    expect(g.groups[2].subtotal.today).toBe(0);
  });

  it("shows closed accounts only when asked, still uncounted", () => {
    const g = buildGroups(accounts, [EUR, USD], true);
    expect(g.groups.map((x) => x.type)).toContain("cash");
    expect(g.counted).toBe(3);
  });
});

describe("belowMinimum", () => {
  it("warns only under a minimum that is set", () => {
    expect(belowMinimum(acc({ balance: -100, minimumBalance: 0 }))).toBe(false);
    expect(belowMinimum(acc({ balance: 400, minimumBalance: 500 }))).toBe(true);
    expect(belowMinimum(acc({ balance: -200, minimumBalance: -100 }))).toBe(true);
  });
});
