import { describe, expect, it } from "vitest";

import type { ScheduleOccurrence } from "../../api/client";
import {
  addDays,
  cadence,
  commitments,
  inFlow,
  isMonth,
  monthFigures,
  monthGrid,
  needsYou,
  shiftMonth,
} from "./scheduleCalendar";

const occ = (o: Partial<ScheduleOccurrence>): ScheduleOccurrence => ({
  scheduleId: 1,
  templateId: 1,
  name: "Bill",
  date: "2026-09-01",
  amount: -100,
  accountId: 1,
  isTransfer: false,
  isSplit: false,
  autoPost: false,
  state: "due",
  next: false,
  ...o,
});

describe("monthGrid", () => {
  it("draws whole weeks, Monday first", () => {
    // September 2026 starts on a Tuesday and ends on a Wednesday.
    const days = monthGrid("2026-09");
    expect(days[0]).toBe("2026-08-31");
    expect(days.at(-1)).toBe("2026-10-04");
    expect(days.length).toBe(35);
  });
  it("takes six rows when the month needs them", () => {
    // August 2026 starts on a Saturday.
    const days = monthGrid("2026-08");
    expect(days[0]).toBe("2026-07-27");
    expect(days.length).toBe(42);
  });
});

describe("month arithmetic", () => {
  it("crosses years", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(addDays("2026-09-29", 7)).toBe("2026-10-06");
  });
  it("knows a month when it sees one", () => {
    expect(isMonth("2026-09")).toBe(true);
    expect(isMonth("2026-13")).toBe(false);
    expect(isMonth(null)).toBe(false);
  });
});

describe("monthFigures", () => {
  it("adds up the month's bills and income, leaving transfers and other months out", () => {
    const f = monthFigures(
      [
        occ({ amount: -75000, state: "registered", status: 2 }),
        occ({ amount: -1299, state: "registered", status: 1, date: "2026-09-15" }),
        occ({ name: "Energy", amount: -7800, state: "overdue", date: "2026-09-26" }),
        occ({ amount: 245000, state: "registered", status: 1, date: "2026-09-27" }),
        occ({ amount: -50000, isTransfer: true, state: "registered", status: 2 }),
        occ({ amount: -75000, date: "2026-10-01" }),
      ],
      "2026-09",
    );
    expect(f.outTotal).toBe(84099);
    expect(f.paid).toBe(75000);
    expect(f.toPay).toBe(9099);
    expect([f.outCount, f.paidCount]).toEqual([3, 1]);
    expect(f.overdue).toBe(7800);
    expect(f.firstOverdue?.name).toBe("Energy");
    expect([f.inTotal, f.received]).toEqual([245000, 245000]);
  });
});

describe("needsYou", () => {
  it("holds what is late, and what is due within the week and will not register itself", () => {
    const late = occ({ state: "overdue", date: "2026-09-26" });
    const soon = occ({ state: "due", date: "2026-10-05" });
    const auto = occ({ state: "due", date: "2026-10-01", autoPost: true });
    const later = occ({ state: "due", date: "2026-10-15" });
    const done = occ({ state: "registered", date: "2026-09-01" });
    expect(needsYou([done, late, auto, soon, later], "2026-09-29")).toEqual([late, soon]);
  });
});

describe("inFlow", () => {
  it("counts a transfer as money going out, never as income", () => {
    const transfer = occ({ isTransfer: true, amount: -100 });
    expect(inFlow(transfer, "out")).toBe(true);
    expect(inFlow(transfer, "in")).toBe(false);
    expect(inFlow(occ({ amount: 5 }), "in")).toBe(true);
  });
});

describe("cadence", () => {
  it("names the day the schedule comes round on", () => {
    expect(cadence({ unit: "month", everyN: 1, nextDue: "2026-09-26" }, "en")).toEqual({
      key: "schedules.repeat.month",
      values: { n: 1, day: 26 },
    });
    expect(cadence({ unit: "week", everyN: 2, nextDue: "2026-10-02" }, "en")).toEqual({
      key: "schedules.repeat.weekN",
      values: { n: 2, weekday: "Friday" },
    });
    expect(cadence({ unit: "year", everyN: 1, nextDue: "2026-03-01" }, "en-GB").values.date).toBe(
      "1 March",
    );
  });
});

describe("commitments", () => {
  it("scales each schedule to a month and a year, leaving transfers out", () => {
    const s = (templateAmount: number, unit: "week" | "month", extra = {}) => ({
      id: 1,
      templateId: 1,
      templateName: "x",
      templateAmount,
      templateIsTransfer: false,
      unit,
      everyN: 1,
      nextDue: "2026-09-01",
      weekendMode: 0,
      postAdvance: 0,
      autoPost: false,
      ...extra,
    });
    const c = commitments([
      s(245000, "month"),
      s(-75000, "month"),
      s(-1000, "week"),
      s(-50000, "month", { templateIsTransfer: true }),
    ]);
    expect(c.month.in).toBe(245000);
    expect(c.year.in).toBe(2940000);
    expect(c.year.out).toBe(-900000 - 52179);
    expect(c.month.out).toBe(-75000 - 4348);
  });
});
