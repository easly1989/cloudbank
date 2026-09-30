import { describe, expect, it } from "vitest";

import type { Category, Payee, PayeeActivity } from "../../api/client";
import {
  arrange,
  buildRows,
  categoryLabel,
  DEFAULT_SORT,
  firstDirection,
  worthSuggesting,
} from "./payeeList";

const cat = (id: number, name: string, parentId: number | null = null): Category => ({
  id,
  name,
  parentId,
  isIncome: false,
  noBudget: false,
  noReport: false,
});
const categories = [cat(1, "Food"), cat(2, "Groceries", 1), cat(3, "Salary")];

const payees: Payee[] = [
  { id: 10, name: "Supermarket" },
  { id: 11, name: "Employer", defaultCategoryId: 3 },
  { id: 12, name: "Café" },
  { id: 13, name: "Bookshop" },
];

const act = (
  payeeId: number,
  count: number,
  amount: number,
  extra: Partial<PayeeActivity> = {},
): PayeeActivity => ({
  payeeId,
  count,
  amount,
  lastDate: "2026-09-01",
  usualCategoryCount: 0,
  categorisedCount: 0,
  ...extra,
});

const activity = [
  act(10, 72, -460572, {
    usualCategoryId: 2,
    usualCategoryCount: 60,
    categorisedCount: 70,
    usualPaymentMode: 6,
    lastDate: "2026-09-29",
  }),
  act(11, 13, 3020000, { usualCategoryId: 3, usualCategoryCount: 13, categorisedCount: 13 }),
  // Split across many: nothing holds half.
  act(12, 48, -15220, {
    usualCategoryId: 2,
    usualCategoryCount: 20,
    categorisedCount: 48,
    lastDate: "2026-09-23",
  }),
];

describe("buildRows", () => {
  const rows = buildRows(payees, activity, categories);
  const by = (name: string) => rows.find((r) => r.payee.name === name)!;

  it("suggests the usual category only while there is no default and it holds half", () => {
    expect(by("Supermarket").suggested?.name).toBe("Groceries");
    expect(by("Supermarket").suggestedCount).toBe(60);
    expect(by("Employer").defaultCategory?.name).toBe("Salary");
    expect(by("Employer").suggested).toBeNull();
    expect(by("Café").suggested).toBeNull();
  });

  it("leaves a payee with no transactions empty", () => {
    expect(by("Bookshop")).toMatchObject({
      count: 0,
      amount: 0,
      lastDate: null,
      usualPaymentMode: null,
    });
  });

  it("keeps the usual payment mode", () => {
    expect(by("Supermarket").usualPaymentMode).toBe(6);
  });
});

describe("worthSuggesting", () => {
  it("needs at least half of the categorised transactions", () => {
    expect(
      worthSuggesting(
        act(1, 4, 0, { usualCategoryId: 2, usualCategoryCount: 2, categorisedCount: 4 }),
      ),
    ).toBe(true);
    expect(
      worthSuggesting(
        act(1, 4, 0, { usualCategoryId: 2, usualCategoryCount: 1, categorisedCount: 3 }),
      ),
    ).toBe(false);
    expect(worthSuggesting(act(1, 4, 0))).toBe(false);
  });
});

describe("arrange", () => {
  const rows = buildRows(payees, activity, categories);
  const names = (rs: typeof rows) => rs.map((r) => r.payee.name);
  const all = { query: "", noDefault: false, unusedOnly: false };

  it("goes by amount by default, the largest first, whatever the sign", () => {
    expect(names(arrange(rows, all, DEFAULT_SORT))).toEqual([
      "Employer",
      "Supermarket",
      "Café",
      "Bookshop",
    ]);
  });

  it("sorts by name, count and last use, and turns each around", () => {
    expect(names(arrange(rows, all, firstDirection("name")))).toEqual([
      "Bookshop",
      "Café",
      "Employer",
      "Supermarket",
    ]);
    expect(names(arrange(rows, all, { key: "name", desc: true }))).toEqual([
      "Supermarket",
      "Employer",
      "Café",
      "Bookshop",
    ]);
    expect(names(arrange(rows, all, firstDirection("count")))).toEqual([
      "Supermarket",
      "Café",
      "Employer",
      "Bookshop",
    ]);
    expect(names(arrange(rows, all, firstDirection("last")))[0]).toBe("Supermarket");
    expect(names(arrange(rows, all, { key: "last", desc: false }))[0]).toBe("Bookshop");
  });

  it("filters by name without accents, by missing default and by use", () => {
    expect(names(arrange(rows, { ...all, query: "cafe" }, DEFAULT_SORT))).toEqual(["Café"]);
    expect(names(arrange(rows, { ...all, noDefault: true }, DEFAULT_SORT))).toEqual([
      "Supermarket",
      "Café",
      "Bookshop",
    ]);
    expect(names(arrange(rows, { ...all, unusedOnly: true }, DEFAULT_SORT))).toEqual(["Bookshop"]);
  });
});

describe("categoryLabel", () => {
  it("puts the group before a subcategory", () => {
    expect(categoryLabel(categories[1], categories)).toBe("Food › Groceries");
    expect(categoryLabel(categories[2], categories)).toBe("Salary");
  });
});
