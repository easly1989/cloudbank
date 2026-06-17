import { describe, expect, it } from "vitest";

import type { Category, RegisterRow } from "../api/client";
import {
  applyFilters,
  dateBounds,
  emptyFilters,
  filtersToParams,
  parseFilters,
  type Filters,
} from "./registerFilters";

function row(p: Partial<RegisterRow>): RegisterRow {
  return {
    id: 1,
    accountId: 1,
    date: "2026-03-15",
    amount: -1000,
    paymentMode: 0,
    status: 0,
    info: "",
    memo: "",
    isSplit: false,
    tags: [],
    runningBalance: 0,
    createdAt: "",
    updatedAt: "",
    ...p,
  };
}

const categories: Category[] = [
  { id: 10, name: "Food", isIncome: false, noBudget: false },
  { id: 11, parentId: 10, name: "Groceries", isIncome: false, noBudget: false },
  { id: 20, name: "Car", isIncome: false, noBudget: false },
];

describe("applyFilters", () => {
  const rows = [
    row({ id: 1, date: "2026-03-15", amount: -1000, categoryId: 11, payeeId: 5, tags: ["a"] }),
    row({ id: 2, date: "2026-03-20", amount: -5000, categoryId: 20, memo: "tyres" }),
    row({ id: 3, date: "2026-01-01", amount: 9000, status: 2, tags: ["b"] }),
  ];

  it("filters by category including children", () => {
    const f: Filters = { ...emptyFilters, categoryId: 10 };
    expect(applyFilters(rows, f, categories).map((r) => r.id)).toEqual([1]);
  });

  it("combines filters with AND", () => {
    const f: Filters = {
      ...emptyFilters,
      preset: "custom",
      from: "2026-03-01",
      to: "2026-03-31",
      amountMax: -2000,
    };
    expect(applyFilters(rows, f, categories).map((r) => r.id)).toEqual([2]);
  });

  it("matches text across memo/payee/category", () => {
    expect(
      applyFilters(rows, { ...emptyFilters, text: "tyres" }, categories).map((r) => r.id),
    ).toEqual([2]);
  });

  it("matches any selected tag", () => {
    expect(
      applyFilters(rows, { ...emptyFilters, tags: ["b"] }, categories).map((r) => r.id),
    ).toEqual([3]);
  });

  it("filters by status", () => {
    expect(applyFilters(rows, { ...emptyFilters, status: 2 }, categories).map((r) => r.id)).toEqual(
      [3],
    );
  });
});

describe("dateBounds", () => {
  it("computes this-month bounds", () => {
    const b = dateBounds(
      { ...emptyFilters, preset: "thisMonth" },
      new Date("2026-03-15T12:00:00Z"),
    );
    expect(b).toEqual({ from: "2026-03-01", to: "2026-03-31" });
  });
  it("computes this-quarter bounds", () => {
    const b = dateBounds(
      { ...emptyFilters, preset: "thisQuarter" },
      new Date("2026-03-15T12:00:00Z"),
    );
    expect(b).toEqual({ from: "2026-01-01", to: "2026-03-31" });
  });
});

describe("URL round-trip", () => {
  it("serializes and parses back to the same filters", () => {
    const f: Filters = {
      preset: "custom",
      from: "2026-01-01",
      to: "2026-02-01",
      status: 1,
      payeeId: 7,
      categoryId: 10,
      tags: ["x", "y"],
      amountMin: -5000,
      amountMax: 5000,
      text: "rent",
    };
    const round = parseFilters(new URLSearchParams(filtersToParams(f)));
    expect(round).toEqual(f);
  });

  it("omits default keys", () => {
    expect(filtersToParams(emptyFilters)).toEqual({});
  });
});
