import { useTranslation } from "react-i18next";

import { useDateFormat } from "../../dates";

/** A local time of day, and "today"/"yesterday" or the date before it. */
export function useWhen() {
  const { t, i18n } = useTranslation();
  const fmtDate = useDateFormat();
  return (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const time = new Intl.DateTimeFormat(i18n.language, {
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
    const day = (x: Date) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
    const now = new Date();
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    if (day(d) === day(now)) return t("mail.today", { time });
    if (day(d) === day(yesterday)) return t("mail.yesterday", { time });
    const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return `${fmtDate(local)} ${time}`;
  };
}

/** A local time of day, for something due in the next minutes. */
export function useClock() {
  const { i18n } = useTranslation();
  return (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return new Intl.DateTimeFormat(i18n.language, { hour: "2-digit", minute: "2-digit" }).format(d);
  };
}
