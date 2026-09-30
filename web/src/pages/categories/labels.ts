import { useMemo } from "react";
import { useTranslation } from "react-i18next";

/** A date as "3 Mar", with the year when it is not this one's. */
export function useDayMonth(today: string): (date: string) => string {
  const { i18n } = useTranslation();
  return useMemo(() => {
    const opts = { day: "numeric", month: "short", timeZone: "UTC" } as const;
    const thisYear = new Intl.DateTimeFormat(i18n.language, opts);
    const otherYear = new Intl.DateTimeFormat(i18n.language, { ...opts, year: "numeric" });
    return (date: string) =>
      (date.slice(0, 4) === today.slice(0, 4) ? thisYear : otherYear).format(
        new Date(`${date}T00:00:00Z`),
      );
  }, [i18n.language, today]);
}

/**
 * For a category that held nothing in the period, when it was last used: "Not
 * used since 3 Mar", or "Never used".
 */
export function useSince(today: string): (lastDate: string | null) => string {
  const { t } = useTranslation();
  const day = useDayMonth(today);
  return (lastDate) =>
    lastDate ? t("categories.notUsedSince", { date: day(lastDate) }) : t("categories.neverUsed");
}
