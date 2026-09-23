import { describe, expect, it } from "vitest";

import {
  activeFilters,
  activeFilterCount,
  emptyFilters,
  type Filters,
} from "./registerFilterModel";

const withFilters = (patch: Partial<Filters>): Filters => ({ ...emptyFilters, ...patch });

describe("activeFilters", () => {
  it("says nothing is on when nothing is on", () => {
    expect(activeFilters(emptyFilters)).toEqual([]);
  });

  // The chips are the visible half of the count; if they disagree the reader is
  // told there are three filters and shown two.
  it("agrees with the count, facet for facet", () => {
    const cases: Partial<Filters>[] = [
      { preset: "thisMonth" },
      { text: "esselunga" },
      { status: 2 },
      { payeeId: 4 },
      { categoryId: 9 },
      { tags: ["holiday"] },
      { amountMin: -5000 },
      { amountMax: 5000 },
      { hideFuture: true },
      { transfers: "only" },
      { noFlags: true },
      { uncategorised: true },
      { preset: "thisYear", text: "rent", tags: ["a", "b"], hideFuture: true },
    ];
    for (const patch of cases) {
      const f = withFilters(patch);
      expect(activeFilters(f)).toHaveLength(activeFilterCount(f));
    }
  });

  it("carries the text of a facet that has one", () => {
    const [chip] = activeFilters(withFilters({ text: "  esselunga  " }));
    expect(chip.value).toBe("esselunga");
    const [tags] = activeFilters(withFilters({ tags: ["holiday", "work"] }));
    expect(tags.value).toBe("holiday, work");
  });

  // Removing one chip must not disturb the others — that is the whole point of
  // showing them separately rather than as a single "3 filters" badge.
  it("clears exactly its own facet", () => {
    const f = withFilters({ preset: "thisMonth", text: "rent", hideFuture: true });
    const chips = activeFilters(f);
    const text = chips.find((c) => c.id === "text");
    expect(text).toBeDefined();
    const after = text!.clear(f);
    expect(after.text).toBe("");
    expect(after.preset).toBe("thisMonth");
    expect(after.hideFuture).toBe(true);
    expect(activeFilters(after)).toHaveLength(2);
  });

  // A custom range is a preset plus its bounds; dropping the preset alone would
  // leave the dates behind and the register filtered by an invisible rule.
  it("takes the custom range with the date chip", () => {
    const f = withFilters({ preset: "custom", from: "2026-01-01", to: "2026-01-31" });
    const after = activeFilters(f)[0].clear(f);
    expect(after.preset).toBe("all");
    expect(after.from).toBe("");
    expect(after.to).toBe("");
    expect(activeFilters(after)).toEqual([]);
  });
});
