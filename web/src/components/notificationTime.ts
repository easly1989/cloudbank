/** Which part of the bell a notification falls in, by when it arrived. */
export type BellSection = "today" | "week" | "earlier";

const DAY = 24 * 60 * 60 * 1000;

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function bellSection(iso: string, now: Date): BellSection {
  const at = new Date(iso).getTime();
  const today = startOfDay(now);
  if (at >= today) return "today";
  if (at >= today - 6 * DAY) return "week";
  return "earlier";
}

/** The time beside a notification: the hour today, "yesterday", the weekday
    this week, the date before that. */
export function bellWhen(iso: string, now: Date, lang: string, yesterday: string): string {
  const d = new Date(iso);
  const day = startOfDay(d);
  const today = startOfDay(now);
  if (day >= today) return d.toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit" });
  if (day >= today - DAY) return yesterday;
  if (day >= today - 6 * DAY) return d.toLocaleDateString(lang, { weekday: "short" });
  return d.toLocaleDateString(lang, { day: "numeric", month: "short" });
}
