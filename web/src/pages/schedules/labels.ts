import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import type { ScheduleOccurrence } from "../../api/client";
import { isPaid } from "./scheduleCalendar";

/** Where an occurrence stands, in words. */
export function useOccurrenceLabel() {
  const { t } = useTranslation();
  return (o: ScheduleOccurrence) => {
    if (o.state === "overdue") return t("schedules.state.overdue");
    if (o.state === "due") return t(o.autoPost ? "schedules.state.auto" : "schedules.state.todo");
    if (isPaid(o)) return t("status.2");
    return o.status ? t(`status.${o.status}`) : t("schedules.state.registered");
  };
}

/** A civil date as "Sat 26 Sep", in the reader's language. */
export function useShortDate(): (date: string) => string {
  const { i18n } = useTranslation();
  return useMemo(() => {
    const f = new Intl.DateTimeFormat(i18n.language, {
      weekday: "short",
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });
    return (date: string) => f.format(new Date(`${date}T00:00:00Z`));
  }, [i18n.language]);
}
