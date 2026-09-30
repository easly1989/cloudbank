import { describe, expect, it } from "vitest";

import type { Category, CategoryActivity } from "../../api/client";
import {
  barScale,
  buildSections,
  countUnused,
  filterSections,
  fold,
  lastTwelveMonths,
  share,
} from "./categoryTree";

const cat = (
  id: number,
  name: string,
  parentId: number | null = null,
  isIncome = false,
): Category => ({
  id,
  name,
  parentId,
  isIncome,
  noBudget: false,
  noReport: false,
});

const categories: Category[] = [
  cat(1, "Food"),
  cat(2, "Groceries", 1),
  cat(3, "Dining out", 1),
  cat(4, "Coffee", 1),
  cat(5, "Home"),
  cat(6, "Gifts"),
  cat(7, "Pay", null, true),
  cat(8, "Salary", 7, true),
];

const activity: CategoryActivity[] = [
  { categoryId: 1, count: 1, amount: -500, lastDate: "2026-09-01" },
  { categoryId: 2, count: 10, amount: -30000, lastDate: "2026-09-20" },
  { categoryId: 3, count: 4, amount: -12000, lastDate: "2026-08-02" },
  // Used, but not in the period.
  { categoryId: 4, count: 0, amount: 0, lastDate: "2025-03-01" },
  { categoryId: 5, count: 2, amount: -90000, lastDate: "2026-07-01" },
  { categoryId: 8, count: 12, amount: 360000, lastDate: "2026-09-27" },
];

describe("buildSections", () => {
  const s = buildSections(categories, activity);

  it("puts groups in their section, the largest total first", () => {
    expect(s.expense.groups.map((g) => g.category.name)).toEqual(["Home", "Food", "Gifts"]);
    expect(s.income.groups.map((g) => g.category.name)).toEqual(["Pay"]);
  });

  it("adds a group's subcategories to its own figures", () => {
    const food = s.expense.groups[1];
    expect(food.totalCount).toBe(15);
    expect(food.total).toBe(-42500);
    expect(food.lastAny).toBe("2026-09-20");
    expect(food.subs.map((x) => x.category.name)).toEqual(["Groceries", "Dining out", "Coffee"]);
  });

  it("sums each section", () => {
    expect(s.expense.count).toBe(17);
    expect(s.expense.total).toBe(-132500);
    expect(s.income.total).toBe(360000);
  });

  it("keeps the last date of a category unused in the period, and null for one never used", () => {
    const food = s.expense.groups[1];
    expect(food.subs[2].lastDate).toBe("2025-03-01");
    expect(s.expense.groups[2].lastDate).toBeNull();
  });

  it("counts as unused the subcategories and the groups without any, not a group that holds some", () => {
    // Coffee, Gifts. Pay has no lines of its own but holds Salary.
    expect(countUnused([s.expense, s.income])).toBe(2);
  });
});

describe("filterSections", () => {
  const s = buildSections(categories, activity);
  const names = (secs: ReturnType<typeof filterSections>) =>
    secs.map((sec) =>
      sec.groups.map((g) => [g.category.name, ...g.subs.map((x) => x.category.name)]),
    );

  it("shows everything by default", () => {
    expect(names(filterSections(s, { kind: "all", query: "", unusedOnly: false }))).toEqual([
      [["Home"], ["Food", "Groceries", "Dining out", "Coffee"], ["Gifts"]],
      [["Pay", "Salary"]],
    ]);
  });

  it("keeps one kind", () => {
    expect(names(filterSections(s, { kind: "income", query: "", unusedOnly: false }))).toEqual([
      [["Pay", "Salary"]],
    ]);
  });

  it("keeps a matching group whole, and a group with matching subcategories as their heading", () => {
    expect(names(filterSections(s, { kind: "all", query: "FOO", unusedOnly: false }))).toEqual([
      [["Food", "Groceries", "Dining out", "Coffee"]],
    ]);
    expect(names(filterSections(s, { kind: "all", query: "dining", unusedOnly: false }))).toEqual([
      [["Food", "Dining out"]],
    ]);
  });

  it("ignores accents", () => {
    expect(fold("Caffè ")).toBe("caffe");
  });

  it("keeps only the unused, under their group", () => {
    expect(names(filterSections(s, { kind: "all", query: "", unusedOnly: true }))).toEqual([
      [["Food", "Coffee"], ["Gifts"]],
    ]);
  });

  it("keeps the whole section's figures", () => {
    const [sec] = filterSections(s, { kind: "all", query: "dining", unusedOnly: false });
    expect(sec.total).toBe(-132500);
  });
});

describe("share and scale", () => {
  it("is a whole percentage of the section, whatever the sign", () => {
    expect(share(-42500, -132500)).toBe(32);
    expect(share(100, 0)).toBe(0);
  });
  it("scales bars to the largest group", () => {
    expect(barScale(buildSections(categories, activity).expense)).toBe(90000);
    expect(barScale({ kind: "income", groups: [], count: 0, total: 0 })).toBe(1);
  });
});

describe("lastTwelveMonths", () => {
  it("runs from the day after a year ago to today", () => {
    expect(lastTwelveMonths("2026-09-30")).toEqual({ from: "2025-10-01", to: "2026-09-30" });
    expect(lastTwelveMonths("2026-12-31")).toEqual({ from: "2026-01-01", to: "2026-12-31" });
  });
  it("takes 28 February for a leap day", () => {
    expect(lastTwelveMonths("2028-02-29")).toEqual({ from: "2027-03-01", to: "2028-02-29" });
  });
});
