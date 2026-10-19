import { Button } from "@mantine/core";
import { IconListSearch } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

import type { ScheduleProposal } from "../../api/client";
import { amountColor } from "../../amountTone";
import classes from "./schedules.module.css";

const utc = (date: string) => new Date(`${date}T00:00:00Z`);

/**
 * The recurring payments found in the transactions that no schedule covers
 * (#693): each with how often it comes round, how many times and since when,
 * the usual amount and what it adds up to in a year, and the way to make it a
 * schedule or to stop seeing it. A card of its own: above the list, and under
 * "Needs you" beside the calendar.
 */
export function FoundPayments({
  proposals,
  format,
  columns = 1,
  onCreate,
  onIgnore,
  busy,
}: {
  proposals: ScheduleProposal[];
  format: (amount: number, accountId?: number) => string;
  columns?: 1 | 2;
  onCreate: (p: ScheduleProposal) => void;
  onIgnore: (p: ScheduleProposal) => void;
  busy: boolean;
}) {
  const { t, i18n } = useTranslation();
  if (!proposals.length) return null;
  const fmt = (date: string, o: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(i18n.language, { ...o, timeZone: "UTC" }).format(utc(date));
  const cadence = (p: ScheduleProposal) =>
    t(`schedules.found.${p.cadence}`, {
      day: utc(p.nextDue).getUTCDate(),
      weekday: fmt(p.nextDue, { weekday: "long" }),
      date: fmt(p.nextDue, { day: "numeric", month: "long" }),
    });
  const seen = (p: ScheduleProposal) =>
    t("schedules.found.seen", {
      count: p.count,
      month: fmt(
        p.first,
        p.first.slice(0, 4) === p.last.slice(0, 4)
          ? { month: "long" }
          : { month: "long", year: "numeric" },
      ),
      date: fmt(p.last, { day: "numeric", month: "short" }),
    });
  return (
    <div className={classes.card} data-testid="found-payments">
      <div className={classes.sideTitle}>{t("schedules.found.title")}</div>
      <div className={classes.sideSub}>{t("schedules.found.sub")}</div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {proposals.map((p) => (
          <div
            key={`${p.payeeId}:${p.cadence}:${p.amount > 0}`}
            className={classes.item}
            data-testid="found-payment"
          >
            <IconListSearch
              size={16}
              aria-hidden
              style={{ color: "var(--mantine-color-dimmed)" }}
            />
            <div style={{ minWidth: 0 }}>
              <div className={classes.itemName}>{p.payeeName}</div>
              <div className={classes.itemMeta}>{cadence(p)}</div>
              <div className={classes.itemMeta}>{seen(p)}</div>
            </div>
            <div style={{ textAlign: "end" }}>
              <div className={classes.itemAmount} style={{ color: amountColor(p.amount) }}>
                {format(p.amount, p.accountId)}
              </div>
              <div className={classes.itemMeta} style={{ whiteSpace: "nowrap" }} data-cb-sensitive>
                {t("schedules.list.perYear", { amount: format(p.yearly, p.accountId) })}
              </div>
            </div>
            <div className={classes.itemActions}>
              <Button size="xs" variant="default" onClick={() => onCreate(p)} disabled={busy}>
                {t("schedules.found.create")}
              </Button>
              <Button
                size="xs"
                variant="subtle"
                color="gray"
                onClick={() => onIgnore(p)}
                disabled={busy}
              >
                {t("schedules.found.ignore")}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
