import { describe, expect, it } from "vitest";

import type { Category } from "../../api/client";
import { categoryTone, moveBy, moveTo, shadowed, usedOn } from "./ruleList";

const rules = [{ id: 1 }, { id: 2 }, { id: 3 }];
const ids = (list: { id: number }[]) => list.map((r) => r.id);

describe("usedOn", () => {
  it("names when a rule runs", () => {
    expect(usedOn({ applyOnManual: true, applyOnImport: true })).toBe("both");
    expect(usedOn({ applyOnManual: false, applyOnImport: true })).toBe("import");
    expect(usedOn({ applyOnManual: true, applyOnImport: false })).toBe("manual");
    expect(usedOn({ applyOnManual: false, applyOnImport: false })).toBe("off");
  });
});

describe("shadowed", () => {
  it("is a rule whose every match a rule above takes first", () => {
    expect(shadowed({ matches: 0, reach: 40 })).toBe(true);
    expect(shadowed({ matches: 0, reach: 0 })).toBe(false);
    expect(shadowed({ matches: 3, reach: 40 })).toBe(false);
    expect(shadowed({})).toBe(false);
  });
});

describe("moving a rule", () => {
  it("moves up and down one place, and stays put at an end", () => {
    expect(ids(moveBy(rules, 2, -1))).toEqual([2, 1, 3]);
    expect(ids(moveBy(rules, 2, 1))).toEqual([1, 3, 2]);
    expect(moveBy(rules, 1, -1)).toBe(rules);
    expect(moveBy(rules, 3, 1)).toBe(rules);
  });
  it("drops a dragged rule where the target was", () => {
    expect(ids(moveTo(rules, 3, 1))).toEqual([3, 1, 2]);
    expect(ids(moveTo(rules, 1, 3))).toEqual([2, 3, 1]);
    expect(moveTo(rules, 2, 2)).toBe(rules);
  });
});

describe("categoryTone", () => {
  const cats = [
    { id: 1, name: "Food", isIncome: false },
    { id: 2, name: "Salary", isIncome: true },
  ] as Category[];
  it("is income for an income category and expense otherwise", () => {
    expect(categoryTone(2, cats)).toBe("income");
    expect(categoryTone(1, cats)).toBe("expense");
    expect(categoryTone(null, cats)).toBe("expense");
  });
});
