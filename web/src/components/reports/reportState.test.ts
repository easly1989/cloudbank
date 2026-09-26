import { describe, expect, it } from "vitest";

import { emptyFilters } from "../../pages/registerFilterModel";
import {
  type ReportState,
  initialReportState,
  isCurrentPeriod,
  parseReportState,
  periodOf,
  previousPeriod,
  reportApiParams,
  reportStateToParams,
  shiftPeriod,
  viewToSearch,
} from "./reportState";

const now = new Date(2026, 8, 26, 10); // 26 September 2026, local time
const roundTrip = (s: ReportState) => parseReportState(new URLSearchParams(reportStateToParams(s)));

describe("report state in the URL", () => {
  it("writes nothing for the defaults, and reads them back", () => {
    expect(reportStateToParams(initialReportState)).toEqual({});
    expect(parseReportState(new URLSearchParams())).toEqual(initialReportState);
  });

  it("round-trips every choice", () => {
    const s: ReportState = {
      tab: "balances",
      period: "quarter",
      at: "2026-04-01",
      filters: { ...initialReportState.filters, categoryId: 7, text: "rent", transfers: "all" },
      type: "income",
      by: "tag",
      bucket: "week",
      accounts: [3, 5],
      vehicle: 2,
    };
    expect(roundTrip(s)).toEqual(s);
  });

  // The reports leave transfers out unless asked; the register keeps them.
  it("excludes transfers by default, and says so only when that changes", () => {
    expect(initialReportState.filters.transfers).toBe("none");
    const all = {
      ...initialReportState,
      filters: { ...initialReportState.filters, transfers: "all" as const },
    };
    expect(reportStateToParams(all)).toEqual({ xf: "all" });
    expect(roundTrip(all).filters.transfers).toBe("all");
  });

  it("ignores the register's dates and anything it does not know", () => {
    const s = parseReportState(
      new URLSearchParams("dp=thisYear&df=2026-01-01&tab=pie&p=decade&at=soon&v=-1"),
    );
    expect(s.filters.preset).toBe("all");
    expect(s.filters.from).toBe("");
    expect(s.tab).toBe("spending");
    expect(s.period).toBeNull();
    expect(s.at).toBe("");
    expect(s.vehicle).toBeNull();
  });
});

describe("periods", () => {
  it("finds the period containing a day", () => {
    expect(periodOf("month", "", now)).toEqual({
      kind: "month",
      from: "2026-09-01",
      to: "2026-09-30",
    });
    expect(periodOf("quarter", "2026-05-17", now)).toEqual({
      kind: "quarter",
      from: "2026-04-01",
      to: "2026-06-30",
    });
    expect(periodOf("half", "", now)).toEqual({
      kind: "half",
      from: "2026-07-01",
      to: "2026-12-31",
    });
    expect(periodOf("year", "2025-02-28", now)).toEqual({
      kind: "year",
      from: "2025-01-01",
      to: "2025-12-31",
    });
    expect(periodOf("all", "", now)).toEqual({ kind: "all" });
  });

  it("steps to the neighbour, and back to now as an empty at", () => {
    const back = shiftPeriod("month", "", -1, now);
    expect(back).toBe("2026-08-01");
    expect(shiftPeriod("month", back, 1, now)).toBe("");
    expect(shiftPeriod("year", "", -1, now)).toBe("2025-01-01");
    expect(shiftPeriod("quarter", "2026-01-15", -1, now)).toBe("2025-10-01");
    // Months of different lengths do not drift: 31 March back is February.
    expect(periodOf("month", shiftPeriod("month", "2026-03-31", -1, now), now).from).toBe(
      "2026-02-01",
    );
  });

  it("knows the period before, and whether one is still running", () => {
    expect(previousPeriod(periodOf("month", "2026-01-10", now))?.from).toBe("2025-12-01");
    expect(previousPeriod(periodOf("half", "", now))).toEqual({
      kind: "half",
      from: "2026-01-01",
      to: "2026-06-30",
    });
    expect(previousPeriod({ kind: "all" })).toBeNull();
    expect(isCurrentPeriod(periodOf("month", "", now), now)).toBe(true);
    expect(isCurrentPeriod(periodOf("month", "2026-08-01", now), now)).toBe(false);
  });

  it("sends the period as the report's dates", () => {
    const p = periodOf("month", "", now);
    expect(reportApiParams(initialReportState.filters, p, now)).toEqual({
      from: "2026-09-01",
      to: "2026-09-30",
      transfers: "none",
    });
    expect(reportApiParams({ ...emptyFilters, hideFuture: true }, p, now)).toEqual({
      from: "2026-09-01",
      to: "2026-09-26",
    });
  });
});

describe("saved views", () => {
  const view = (tab: string, config: Record<string, unknown>) => ({
    id: "v",
    walletId: 1,
    name: "n",
    tab,
    config,
  });

  it("opens a view saved since the redesign as it was", () => {
    expect(viewToSearch(view("reports", { search: "tab=vehicle&v=2" }))).toBe("tab=vehicle&v=2");
  });

  // Statistics became Spending and Trend became Cash flow: an old view opens
  // there with its filters and grouping.
  it("opens an old Statistics or Trend view on the tab that replaced it", () => {
    const stats = new URLSearchParams(
      viewToSearch(
        view("statistics", {
          groupBy: "payee",
          filters: { ...emptyFilters, categoryId: 4, preset: "thisYear" },
        }),
      )!,
    );
    expect(stats.get("by")).toBe("payee");
    expect(stats.get("cat")).toBe("4");
    expect(stats.get("dp")).toBeNull();
    const trend = new URLSearchParams(viewToSearch(view("trend", { filters: emptyFilters }))!);
    expect(trend.get("tab")).toBe("cashflow");
    // The old view kept its transfers: it said nothing, which then meant all.
    expect(trend.get("xf")).toBe("all");
    expect(viewToSearch(view("balance", {}))).toBeNull();
  });
});
