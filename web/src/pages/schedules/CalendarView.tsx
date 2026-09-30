import { ActionIcon, Button, Menu, UnstyledButton } from "@mantine/core";
import { IconAlertCircle, IconCalendarEvent, IconDots } from "@tabler/icons-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import type { ScheduleOccurrence } from "../../api/client";
import { amountColor } from "../../amountTone";
import { STATUS_ICONS } from "../../components/statusIcons";
import { useOccurrenceLabel, useShortDate } from "./labels";
import { OccurrenceIcon } from "./OccurrenceIcon";
import { isPaid, monthOf, occurrenceKey } from "./scheduleCalendar";
import classes from "./schedules.module.css";

type Format = (amount: number, accountId?: number) => string;

/** Monday to Sunday, in the reader's language. */
function useWeekdays(style: "short" | "narrow") {
  const { i18n } = useTranslation();
  return useMemo(() => {
    const f = new Intl.DateTimeFormat(i18n.language, { weekday: style, timeZone: "UTC" });
    // 2024-01-01 was a Monday.
    return Array.from({ length: 7 }, (_, i) => f.format(new Date(Date.UTC(2024, 0, 1 + i))));
  }, [i18n.language, style]);
}

const byDay = (occurrences: ScheduleOccurrence[]) => {
  const m = new Map<string, ScheduleOccurrence[]>();
  for (const o of occurrences) m.set(o.date, [...(m.get(o.date) ?? []), o]);
  return m;
};

/**
 * The month as a calendar: every day of the weeks it spans, and on each day
 * what comes due on it, with where it stands. The days of the months around it
 * show too, faintly — a bill registered ahead for the 1st of next month is
 * something the reader wants to see at the end of this one.
 */
export function MonthCalendar({
  month,
  days,
  occurrences,
  today,
  format,
  onOpen,
}: {
  month: string;
  days: string[];
  occurrences: ScheduleOccurrence[];
  today: string;
  format: Format;
  onOpen: (o: ScheduleOccurrence) => void;
}) {
  const weekdays = useWeekdays("short");
  const label = useOccurrenceLabel();
  const on = useMemo(() => byDay(occurrences), [occurrences]);
  return (
    <div className={classes.card} data-testid="schedules-calendar">
      <div className={classes.weekdays} aria-hidden>
        {weekdays.map((d) => (
          <div key={d}>{d}</div>
        ))}
      </div>
      <div className={classes.grid}>
        {days.map((d, i) => {
          const outside = monthOf(d) !== month;
          return (
            <div
              key={d}
              className={classes.day}
              data-outside={outside || undefined}
              data-weekend={i % 7 >= 5 || undefined}
              data-today={d === today || undefined}
              data-date={d}
            >
              <span className={classes.dayNumber}>{Number(d.slice(8))}</span>
              {(on.get(d) ?? []).map((o) => (
                <UnstyledButton
                  key={occurrenceKey(o)}
                  className={classes.chip}
                  data-state={o.state}
                  data-paid={isPaid(o) || undefined}
                  data-outside={outside || undefined}
                  onClick={() => onOpen(o)}
                  aria-label={`${o.name}, ${format(o.amount, o.accountId)}, ${label(o)}`}
                  title={`${o.name}, ${format(o.amount, o.accountId)}`}
                >
                  <OccurrenceIcon o={o} />
                  <span className={classes.chipName}>{o.name}</span>
                  <span className={classes.chipAmount} style={{ color: amountColor(o.amount) }}>
                    {format(o.amount, o.accountId)}
                  </span>
                </UnstyledButton>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The key under the calendar: one icon per state, each named. */
export function Legend() {
  const { t } = useTranslation();
  const [None, Cleared, Reconciled] = STATUS_ICONS;
  return (
    <div className={classes.legend}>
      <span>
        <IconCalendarEvent size={13} aria-hidden />
        {t("schedules.state.todo")}
      </span>
      <span>
        <None size={13} aria-hidden />
        {t("schedules.state.registered")}
      </span>
      <span>
        <Cleared size={13} aria-hidden />
        {t("status.1")}
      </span>
      <span>
        <Reconciled size={13} aria-hidden />
        {t("status.2")}
      </span>
      <span className={classes.late}>
        <IconAlertCircle size={13} aria-hidden />
        {t("schedules.state.overdue")}
      </span>
    </div>
  );
}

/**
 * The month on a phone: seven narrow columns with an icon under each day that
 * has something on it. The occurrences themselves are listed under it.
 */
export function MiniMonth({
  month,
  days,
  occurrences,
  today,
}: {
  month: string;
  days: string[];
  occurrences: ScheduleOccurrence[];
  today: string;
}) {
  const weekdays = useWeekdays("narrow");
  const on = useMemo(() => byDay(occurrences), [occurrences]);
  return (
    <div className={`${classes.card} ${classes.mini}`} data-testid="schedules-calendar">
      {weekdays.map((d, i) => (
        <div key={i} className={classes.miniWeekday} aria-hidden>
          {d}
        </div>
      ))}
      {days.map((d) => {
        const list = on.get(d) ?? [];
        // The day's most pressing occurrence speaks for it.
        const first =
          list.find((o) => o.state === "overdue") ??
          list.find((o) => o.state === "due") ??
          list.find((o) => !isPaid(o)) ??
          list[0];
        return (
          <div
            key={d}
            className={classes.miniDay}
            data-outside={monthOf(d) !== month || undefined}
            data-today={d === today || undefined}
          >
            <span>{Number(d.slice(8))}</span>
            {first && (
              <span
                className={classes.miniMark}
                data-state={first.state}
                data-paid={isPaid(first) || undefined}
              >
                <OccurrenceIcon o={first} size={12} />
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** One occurrence as a row: on a phone's month list, and in "Next up". */
export function OccurrenceRow({
  o,
  format,
  meta,
  onOpen,
  quiet = false,
  upcoming = false,
}: {
  o: ScheduleOccurrence;
  format: Format;
  meta: string;
  onOpen: (o: ScheduleOccurrence) => void;
  quiet?: boolean;
  upcoming?: boolean;
}) {
  return (
    <UnstyledButton
      className={classes.item}
      data-state={o.state}
      data-quiet={quiet || undefined}
      onClick={() => onOpen(o)}
    >
      <OccurrenceIcon o={o} size={16} upcoming={upcoming} />
      <div style={{ minWidth: 0 }}>
        <div className={classes.itemName}>{o.name}</div>
        <div className={classes.itemMeta}>{meta}</div>
      </div>
      <div className={classes.itemAmount} style={{ color: amountColor(o.amount) }}>
        {format(o.amount, o.accountId)}
      </div>
    </UnstyledButton>
  );
}

/**
 * What needs the reader, and what comes next. Only registering happens here:
 * reconciling is the register's work, and a registered bill opens there.
 */
export function NeedsYou({
  needs,
  upcoming,
  format,
  accountName,
  onOpen,
  onRegister,
  onSkip,
  onEditSchedule,
  busy,
  showNextUp = true,
}: {
  needs: ScheduleOccurrence[];
  upcoming: ScheduleOccurrence[];
  format: Format;
  accountName: (id: number) => string;
  onOpen: (o: ScheduleOccurrence) => void;
  onRegister: (o: ScheduleOccurrence) => void;
  onSkip: (o: ScheduleOccurrence) => void;
  onEditSchedule: (o: ScheduleOccurrence) => void;
  busy: boolean;
  showNextUp?: boolean;
}) {
  const { t } = useTranslation();
  const short = useShortDate();
  const upcomingMeta = (o: ScheduleOccurrence) =>
    t(
      o.state === "registered"
        ? "schedules.meta.ahead"
        : o.autoPost
          ? "schedules.meta.auto"
          : "schedules.meta.todo",
      { date: short(o.date) },
    );
  return (
    <div className={classes.card} data-testid="schedules-needs-you" data-tour="schedules-needs">
      <div className={classes.sideTitle}>{t("schedules.needsYou")}</div>
      <div className={classes.sideSub}>
        {needs.length ? t("schedules.toRegister", { count: needs.length }) : t("schedules.allDone")}
      </div>
      {needs.map((o) => (
        <div
          key={occurrenceKey(o)}
          className={classes.item}
          data-state={o.state}
          data-testid="needs-item"
        >
          <OccurrenceIcon o={o} size={16} />
          <UnstyledButton onClick={() => onOpen(o)} style={{ minWidth: 0 }}>
            <div className={classes.itemName}>{o.name}</div>
            <div className={classes.itemMeta}>
              {t(o.state === "overdue" ? "schedules.meta.overdue" : "schedules.meta.due", {
                date: short(o.date),
                account: accountName(o.accountId),
              })}
            </div>
          </UnstyledButton>
          <div className={classes.itemAmount} style={{ color: amountColor(o.amount) }}>
            {format(o.amount, o.accountId)}
          </div>
          {o.next && o.scheduleId != null && (
            <div className={classes.itemActions}>
              <Button size="xs" onClick={() => onRegister(o)} disabled={busy}>
                {t("schedules.register")}
              </Button>
              <Button size="xs" variant="default" onClick={() => onSkip(o)} disabled={busy}>
                {t("schedules.skip")}
              </Button>
              <Menu position="bottom-end" withinPortal>
                <Menu.Target>
                  <ActionIcon
                    variant="default"
                    size={30}
                    ml="auto"
                    aria-label={t("schedules.more")}
                  >
                    <IconDots size={15} />
                  </ActionIcon>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Item onClick={() => onOpen(o)}>{t("schedules.changeFirst")}</Menu.Item>
                  <Menu.Item onClick={() => onEditSchedule(o)}>
                    {t("schedules.editSchedule")}
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>
            </div>
          )}
        </div>
      ))}
      {showNextUp && upcoming.length > 0 && (
        <>
          <div className={classes.sideHeading}>{t("schedules.nextUp")}</div>
          {upcoming.map((o) => (
            <OccurrenceRow
              key={occurrenceKey(o)}
              o={o}
              format={format}
              meta={upcomingMeta(o)}
              onOpen={onOpen}
              quiet
              upcoming
            />
          ))}
        </>
      )}
    </div>
  );
}
