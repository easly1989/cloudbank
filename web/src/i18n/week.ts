import { useTranslation } from "react-i18next";

import { languageOf } from "./languages";

/** 0 = Sunday, 1 = Monday, as in Date.getDay. */
export type WeekStart = 0 | 1;

/** The first day of the week in the app's language (#608). */
export function useWeekStart(): WeekStart {
  const { i18n } = useTranslation();
  return languageOf(i18n.language).weekStart;
}

/** Where a weekday (Date.getDay) falls in a week that starts on `weekStart`: 0 to 6. */
export const dayInWeek = (day: number, weekStart: WeekStart) => (day - weekStart + 7) % 7;

/** The seven weekday names in `lang`, starting on `weekStart`. */
export function weekdayNames(
  lang: string,
  style: "short" | "narrow",
  weekStart: WeekStart,
): string[] {
  const f = new Intl.DateTimeFormat(lang, { weekday: style, timeZone: "UTC" });
  // 2023-12-31 was a Sunday, 2024-01-01 a Monday.
  return Array.from({ length: 7 }, (_, i) =>
    f.format(new Date(Date.UTC(2023, 11, 31 + weekStart + i))),
  );
}
