import { describe, expect, it } from "vitest";

import type { BudgetReport, Category } from "../../api/client";
import {
  daysLeft,
  historyStats,
  isOver,
  lastTwelve,
  leftOf,
  paceOf,
  paceVerdict,
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
    oncePerMonth: false,
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

describe("paceVerdict", () => {
  const line = { plan: 10000, spent: 3000, coming: 0, income: false };
  it("says how much of the plan has gone, against the share of the period (#625)", () => {
    expect(paceVerdict(line, 0.42)).toEqual({ kind: "under", spentPct: 30, pacePct: 42 });
    expect(paceVerdict({ ...line, spent: 6000 }, 0.42)).toEqual({
      kind: "ahead",
      spentPct: 60,
      pacePct: 42,
    });
  });
  it("past the plan, says by how much", () => {
    expect(paceVerdict({ ...line, spent: 12500 }, 0.42)).toEqual({
      kind: "past",
      spentPct: 125,
      pacePct: 42,
      past: 2500,
    });
  });
  it("on the pace exactly is not ahead of it", () => {
    expect(paceVerdict({ ...line, spent: 4200 }, 0.42).kind).toBe("under");
  });
  it("income only says how much has come in", () => {
    expect(paceVerdict({ ...line, income: true }, 0.5)).toEqual({
      kind: "income",
      spentPct: 30,
      pacePct: 50,
    });
  });
});

describe("viewOf and oncePerMonth", () => {
  it("carries the report's oncePerMonth onto the line", () => {
    const report = {
      rows: [
        {
          categoryId: 1,
          name: "Rent",
          isIncome: false,
          budgeted: true,
          budget: -80000,
          actual: -80000,
          coming: 0,
          oncePerMonth: true,
        },
      ],
      totalBudget: -80000,
      totalActual: -80000,
      totalComing: 0,
      from: "2026-10-01",
      to: "2026-10-31",
      today: "2026-10-13",
      currency: null,
    } satisfies BudgetReport;
    expect(viewOf(report, []).spending[0].oncePerMonth).toBe(true);
  });
});
