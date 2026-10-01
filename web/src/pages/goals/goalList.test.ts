import { describe, expect, it } from "vitest";

import type { Goal, GoalContribution } from "../../api/client";
import {
  asideByAccount,
  countReachedOpen,
  lineOf,
  monthIndex,
  monthStart,
  paceOf,
  percentOf,
  viewOf,
} from "./goalList";

const goal = (over: Partial<Goal>): Goal => ({
  id: 1,
  name: "Trip",
  targetAmount: 180000,
  targetDate: null,
  accountId: null,
  note: "",
  position: 0,
  saved: 0,
  closedOn: null,
  ...over,
});
const move = (date: string, amount: number): GoalContribution => ({
  id: 0,
  goalId: 1,
  date,
  amount,
  note: "",
});

const today = "2026-10-01";

describe("months", () => {
  it("round-trips a month through its number", () => {
    expect(monthStart(monthIndex("2027-03-15"))).toBe("2027-03-01");
    expect(monthIndex("2027-01-01") - monthIndex("2026-12-31")).toBe(1);
  });
});

describe("paceOf", () => {
  it("averages the last three full months, to the whole unit", () => {
    const moves = [
      move("2026-07-15", 15000),
      move("2026-08-15", 15000),
      move("2026-09-15", 20000),
      // This month and four months back are outside the window.
      move("2026-10-01", 99900),
      move("2026-06-30", 99900),
    ];
    // 50000 / 3 = 16666.67 → 167,00.
    expect(paceOf(moves, today, 2)).toBe(16700);
  });

  it("does not go below zero when money came out", () => {
    expect(paceOf([move("2026-09-01", -5000)], today, 2)).toBe(0);
  });
});

describe("lineOf", () => {
  const trip = goal({ saved: 50000, targetDate: "2027-03-01" });
  const moves = [move("2026-07-15", 15000), move("2026-08-15", 15000), move("2026-09-15", 20000)];

  it("gives a month's share to make the date, and says when the pace falls short", () => {
    const l = lineOf(trip, moves, today, 2);
    expect(l.monthsLeft).toBe(5);
    // 1.300,00 over five months is 260,00.
    expect(l.need).toBe(26000);
    expect(l.pace).toBe(16700);
    expect(l.late).toBe(true);
    // 1.300 at 167 a month: eight months on, June 2027.
    expect(monthStart(l.eta!)).toBe("2027-06-01");
  });

  it("is on track when the pace covers the share", () => {
    const l = lineOf(trip, [move("2026-09-15", 90000)], today, 2);
    expect(l.late).toBe(false);
  });

  it("rounds the share up, so the date is made", () => {
    const l = lineOf(
      goal({ saved: 0, targetAmount: 10001, targetDate: "2026-12-01" }),
      [],
      today,
      2,
    );
    // 100,01 over two months: 51,00, not 50,00.
    expect(l.need).toBe(5100);
  });

  it("asks for all of what is left once its date has gone by", () => {
    const l = lineOf(
      goal({ saved: 36000, targetAmount: 90000, targetDate: "2026-06-01" }),
      [],
      today,
      2,
    );
    expect(l.pastDate).toBe(true);
    expect(l.need).toBe(54000);
    expect(l.late).toBe(true);
  });

  it("has no share without a date, and no end without a pace", () => {
    const l = lineOf(goal({ saved: 160000, targetAmount: 500000 }), [], today, 2);
    expect(l.need).toBeNull();
    expect(l.eta).toBeNull();
    expect(l.late).toBe(false);
  });

  it("is reached once its money is all in, and asks nothing more", () => {
    const l = lineOf(
      goal({ saved: 12000, targetAmount: 12000, targetDate: "2026-01-01" }),
      [],
      today,
      2,
    );
    expect(l.reached).toBe(true);
    expect(l.pastDate).toBe(false);
    expect(l.need).toBeNull();
    expect(l.late).toBe(false);
  });
});

describe("viewOf", () => {
  const goals = [
    goal({ id: 1, name: "Rainy-day fund", saved: 160000, targetAmount: 500000 }),
    goal({ id: 2, name: "Summer trip", saved: 50000, targetDate: "2027-03-01" }),
    goal({ id: 3, name: "Concert tickets", saved: 12000, targetAmount: 12000 }),
    goal({ id: 4, name: "New bike", saved: 60000, targetAmount: 60000, closedOn: "2026-08-01" }),
    goal({ id: 5, name: "New sofa", saved: 36000, targetAmount: 90000, closedOn: "2026-07-01" }),
  ];
  const v = viewOf(goals, new Map(), today, 2);

  it("puts dated goals first, reached ones apart, and closed ones in the history", () => {
    expect(v.open.map((l) => l.name)).toEqual(["Summer trip", "Rainy-day fund"]);
    expect(v.reached.map((l) => l.name)).toEqual(["Concert tickets"]);
    expect(v.history.map((l) => l.name)).toEqual(["New bike", "New sofa"]);
  });

  it("counts open and reached goals as set aside, not closed ones", () => {
    expect(v.count).toBe(3);
    expect(v.saved).toBe(222000);
    expect(v.target).toBe(692000);
    expect(v.need).toBe(26000);
  });
});

describe("asideByAccount", () => {
  it("sums what the goals still set aside keep in each account", () => {
    const m = asideByAccount([
      goal({ id: 1, accountId: 7, saved: 160000 }),
      goal({ id: 2, accountId: 7, saved: 12000, targetAmount: 12000 }),
      goal({ id: 3, accountId: 7, saved: 60000, closedOn: "2026-08-01" }),
      goal({ id: 4, accountId: null, saved: 50000 }),
    ]);
    expect([...m.keys()]).toEqual([7]);
    expect(m.get(7)!.amount).toBe(172000);
    expect(m.get(7)!.goals.map((g) => g.id)).toEqual([1, 2]);
  });
});

describe("countReachedOpen", () => {
  it("counts the goals reached and not yet closed", () => {
    expect(
      countReachedOpen([
        goal({ saved: 12000, targetAmount: 12000 }),
        goal({ saved: 60000, targetAmount: 60000, closedOn: "2026-08-01" }),
        goal({ saved: 100, targetAmount: 12000 }),
      ]),
    ).toBe(1);
    expect(countReachedOpen(undefined)).toBe(0);
  });
});

describe("percentOf", () => {
  it("is whole percent, floored", () => {
    expect(percentOf({ saved: 36000, targetAmount: 90000 })).toBe(40);
    expect(percentOf({ saved: 50000, targetAmount: 180000 })).toBe(27);
  });
});
