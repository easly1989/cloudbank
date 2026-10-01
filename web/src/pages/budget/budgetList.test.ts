import { describe, expect, it } from "vitest";

import type { BudgetReport, Category } from "../../api/client";
import {
  daysLeft,
  historyStats,
  isOver,
  lastTwelve,
  leftOf,
  paceOf,
  pathOf,
  periodAt,
  periodOf,
  shiftPeriod,
  viewOf,
} from "./budgetList";

describe("periods", () => {
  it("covers a whole month or a whole year", () => {
    expect(periodAt("month", "2026-02-10")).toMatchObject({ from: "2026-02-01", to: "2026-02-28" });
    expect(periodAt("month", "2028-02-10").to).toBe("2028-02-29");
    expect(periodAt("year", "2026-09-30")).toMatchObject({ from: "2026-01-01", to: "2026-12-31" });
  });
  it("steps across a year's end, and a year view remembers its month", () => {
    expect(shiftPeriod(periodOf("month", 2026, 12), 1)).toMatchObject({ year: 2027, month: 1 });
    expect(shiftPeriod(periodOf("month", 2026, 1), -1)).toMatchObject({ year: 2025, month: 12 });
    expect(shiftPeriod(periodOf("year", 2026, 9), -1)).toMatchObject({ year: 2025, month: 9 });
  });
});

describe("pace and days left", () => {
  const sept = periodOf("month", 2026, 9);
  it("counts today as gone", () => {
    expect(paceOf(sept, "2026-09-15")).toBeCloseTo(0.5);
    expect(paceOf(sept, "2026-09-29")).toBeCloseTo(29 / 30);
    expect(paceOf(sept, "2026-09-30")).toBeNull();
    expect(daysLeft(sept, "2026-09-15")).toBe(15);
    expect(daysLeft(sept, "2026-09-30")).toBe(0);
  });
  it("is nothing outside the period", () => {
    expect(paceOf(sept, "2026-10-01")).toBeNull();
    expect(daysLeft(sept, "2026-08-31")).toBeNull();
  });
});

describe("viewOf", () => {
  const cats = [
    { id: 1, name: "Food" },
    { id: 2, name: "Groceries", parentId: 1 },
    { id: 3, name: "Health" },
    { id: 4, name: "Salary", isIncome: true },
    { id: 5, name: "Clothing" },
    { id: 6, name: "Gifts" },
  ] as Category[];
  const row = (
    categoryId: number,
    budget: number,
    actual: number,
    coming = 0,
    isIncome = false,
  ) => ({
    categoryId,
    name: "",
    isIncome,
    budgeted: budget !== 0,
    budget,
    actual,
    coming,
  });
  const report: BudgetReport = {
    rows: [
      row(2, -38000, -39594, -1000),
      row(5, -6000, -2000),
      row(3, 0, -6479),
      row(6, 0, 1500), // a refund only: not listed
      row(4, 245000, 245000, 245000, true),
    ],
    totalBudget: -44000,
    totalActual: -41594,
    totalComing: -1000,
    from: "2026-09-01",
    to: "2026-09-30",
    today: "2026-09-20",
    currency: null,
  };
  const v = viewOf(report, cats);

  it("reads every line as magnitudes, the path from the categories", () => {
    expect(v.spending.map(pathOf)).toEqual(["Food › Groceries", "Clothing"]);
    expect(v.spending[0]).toMatchObject({ plan: 38000, spent: 38594, coming: 1000 });
    expect(leftOf(v.spending[0])).toBe(-1594);
  });
  it("counts what is coming against the plan", () => {
    expect(v.over).toBe(1);
    expect(isOver(v.spending[1])).toBe(false);
  });
  it("keeps unbudgeted spending apart, and income on its own", () => {
    expect(v.loose.map((l) => l.name)).toEqual(["Health"]);
    expect(v.looseTotal).toBe(6479);
    expect(v.income[0]).toMatchObject({ plan: 245000, spent: 0, coming: 245000 });
    expect(isOver({ ...v.income[0], coming: 999999 })).toBe(false);
  });
  it("totals the budgeted spending only", () => {
    expect(v.total).toEqual({ plan: 44000, spent: 40594, coming: 1000 });
  });
});

describe("history", () => {
  const months = [
    { month: "2025-09", amount: -1000 },
    ...Array.from({ length: 11 }, (_, i) => ({
      month: `20${i < 3 ? "25" : "26"}-${String(((i + 9) % 12) + 1).padStart(2, "0")}`,
      amount: -20000,
    })),
    { month: "2026-09", amount: -500 },
  ];
  it("takes the twelve complete months before this one", () => {
    const last = lastTwelve(months, "2026-09-30");
    expect(last).toHaveLength(12);
    expect(last[0].month).toBe("2025-09");
    expect(last[11].month).toBe("2026-08");
  });
  it("averages, rounds to five, and counts the months over the plan", () => {
    const s = historyStats(
      lastTwelve(months, "2026-09-30"),
      false,
      { mode: "same", same: -19000, monthly: [] },
      2,
    );
    expect(s.total).toBe(221000);
    expect(s.average).toBeCloseTo(18416.67, 1);
    expect(s.suggestion).toBe(18500);
    expect(s.over).toBe(11);
  });
});
