import { describe, expect, it } from "vitest";

import type { Category, TagActivity, TagInfo } from "../../api/client";
import { arrange, buildRows, DEFAULT_SORT, firstDirection, takenBy } from "./tagList";

const cat = (id: number, name: string): Category => ({
  id,
  name,
  parentId: null,
  isIncome: false,
  noBudget: false,
  noReport: false,
});
const categories = [cat(1, "Fuel"), cat(2, "Holidays"), cat(3, "Gifts")];

const tags: TagInfo[] = [
  { id: 10, name: "car", count: 24 },
  { id: 11, name: "christmas", count: 2 },
  { id: 12, name: "reimbursable", count: 6 },
  { id: 13, name: "idle", count: 0 },
];

const activity: TagActivity[] = [
  {
    tagId: 10,
    count: 24,
    amount: -134000,
    lastDate: "2026-09-21",
    categories: [
      { categoryId: 1, count: 23 },
      { categoryId: 2, count: 1 },
    ],
  },
  // Its transactions are a year old: none in the period.
  { tagId: 11, count: 0, amount: 0, lastDate: "2025-12-19", categories: [] },
  // Money in and out together: a net refund.
  {
    tagId: 12,
    count: 6,
    amount: 2500,
    lastDate: "2026-09-08",
    categories: [{ categoryId: 99, count: 6 }],
  },
];

describe("buildRows", () => {
  const rows = buildRows(tags, activity, categories);
  const by = (name: string) => rows.find((r) => r.tag.name === name)!;

  it("carries the figures and the categories it was mostly in", () => {
    expect(by("car")).toMatchObject({ count: 24, amount: -134000, lastDate: "2026-09-21" });
    expect(by("car").categories.map((c) => [c.category.name, c.count])).toEqual([
      ["Fuel", 23],
      ["Holidays", 1],
    ]);
  });

  it("keeps the last use of a tag quiet in the period, and leaves a new one empty", () => {
    expect(by("christmas")).toMatchObject({ count: 0, lastDate: "2025-12-19" });
    expect(by("idle")).toMatchObject({ count: 0, amount: 0, lastDate: null, categories: [] });
  });

  it("drops a category the wallet no longer has", () => {
    expect(by("reimbursable").categories).toEqual([]);
  });
});

describe("arrange", () => {
  const rows = buildRows(tags, activity, categories);
  const names = (rs: typeof rows) => rs.map((r) => r.tag.name);
  const all = { query: "", unusedOnly: false };

  it("goes by amount by default, the largest first, whatever the sign", () => {
    expect(names(arrange(rows, all, DEFAULT_SORT))).toEqual([
      "car",
      "reimbursable",
      "christmas",
      "idle",
    ]);
  });

  it("sorts by name, count and last use, and turns each around", () => {
    expect(names(arrange(rows, all, firstDirection("name")))).toEqual([
      "car",
      "christmas",
      "idle",
      "reimbursable",
    ]);
    expect(names(arrange(rows, all, firstDirection("count")))[0]).toBe("car");
    expect(names(arrange(rows, all, firstDirection("last")))).toEqual([
      "car",
      "reimbursable",
      "christmas",
      "idle",
    ]);
    expect(names(arrange(rows, all, { key: "last", desc: false }))[0]).toBe("idle");
  });

  it("filters by name and by use", () => {
    expect(names(arrange(rows, { ...all, query: "CHRIST" }, DEFAULT_SORT))).toEqual(["christmas"]);
    expect(names(arrange(rows, { ...all, unusedOnly: true }, DEFAULT_SORT))).toEqual([
      "christmas",
      "idle",
    ]);
  });
});

describe("takenBy", () => {
  it("matches a name exactly, outer spaces aside, as the server does", () => {
    expect(takenBy(["car", "home-office"], " car ")).toBe("car");
    expect(takenBy(["car"], "Car")).toBeUndefined();
  });
});
