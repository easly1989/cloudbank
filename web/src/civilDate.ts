// Civil dates — the single source of truth for deriving a `YYYY-MM-DD` string
// from a `Date`.
//
// Transaction dates are *civil* dates: a calendar day with no time and no
// timezone attached (see CONTRIBUTING.md). `Date#toISOString()` is therefore the
// wrong tool to produce one, because it converts to UTC first: east of UTC a
// local midnight lands on the previous day, and west of UTC an evening lands on
// the next one. Build the string from the local calendar fields instead.

const pad = (n: number): string => String(n).padStart(2, "0");

/** Render a `Date` as a civil `YYYY-MM-DD` in the local calendar. */
export function toCivilDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Today's civil date, in the user's own timezone. */
export function todayCivil(): string {
  return toCivilDate(new Date());
}

/**
 * Milliseconds from `now` until the next *local* midnight, plus a one-second
 * cushion so a timer firing on it observes the new day rather than racing it.
 */
export function msUntilLocalMidnight(now: Date = new Date()): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1, 0);
  return next.getTime() - now.getTime();
}
