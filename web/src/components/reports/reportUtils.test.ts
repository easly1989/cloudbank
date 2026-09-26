import { describe, expect, it } from "vitest";
import { emptyFilters, type Filters } from "../../pages/registerFilterModel";
import { filterToParams } from "./reportUtils";

describe("filterToParams", () => {
  const f = (p: Partial<Filters>): Filters => ({ ...emptyFilters, ...p });
  const now = new Date(2026, 8, 26, 10); // 26 September 2026, local time

  it("sends nothing for an empty filter", () => {
    expect(filterToParams(emptyFilters, now)).toEqual({});
  });

  // Before #487 these four were shown on the report pages and never sent.
  it("sends the transfer, no-status and uncategorised filters", () => {
    expect(filterToParams(f({ transfers: "none" }), now)).toEqual({ transfers: "none" });
    expect(filterToParams(f({ transfers: "only" }), now)).toEqual({ transfers: "only" });
    expect(filterToParams(f({ noFlags: true }), now)).toEqual({ noFlags: "1" });
    expect(filterToParams(f({ uncategorised: true }), now)).toEqual({ uncategorised: "1" });
  });

  it("hides the future by ending the span today", () => {
    expect(filterToParams(f({ hideFuture: true }), now)).toEqual({ to: "2026-09-26" });
    // A span that ends later is cut at today; one that ends earlier is kept.
    expect(
      filterToParams(
        f({ hideFuture: true, preset: "custom", from: "2026-09-01", to: "2026-12-31" }),
        now,
      ),
    ).toEqual({ from: "2026-09-01", to: "2026-09-26" });
    expect(
      filterToParams(
        f({ hideFuture: true, preset: "custom", from: "2026-01-01", to: "2026-03-31" }),
        now,
      ),
    ).toEqual({ from: "2026-01-01", to: "2026-03-31" });
  });
});
