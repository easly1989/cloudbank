import { describe, expect, it } from "vitest";

import type { BudgetReportRow } from "../../api/client";
import { buildAttentionItems, countOverBudget, monthRange } from "./attention";

const none = { needsCategory: 0, overdueBills: 0, overBudget: 0, duplicates: 0 };

describe("buildAttentionItems", () => {
  it("says nothing when there is nothing to do", () => {
    expect(buildAttentionItems(none)).toEqual([]);
  });

  it("leaves out whatever is at zero", () => {
    const items = buildAttentionItems({ ...none, needsCategory: 3, duplicates: 1 });
    expect(items.map((i) => i.key)).toEqual(["needsCategory", "duplicates"]);
  });

  it("puts the most actionable first", () => {
    const items = buildAttentionItems({
      needsCategory: 1,
      overdueBills: 2,
      overBudget: 3,
      duplicates: 4,
    });
    expect(items.map((i) => i.key)).toEqual([
      "needsCategory",
      "overdueBills",
      "overBudget",
      "duplicates",
    ]);
  });

  it("sends each line somewhere it can be fixed", () => {
    const items = buildAttentionItems({ ...none, overdueBills: 1, overBudget: 1 });
    expect(items.map((i) => i.to)).toEqual(["/bills", "/budget"]);
  });
});

describe("countOverBudget", () => {
  const row = (over: Partial<BudgetReportRow>) =>
    ({
      categoryId: 1,
      name: "x",
      isIncome: false,
      budget: 100,
      actual: 0,
      ...over,
    }) as BudgetReportRow;

  it("counts a category that has gone past its budget", () => {
    expect(countOverBudget([row({ actual: 150 })])).toBe(1);
    expect(countOverBudget([row({ actual: 100 })])).toBe(0);
  });

  it("ignores income: earning more than planned is not a problem", () => {
    expect(countOverBudget([row({ isIncome: true, actual: 9999 })])).toBe(0);
  });

  it("ignores a category with no budget set", () => {
    // You cannot overspend a budget that does not exist, and counting these
    // would drag every unbudgeted corner of the wallet into the warning.
    expect(countOverBudget([row({ budget: 0, actual: 500 })])).toBe(0);
  });

  it("handles missing data", () => {
    expect(countOverBudget(undefined)).toBe(0);
    expect(countOverBudget([])).toBe(0);
  });
});

describe("monthRange", () => {
  it("covers the whole month the date falls in", () => {
    expect(monthRange(new Date(2026, 1, 15))).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(monthRange(new Date(2026, 0, 31))).toEqual({ from: "2026-01-01", to: "2026-01-31" });
  });

  it("gets the length of the month right, leap years included", () => {
    expect(monthRange(new Date(2028, 1, 10)).to).toBe("2028-02-29");
    expect(monthRange(new Date(2026, 3, 10)).to).toBe("2026-04-30");
  });

  it("uses the local calendar, not UTC", () => {
    // Just after local midnight on the first: a UTC-derived range would start
    // this window in the previous month.
    expect(monthRange(new Date(2026, 5, 1, 0, 30)).from).toBe("2026-06-01");
  });
});
