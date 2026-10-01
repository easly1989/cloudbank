import type { Goal, GoalContribution } from "../../api/client";

/**
 * What the Goals page (#572) says about each goal, worked out apart from the
 * components so the rules can be read and tested on their own.
 *
 * A goal is open, reached (its money is all in, still counted as set aside
 * until its owner closes it), or closed into the history: reached and done
 * with, or given up on. Closed goals no longer count as money set aside.
 */

/** A civil date's month as one number: year × 12 + month − 1. */
export const monthIndex = (date: string) =>
  Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;

/** A month number back to its first day, as a civil date. */
export const monthStart = (i: number) =>
  `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}-01`;

export interface GoalLine extends Goal {
  /** Still to put in; never below zero. */
  left: number;
  reached: boolean;
  closed: boolean;
  /** What went in a month over the last three full months, to the whole unit. */
  pace: number;
  /** Months to its date, counting this one; null without a date. */
  monthsLeft: number | null;
  /** Its date has gone by and it is not reached. */
  pastDate: boolean;
  /** A month's share: what is left over the months to its date, to the whole unit. */
  need: number | null;
  /** The month it gets there at its pace; null when nothing goes in. */
  eta: number | null;
  /** Its pace is short of its share. */
  late: boolean;
  /** The day money last went in, if it ever did. */
  lastIn: string | null;
}

/** The money in, over the last three full months, as a monthly figure. */
export function paceOf(moves: readonly GoalContribution[], today: string, fracDigits: number) {
  const now = monthIndex(today);
  const unit = 10 ** fracDigits;
  let sum = 0;
  for (const c of moves) {
    const m = monthIndex(c.date);
    if (m >= now - 3 && m < now) sum += c.amount;
  }
  return Math.max(0, Math.round(sum / 3 / unit) * unit);
}

export function lineOf(
  g: Goal,
  moves: readonly GoalContribution[] | undefined,
  today: string,
  fracDigits: number,
): GoalLine {
  const unit = 10 ** fracDigits;
  const now = monthIndex(today);
  const left = Math.max(0, g.targetAmount - g.saved);
  const reached = g.targetAmount > 0 && g.saved >= g.targetAmount;
  const pace = paceOf(moves ?? [], today, fracDigits);
  const pastDate = !reached && g.targetDate != null && g.targetDate < today;
  const monthsLeft = g.targetDate ? Math.max(1, monthIndex(g.targetDate) - now) : null;
  const need = reached
    ? null
    : pastDate
      ? left
      : monthsLeft != null
        ? Math.ceil(left / monthsLeft / unit) * unit
        : null;
  return {
    ...g,
    left,
    reached,
    closed: g.closedOn != null,
    pace,
    monthsLeft,
    pastDate,
    need,
    eta: !reached && pace > 0 ? now + Math.ceil(left / pace) : null,
    late: !reached && need != null && pace < need,
    lastIn: (moves ?? []).reduce<string | null>(
      (d, c) => (c.amount > 0 && (d == null || c.date > d) ? c.date : d),
      null,
    ),
  };
}

export interface GoalsView {
  /** Under way: dated first, soonest first, then the rest by name. */
  open: GoalLine[];
  /** Reached, waiting to be closed. */
  reached: GoalLine[];
  /** Closed, the latest first. */
  history: GoalLine[];
  /** What is set aside: the open and reached goals. */
  saved: number;
  target: number;
  count: number;
  /** The open goals' monthly shares, together. */
  need: number;
  /** What went into the open goals a month, lately. */
  pace: number;
}

const byDate = (a: GoalLine, b: GoalLine) =>
  (a.targetDate ?? "9999-99-99").localeCompare(b.targetDate ?? "9999-99-99") ||
  a.name.localeCompare(b.name);

export function viewOf(
  goals: readonly Goal[],
  moves: ReadonlyMap<number, readonly GoalContribution[]>,
  today: string,
  fracDigits: number,
): GoalsView {
  const lines = goals.map((g) => lineOf(g, moves.get(g.id), today, fracDigits));
  const open = lines.filter((l) => !l.closed && !l.reached).sort(byDate);
  const reached = lines.filter((l) => !l.closed && l.reached).sort(byDate);
  const history = lines
    .filter((l) => l.closed)
    .sort(
      (a, b) => (b.closedOn ?? "").localeCompare(a.closedOn ?? "") || a.name.localeCompare(b.name),
    );
  const live = [...open, ...reached];
  return {
    open,
    reached,
    history,
    saved: live.reduce((s, l) => s + l.saved, 0),
    target: live.reduce((s, l) => s + l.targetAmount, 0),
    count: live.length,
    need: open.reduce((s, l) => s + (l.need ?? 0), 0),
    pace: open.reduce((s, l) => s + l.pace, 0),
  };
}

/** How far a goal got, in whole percent. */
export const percentOf = (g: Pick<Goal, "saved" | "targetAmount">) =>
  g.targetAmount > 0 ? Math.floor((Math.max(g.saved, 0) / g.targetAmount) * 100) : 0;

/** What the goals still set aside (open or reached, not closed) keep in each account. */
export function asideByAccount(
  goals: readonly Goal[],
): Map<number, { amount: number; goals: Goal[] }> {
  const out = new Map<number, { amount: number; goals: Goal[] }>();
  for (const g of goals) {
    if (g.closedOn != null || g.accountId == null) continue;
    const cur = out.get(g.accountId) ?? { amount: 0, goals: [] };
    cur.amount += g.saved;
    cur.goals.push(g);
    out.set(g.accountId, cur);
  }
  return out;
}

/** How many goals are reached and still waiting to be closed. */
export const countReachedOpen = (goals: readonly Goal[] | undefined) =>
  (goals ?? []).filter((g) => g.closedOn == null && g.targetAmount > 0 && g.saved >= g.targetAmount)
    .length;
