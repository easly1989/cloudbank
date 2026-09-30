import { ActionIcon, Button, SegmentedControl, Stack } from "@mantine/core";
import { useElementSize, useMediaQuery } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { IconCalendarRepeat, IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";

import {
  ApiError,
  deleteSchedule,
  getScheduleCalendar,
  listSchedules,
  listTemplates,
  postScheduleNow,
  skipSchedule,
  type Schedule,
  type ScheduleOccurrence,
} from "../api/client";
import { attentionColor, expenseColor, incomeColor } from "../amountTone";
import { useConfirm } from "../components/confirmContext";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { Figure, Figures } from "../components/reports/Figures";
import { formatMinor } from "../money";
import { useToday } from "../useToday";
import { useWallet } from "../wallet/WalletProvider";
import {
  Legend,
  MiniMonth,
  MonthCalendar,
  NeedsYou,
  OccurrenceRow,
} from "./schedules/CalendarView";
import { useOccurrenceLabel, useShortDate } from "./schedules/labels";
import { useAccountMoney } from "./schedules/money";
import { OccurrenceSheet } from "./schedules/OccurrenceSheet";
import {
  addDays,
  commitments,
  inFlow,
  isMonth,
  monthFigures,
  monthGrid,
  monthOf,
  needsYou,
  nextUp,
  occurrenceKey,
  shiftMonth,
  type Flow,
} from "./schedules/scheduleCalendar";
import { ScheduleList } from "./schedules/ScheduleList";
import { ScheduleSheet } from "./schedules/ScheduleSheet";
import classes from "./schedules/schedules.module.css";

/** How far back "Needs you" looks for something never registered. */
const NOW_BACK_DAYS = 60;
/** The calendar endpoint's longest span, less a day. */
const MAX_SPAN_DAYS = 99;

/**
 * Schedules (#546): what comes round, on a calendar of the month, and the
 * schedules behind it. It took in the Bills page, which showed each schedule's
 * next unregistered occurrence and so, for a reader who registers months
 * ahead, the bills after those months instead of this one's.
 *
 * The calendar shows every occurrence where it falls — registered ahead, on
 * the day or late, or still to register — and "Needs you" beside it holds what
 * is waiting to be registered. Reconciling stays in the register: a registered
 * occurrence opens there, on its row.
 */
export function SchedulesPage() {
  const { t, i18n } = useTranslation();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { currentWallet } = useWallet();
  const walletId = currentWallet?.id ?? 0;
  const phone = useMediaQuery("(max-width: 47.99em)") ?? false;
  // Below this width a day of the month grid is too narrow for an amount, so
  // the calendar takes the phone's form: a small month, then the month's list.
  const { ref: pageRef, width: pageWidth } = useElementSize();
  const compact = phone || (pageWidth > 0 && pageWidth < 760);
  const today = useToday();
  const short = useShortDate();
  const label = useOccurrenceLabel();
  const money = useAccountMoney(walletId);

  // The view, the month and the flow live in the URL, so a link or a reload
  // lands on the same page.
  const [params, setParams] = useSearchParams();
  const view = params.get("view") === "list" ? "list" : "calendar";
  const monthParam = params.get("month");
  const month = isMonth(monthParam) ? monthParam : monthOf(today);
  const flowParam = params.get("flow");
  const flow: Flow = flowParam === "out" || flowParam === "in" ? flowParam : "all";
  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value == null) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };

  const schedulesQuery = useQuery({
    queryKey: ["schedules", walletId],
    queryFn: () => listSchedules(walletId),
    enabled: walletId > 0,
  });
  const schedules = useMemo(() => schedulesQuery.data ?? [], [schedulesQuery.data]);
  const templatesQuery = useQuery({
    queryKey: ["templates", walletId],
    queryFn: () => listTemplates(walletId),
    enabled: walletId > 0,
  });
  const templateAccount = useMemo(
    () => new Map((templatesQuery.data ?? []).map((tp) => [tp.id, tp.accountId ?? undefined])),
    [templatesQuery.data],
  );

  // The month on screen: every day of the weeks it spans.
  const days = useMemo(() => monthGrid(month), [month]);
  const monthQuery = useQuery({
    queryKey: ["schedule-calendar", walletId, days[0], days.at(-1), today],
    queryFn: () => getScheduleCalendar(walletId, days[0], days.at(-1)!, today),
    enabled: walletId > 0 && schedules.length > 0,
  });
  // Now, whatever month is on screen: what is late, and what comes next.
  const nowFrom = addDays(today, -NOW_BACK_DAYS);
  const nowQuery = useQuery({
    queryKey: ["schedule-calendar", walletId, nowFrom, addDays(nowFrom, MAX_SPAN_DAYS), today],
    queryFn: () => getScheduleCalendar(walletId, nowFrom, addDays(nowFrom, MAX_SPAN_DAYS), today),
    enabled: walletId > 0 && schedules.length > 0,
  });
  const monthOccurrences = useMemo(() => monthQuery.data?.occurrences ?? [], [monthQuery.data]);
  const nowOccurrences = useMemo(() => nowQuery.data?.occurrences ?? [], [nowQuery.data]);
  const shown = useMemo(
    () => monthOccurrences.filter((o) => inFlow(o, flow)),
    [monthOccurrences, flow],
  );
  const figures = useMemo(() => monthFigures(monthOccurrences, month), [monthOccurrences, month]);
  const needs = useMemo(() => needsYou(nowOccurrences, today), [nowOccurrences, today]);
  const upcoming = useMemo(
    () => nextUp(nowOccurrences, today, new Set(needs)),
    [nowOccurrences, today, needs],
  );
  const perPeriod = useMemo(() => commitments(schedules), [schedules]);
  // Each schedule's occurrence in the current month, for the list's last column.
  const thisMonth = useMemo(() => {
    const m = new Map<number, ScheduleOccurrence>();
    const current = monthOf(today);
    for (const o of nowOccurrences)
      if (o.scheduleId != null && monthOf(o.date) === current && !m.has(o.scheduleId))
        m.set(o.scheduleId, o);
    return m;
  }, [nowOccurrences, today]);

  const invalidate = () => {
    for (const key of [
      "schedules",
      "schedule-calendar",
      "register",
      "bills",
      "dashboard",
      "accounts",
    ])
      void qc.invalidateQueries({ queryKey: [key, walletId] });
  };
  const onError = (err: unknown) =>
    notifications.show({
      color: "red",
      message: err instanceof ApiError ? err.message : String(err),
    });
  const register = useMutation({
    mutationFn: (id: number) => postScheduleNow(walletId, id),
    onSuccess: invalidate,
    onError,
  });
  const skip = useMutation({
    mutationFn: (id: number) => skipSchedule(walletId, id),
    onSuccess: invalidate,
    onError,
  });
  const remove = useMutation({
    mutationFn: (id: number) => deleteSchedule(walletId, id),
    onSuccess: invalidate,
    onError,
  });

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<Schedule | null>(null);
  const [opened, setOpened] = useState<ScheduleOccurrence | null>(null);
  const openSchedule = (s: Schedule | null) => {
    setOpened(null);
    setEditing(s);
    setSheetOpen(true);
  };
  const scheduleOf = (o: ScheduleOccurrence) =>
    schedules.find((s) => s.id === o.scheduleId) ?? null;
  // A registered occurrence is a transaction: it opens in the register, on its
  // row, where it can be reconciled. One still to register opens in the sheet.
  const openOccurrence = (o: ScheduleOccurrence) => {
    if (o.state === "registered" && o.transactionId != null) {
      navigate(`/transactions?account=${o.accountId}&txn=${o.transactionId}`);
      return;
    }
    setOpened(o);
  };
  const askDelete = async (s: Schedule) => {
    const ok = await confirm({
      title: t("schedules.confirmDeleteTitle"),
      body: t("schedules.confirmDeleteBody"),
      confirmLabel: t("schedules.delete"),
      danger: true,
    });
    if (ok) {
      remove.mutate(s.id);
      setSheetOpen(false);
    }
  };
  const history = useMemo(() => {
    if (!opened) return [];
    const seen = new Set<string>();
    return [...nowOccurrences, ...monthOccurrences]
      .filter(
        (o) =>
          o.state === "registered" &&
          o.scheduleId === opened.scheduleId &&
          o.date < opened.date &&
          !seen.has(occurrenceKey(o)) &&
          seen.add(occurrenceKey(o)),
      )
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 3);
  }, [opened, nowOccurrences, monthOccurrences]);

  if (!currentWallet) return null;

  const accountName = (id: number) => money.byId.get(id)?.name ?? "";
  const monthTitle = new Intl.DateTimeFormat(i18n.language, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${month}-01T00:00:00Z`));
  const fmt = (n: number) => formatMinor(n, money.base);

  const addButton = (
    <Button data-tour="schedules-add" onClick={() => openSchedule(null)}>
      {t("schedules.add")}
    </Button>
  );
  const views = (
    <SegmentedControl
      data-tour="schedules-views"
      value={view}
      onChange={(v) => setParam("view", v === "list" ? "list" : null)}
      data={[
        { value: "calendar", label: t("schedules.view.calendar") },
        { value: "list", label: t("schedules.view.list") },
      ]}
    />
  );
  const flows = (
    <SegmentedControl
      value={flow}
      onChange={(v) => setParam("flow", v === "all" ? null : v)}
      data={[
        { value: "all", label: t("schedules.flow.all") },
        { value: "out", label: t("schedules.flow.out") },
        { value: "in", label: t("schedules.flow.in") },
      ]}
    />
  );
  const stepper = (
    <>
      <ActionIcon
        variant="default"
        size={36}
        aria-label={t("schedules.prevMonth")}
        onClick={() => setParam("month", shiftMonth(month, -1))}
      >
        <IconChevronLeft size={16} />
      </ActionIcon>
      <div
        className={classes.month}
        aria-live="polite"
        style={phone ? { flex: 1, minWidth: 0 } : undefined}
      >
        {monthTitle}
      </div>
      <ActionIcon
        variant="default"
        size={36}
        aria-label={t("schedules.nextMonth")}
        onClick={() => setParam("month", shiftMonth(month, 1))}
      >
        <IconChevronRight size={16} />
      </ActionIcon>
    </>
  );
  const needsPanel = (
    <NeedsYou
      needs={needs}
      upcoming={upcoming}
      format={money.format}
      accountName={accountName}
      onOpen={openOccurrence}
      onRegister={(o) => o.scheduleId != null && register.mutate(o.scheduleId)}
      onSkip={(o) => o.scheduleId != null && skip.mutate(o.scheduleId)}
      onEditSchedule={(o) => openSchedule(scheduleOf(o))}
      busy={register.isPending || skip.isPending}
      showNextUp={!compact}
    />
  );

  const calendarFigures = (
    <Figures>
      <Figure
        big
        label={t("schedules.fig.toPay")}
        value={fmt(figures.toPay)}
        sub={t("schedules.fig.toPaySub", { total: fmt(figures.outTotal), month: monthTitle })}
        testId="schedules-to-pay"
      />
      {figures.overdueCount > 0 && (
        <Figure
          label={t("schedules.fig.overdue")}
          value={fmt(figures.overdue)}
          color={attentionColor}
          sub={
            figures.overdueCount === 1 && figures.firstOverdue
              ? t("schedules.fig.overdueOne", {
                  name: figures.firstOverdue.name,
                  date: short(figures.firstOverdue.date),
                })
              : t("schedules.fig.overdueMany", { count: figures.overdueCount })
          }
        />
      )}
      {!phone && figures.overdueCount === 0 && figures.outCount > 0 && (
        <Figure
          label={t("status.2")}
          value={fmt(figures.paid)}
          sub={t("schedules.fig.paidSub", { paid: figures.paidCount, count: figures.outCount })}
        />
      )}
      {figures.inTotal > 0 && (!phone || figures.overdueCount === 0) && (
        <Figure
          label={t("schedules.fig.in")}
          value={fmt(figures.inTotal)}
          color={incomeColor}
          sub={
            figures.received >= figures.inTotal
              ? t("schedules.fig.allReceived")
              : t("schedules.fig.toCome", { amount: fmt(figures.inTotal - figures.received) })
          }
        />
      )}
    </Figures>
  );
  const listFigures = (
    <Figures>
      <Figure
        big
        label={t("schedules.fig.net")}
        value={fmt(perPeriod.month.in + perPeriod.month.out)}
        sub={t("schedules.fig.from", { count: schedules.length })}
      />
      <Figure
        label={t("schedules.fig.inMonth")}
        value={fmt(perPeriod.month.in)}
        color={incomeColor}
        sub={t("schedules.fig.perYear", { amount: fmt(perPeriod.year.in) })}
      />
      <Figure
        label={t("schedules.fig.outMonth")}
        value={fmt(perPeriod.month.out)}
        color={expenseColor}
        sub={t("schedules.fig.perYear", { amount: fmt(perPeriod.year.out) })}
      />
    </Figures>
  );

  const monthList = shown
    .filter((o) => monthOf(o.date) === month)
    .map((o) => (
      <OccurrenceRow
        key={occurrenceKey(o)}
        o={o}
        format={money.format}
        meta={`${short(o.date)} · ${label(o)}`}
        onOpen={openOccurrence}
      />
    ));

  return (
    <Stack ref={pageRef} className={classes.page} gap="lg">
      <PageHeader
        tour="schedules"
        title={t("schedules.title")}
        hint={t("schedules.hint")}
        actions={schedules.length > 0 ? addButton : undefined}
      />

      {schedules.length === 0 && schedulesQuery.isSuccess && (
        <EmptyState
          icon={IconCalendarRepeat}
          message={t("schedules.empty")}
          hint={t("schedules.emptyHint")}
          action={addButton}
        />
      )}

      {schedules.length > 0 && view === "calendar" && (
        <>
          {calendarFigures}
          {compact ? (
            <>
              <div className={classes.bar}>
                {views}
                {flows}
              </div>
              <div className={classes.bar} style={{ flexWrap: "nowrap" }}>
                {stepper}
              </div>
              {needsPanel}
              <MiniMonth month={month} days={days} occurrences={shown} today={today} />
              {monthList.length > 0 && <div className={classes.card}>{monthList}</div>}
            </>
          ) : (
            <>
              <div className={classes.bar}>
                {views}
                <span className={classes.gap} />
                {stepper}
                <Button variant="default" onClick={() => setParam("month", null)}>
                  {t("schedules.today")}
                </Button>
                <span className={classes.gap} />
                {flows}
              </div>
              <div className={classes.main}>
                <MonthCalendar
                  month={month}
                  days={days}
                  occurrences={shown}
                  today={today}
                  format={money.format}
                  onOpen={openOccurrence}
                />
                {needsPanel}
              </div>
              <Legend />
            </>
          )}
        </>
      )}

      {schedules.length > 0 && view === "list" && (
        <>
          {listFigures}
          <div className={classes.bar}>{views}</div>
          <ScheduleList
            schedules={schedules}
            thisMonth={thisMonth}
            today={today}
            phone={phone}
            format={money.format}
            accountOf={(s) => {
              const id = templateAccount.get(s.templateId);
              return { id, name: id != null ? accountName(id) : "" };
            }}
            actions={{
              onEdit: openSchedule,
              onRegister: (s) => register.mutate(s.id),
              onSkip: (s) => skip.mutate(s.id),
              onDelete: (s) => void askDelete(s),
            }}
          />
        </>
      )}

      <OccurrenceSheet
        walletId={walletId}
        occurrence={opened}
        account={opened ? money.byId.get(opened.accountId) : undefined}
        history={history}
        today={today}
        format={money.format}
        onClose={() => setOpened(null)}
        onDone={invalidate}
        onEditSchedule={(o) => openSchedule(scheduleOf(o))}
      />
      <ScheduleSheet
        opened={sheetOpen}
        onClose={() => setSheetOpen(false)}
        walletId={walletId}
        editing={editing}
        onSaved={invalidate}
        onDelete={(s) => void askDelete(s)}
      />
    </Stack>
  );
}
