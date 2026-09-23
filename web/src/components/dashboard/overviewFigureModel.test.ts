import { describe, expect, it } from "vitest";

import { pickBalances, periodTotals } from "./overviewFigureModel";

describe("pickBalances", () => {
  it("defaults to today alone", () => {
    expect(pickBalances(undefined)).toEqual(["today"]);
    expect(pickBalances([])).toEqual(["today"]);
  });

  // A row of figures with no figures in it is a bug, not a preference.
  it("falls back to today when the saved keys are all unusable", () => {
    expect(pickBalances(["nonsense", "gone"])).toEqual(["today"]);
  });

  it("keeps the canonical order whatever order they were saved in", () => {
    expect(pickBalances(["future", "bank"])).toEqual(["bank", "future"]);
    expect(pickBalances(["today", "bank", "future"])).toEqual(["bank", "today", "future"]);
  });

  it("drops a key that is not one of the three", () => {
    expect(pickBalances(["today", "sideways"])).toEqual(["today"]);
  });
});

describe("periodTotals", () => {
  it("sums the months it is given", () => {
    const { earned, spent } = periodTotals([
      { month: "2026-01", income: 1000, expense: 400 },
      { month: "2026-02", income: 500, expense: 300 },
    ]);
    expect(earned).toBe(1500);
    expect(spent).toBe(700);
  });

  it("reports the share of income that survived", () => {
    const { kept } = periodTotals([{ month: "2026-01", income: 1000, expense: 750 }]);
    expect(kept).toBeCloseTo(25);
  });

  // Zero divided by zero is not "0 %", it is "no answer" — printing 0,0 % for a
  // month with no income states something untrue.
  it("has no answer when nothing came in", () => {
    expect(periodTotals([{ month: "2026-01", income: 0, expense: 80 }]).kept).toBeNull();
    expect(periodTotals([]).kept).toBeNull();
  });

  it("goes negative when more went out than came in", () => {
    const { kept } = periodTotals([{ month: "2026-01", income: 100, expense: 150 }]);
    expect(kept).toBeCloseTo(-50);
  });
});
