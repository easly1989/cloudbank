// The schedules calendar's arithmetic (#546): the days a month view draws, the
// figures above it and what is waiting on the reader. Kept apart from the
// components so it can be tested without rendering anything.

import type { Schedule, ScheduleOccurrence, ScheduleUnit } from "../../api/client";

const pad = (n: number) => String(n).padStart(2, "0");
const civil = (d: Date) =>
  `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const parse = (s: string) => new Date(`${s}T00:00:00Z`);

/** Reconciled, in the transactions' status codes. */
export const STATUS_RECONCILED = 2;

/** "2026-09" for any date in September 2026. */
export const monthOf = (date: string) => date.slice(0, 7);

/** The month `delta` months from `month`. */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

/** Whether `month` is a real "YYYY-MM". */
export const isMonth = (month: string | null): month is string =>
  !!month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month);

/**
 * The days a month view draws: whole weeks, Monday first, from the week the
 * month starts in to the week it ends in — five or six rows.
 */
export function monthGrid(month: string): string[] {
  const first = parse(`${month}-01`);
  const start = new Date(first);
  start.setUTCDate(1 - ((first.getUTCDay() + 6) % 7));
  const last = parse(`${shiftMonth(month, 1)}-01`);
  last.setUTCDate(0);
  const end = new Date(last);
  end.setUTCDate(last.getUTCDate() + (6 - ((last.getUTCDay() + 6) % 7)));
  const days: string[] = [];
  for (const d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) days.push(civil(d));
  return days;
}

/** `date` moved by `days`. */
export function addDays(date: string, days: number): string {
  const d = parse(date);
  d.setUTCDate(d.getUTCDate() + days);
  return civil(d);
}

export type Flow = "all" | "out" | "in";

/** Whether an occurrence shows under a flow filter. A transfer leaves its account, so it is out. */
export function inFlow(o: ScheduleOccurrence, flow: Flow): boolean {
  if (flow === "out") return o.amount < 0;
  if (flow === "in") return o.amount > 0 && !o.isTransfer;
  return true;
}

/** Paid, in the reader's words: reconciled against the statement. */
export const isPaid = (o: ScheduleOccurrence) =>
  o.state === "registered" && o.status === STATUS_RECONCILED;

export interface MonthFigures {
  /** All that goes out in the month, and what of it is not reconciled yet. */
  outTotal: number;
  toPay: number;
  outCount: number;
  paidCount: number;
  paid: number;
  /** Not registered and past its date. */
  overdue: number;
  overdueCount: number;
  firstOverdue: ScheduleOccurrence | null;
  /** All that comes in, and what of it is registered. */
  inTotal: number;
  received: number;
}

/**
 * The figures over a month's occurrences. Transfers move money between the
 * reader's own accounts, so they are neither a bill nor income here, though the
 * calendar still shows them. Amounts are added in minor units, which is exact
 * for a wallet in one currency — the common case, as on the rest of the page.
 */
export function monthFigures(occurrences: ScheduleOccurrence[], month: string): MonthFigures {
  const f: MonthFigures = {
    outTotal: 0,
    toPay: 0,
    outCount: 0,
    paidCount: 0,
    paid: 0,
    overdue: 0,
    overdueCount: 0,
    firstOverdue: null,
    inTotal: 0,
    received: 0,
  };
  for (const o of occurrences) {
    if (o.isTransfer || monthOf(o.date) !== month) continue;
    if (o.amount < 0) {
      const a = -o.amount;
      f.outTotal += a;
      f.outCount++;
      if (isPaid(o)) {
        f.paid += a;
        f.paidCount++;
      } else f.toPay += a;
      if (o.state === "overdue") {
        f.overdue += a;
        f.overdueCount++;
        if (!f.firstOverdue) f.firstOverdue = o;
      }
    } else if (o.amount > 0) {
      f.inTotal += o.amount;
      if (o.state === "registered") f.received += o.amount;
    }
  }
  return f;
}

/** How far ahead "Needs you" looks for a schedule the reader registers by hand. */
export const NEEDS_YOU_DAYS = 7;

/**
 * What is waiting on the reader: every occurrence past its date and not
 * registered, and those due within the week that will not register themselves.
 */
export function needsYou(occurrences: ScheduleOccurrence[], today: string): ScheduleOccurrence[] {
  const horizon = addDays(today, NEEDS_YOU_DAYS);
  return occurrences.filter(
    (o) => o.state === "overdue" || (o.state === "due" && !o.autoPost && o.date <= horizon),
  );
}

/** What comes after today, for "Next up": at most `limit` of them. */
export function nextUp(
  occurrences: ScheduleOccurrence[],
  today: string,
  exclude: Set<ScheduleOccurrence>,
  limit = 4,
): ScheduleOccurrence[] {
  return occurrences.filter((o) => o.date > today && !exclude.has(o)).slice(0, limit);
}

/** A stable key for an occurrence: a registered one by its transaction, a projected one by schedule and date. */
export const occurrenceKey = (o: ScheduleOccurrence) =>
  o.transactionId != null ? `t${o.transactionId}` : `s${o.scheduleId}-${o.date}`;

/**
 * A schedule's cadence in words, as an i18n key and its values: "Monthly, on
 * day 26", "Every 2 weeks, on Friday". The day comes from the next due date.
 */
export function cadence(
  s: Pick<Schedule, "unit" | "everyN" | "nextDue">,
  locale: string,
): { key: string; values: Record<string, string | number> } {
  const d = parse(s.nextDue);
  const n = Math.max(1, s.everyN);
  const many = n > 1 ? "N" : "";
  switch (s.unit) {
    case "day":
      return { key: `schedules.repeat.day${many}`, values: { n } };
    case "week":
      return {
        key: `schedules.repeat.week${many}`,
        values: {
          n,
          weekday: new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }).format(d),
        },
      };
    case "year":
      return {
        key: `schedules.repeat.year${many}`,
        values: {
          n,
          date: new Intl.DateTimeFormat(locale, {
            day: "numeric",
            month: "long",
            timeZone: "UTC",
          }).format(d),
        },
      };
    default:
      return { key: `schedules.repeat.month${many}`, values: { n, day: d.getUTCDate() } };
  }
}

const MONTH_DAYS = 365.25 / 12;
const UNIT_DAYS: Record<ScheduleUnit, number> = {
  day: 1,
  week: 7,
  month: MONTH_DAYS,
  year: 365.25,
};

export interface Commitments {
  month: { in: number; out: number };
  year: { in: number; out: number };
}

/**
 * What the schedules bring in and take out in a typical month and year: each
 * one fires once every everyN × unit days, so its amount is scaled by how many
 * times that fits in the period. A month is a twelfth of a year, so a monthly
 * schedule counts exactly twelve times a year. Transfers and ended schedules
 * are left out.
 */
export function commitments(schedules: Schedule[]): Commitments {
  const c: Commitments = { month: { in: 0, out: 0 }, year: { in: 0, out: 0 } };
  for (const s of schedules) {
    if (s.remaining === 0 || s.templateIsTransfer) continue;
    const every = Math.max(1, s.everyN) * (UNIT_DAYS[s.unit] ?? MONTH_DAYS);
    for (const [p, days] of [
      ["month", MONTH_DAYS],
      ["year", 365.25],
    ] as const) {
      const amt = Math.round((s.templateAmount * days) / every);
      if (amt >= 0) c[p].in += amt;
      else c[p].out += amt;
    }
  }
  return c;
}
