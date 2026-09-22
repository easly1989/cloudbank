import { describe, expect, it } from "vitest";

import { ALL_COLUMNS, moveColumn, normalizeColumnOrder } from "./registerColumns";

describe("normalizeColumnOrder", () => {
  it("ships with every column when nothing was saved", () => {
    expect(normalizeColumnOrder(undefined)).toEqual([...ALL_COLUMNS]);
    expect(normalizeColumnOrder([])).toEqual([...ALL_COLUMNS]);
  });

  it("keeps the order that was saved", () => {
    const saved = ["amount", "date", "payee", "category", "note", "status", "runningBalance"];
    expect(normalizeColumnOrder(saved)).toEqual(saved);
  });

  // The three ways a saved order goes stale. Each has to survive a reload
  // without the register quietly losing a column.
  it("drops a column that no longer exists", () => {
    const out = normalizeColumnOrder(["amount", "cheque-number", "date"]);
    expect(out).not.toContain("cheque-number");
    expect(out.slice(0, 2)).toEqual(["amount", "date"]);
  });

  it("drops a repeated column rather than showing it twice", () => {
    const out = normalizeColumnOrder(["amount", "amount", "date"]);
    expect(out.filter((c) => c === "amount")).toHaveLength(1);
  });

  it("appends a column the saved order predates, at its shipped place", () => {
    const out = normalizeColumnOrder(["amount", "date"]);
    expect(out).toHaveLength(ALL_COLUMNS.length);
    expect(new Set(out)).toEqual(new Set(ALL_COLUMNS));
    expect(out.slice(0, 2)).toEqual(["amount", "date"]);
  });
});

describe("moveColumn", () => {
  const start = [...ALL_COLUMNS];

  it("moves a column one place at a time", () => {
    expect(moveColumn(start, "payee", -1)[0]).toBe("payee");
    expect(moveColumn(start, "date", 1)[1]).toBe("date");
  });

  it("stops at the ends instead of wrapping round", () => {
    // Clicking "up" on the first column repeatedly means "keep it first",
    // not "send it to the back".
    expect(moveColumn(start, "date", -1)).toEqual(start);
    expect(moveColumn(start, "runningBalance", 1)).toEqual(start);
  });

  it("ignores a column it does not know", () => {
    expect(moveColumn(start, "nonsense", 1)).toEqual(start);
  });

  it("does not mutate the order it was given", () => {
    const before = [...start];
    moveColumn(start, "payee", 1);
    expect(start).toEqual(before);
  });

  it("never loses or duplicates a column", () => {
    let order: readonly string[] = start;
    for (const step of [1, 1, -1, 1, -1, -1] as const) order = moveColumn(order, "status", step);
    expect(new Set(order)).toEqual(new Set(ALL_COLUMNS));
    expect(order).toHaveLength(ALL_COLUMNS.length);
  });
});
