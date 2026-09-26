import { MultiSelect, SegmentedControl, Stack, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import type { EChartsOption } from "echarts";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  type BalanceSeries,
  type ReportBucket,
  getBalanceReport,
  listAccounts,
} from "../../api/client";
import { useChartColors } from "../../chartPalette";
import { toCivilDate } from "../../civilDate";
import { formatAxisMinor, formatMinor } from "../../money";
import { Chart, type ChartHandle } from "../Chart";
import { Figure, Figures } from "./Figures";
import {
  type ReportContext,
  csvAmount,
  longDay,
  periodName,
  periodPhrase,
  shortDay,
} from "./reportContext";
import type { PeriodKind } from "./reportState";
import { baseFmt, todayBucketKey } from "./reportUtils";
import classes from "./reports.module.css";

/** Points per chart: a day a point for a month, a month a point for a year. */
const BUCKET: Record<PeriodKind, ReportBucket> = {
  month: "day",
  quarter: "week",
  half: "week",
  year: "month",
  all: "month",
};

// Balances (#492): what all the accounts hold today, how that moved over the
// period, and where the schedules take it by the period's end. Balances move in
// steps, so the line is stepped; each account gets a row of its own instead of
// four lines on one scale; and a minimum that was crossed is said in words, on
// the account it belongs to.
export function BalancesTab({ ctx }: { ctx: ReportContext }) {
  const { t, i18n } = useTranslation();
  const colors = useChartColors();
  const { walletId, state, set, period, fmt, isPhone, setExport } = ctx;
  const bucket = BUCKET[period.kind];
  const chartRef = useRef<ChartHandle>(null);
  const today = toCivilDate(new Date());

  const accountsQuery = useQuery({
    queryKey: ["accounts", walletId],
    queryFn: () => listAccounts(walletId),
    enabled: walletId > 0,
  });
  const [picking, setPicking] = useState(state.accounts.length > 0);

  const query = useQuery({
    queryKey: ["balance", walletId, bucket, state.accounts, period.from, period.to, today],
    queryFn: () =>
      getBalanceReport(walletId, bucket, state.accounts, period.from, period.to, {
        asOf: today,
        scheduled: true,
      }),
    enabled: walletId > 0,
  });
  const res = query.data;
  const buckets = useMemo(() => res?.buckets ?? [], [res]);
  const total = useMemo(() => res?.total ?? [], [res]);

  // Where today falls on the axis: -1 before it, the last bucket after it.
  const nowKey = todayBucketKey(bucket);
  const past = !!period.to && period.to < today;
  const future = !!period.from && period.from > today;
  const todayIdx = past ? buckets.length - 1 : future ? -1 : buckets.indexOf(nowKey);
  const projects = !past && buckets.length > 0 && todayIdx < buckets.length - 1;

  const label = (key: string) => {
    if (bucket === "month") {
      const [y, m] = key.split("-").map(Number);
      const years = new Set(buckets.map((b) => b.slice(0, 4)));
      const name = new Intl.DateTimeFormat(i18n.language, { month: "short" }).format(
        new Date(y, m - 1, 1),
      );
      return `${name.charAt(0).toUpperCase()}${name.slice(1)}${years.size > 1 ? ` ${String(y).slice(2)}` : ""}`;
    }
    return shortDay(key, i18n.language);
  };

  const option: EChartsOption = useMemo(() => {
    const money = (v: unknown) => (v == null ? "—" : formatMinor(Number(v) || 0, fmt));
    const upTo = (i: number) => (todayIdx < 0 ? false : i <= todayIdx);
    return {
      animation: false,
      grid: { left: 8, right: 12, top: 22, bottom: 8, containLabel: true },
      tooltip: { trigger: "axis", valueFormatter: money },
      xAxis: {
        type: "category",
        data: buckets.map(label),
        axisTick: { show: false },
        axisLabel: { rotate: 0, hideOverlap: true },
        boundaryGap: false,
      },
      yAxis: {
        type: "value",
        scale: true,
        axisLabel: { formatter: (v: number) => formatAxisMinor(v, fmt) },
      },
      series: [
        {
          name: t("reports.balances.total"),
          type: "line",
          step: "end",
          symbol: "none",
          data: total.map((v, i) => (upTo(i) ? v : null)),
          lineStyle: { color: colors.ink, width: 2 },
          itemStyle: { color: colors.ink },
          areaStyle: { color: colors.ink, opacity: 0.06 },
          markLine:
            todayIdx >= 0 && !past
              ? {
                  symbol: "none",
                  silent: true,
                  lineStyle: { color: colors.muted, type: "solid" },
                  label: {
                    formatter: t("reports.today"),
                    color: colors.muted,
                    // Level, above the line's top: never turned on its side.
                    position: "end",
                  },
                  data: [{ xAxis: todayIdx }],
                }
              : undefined,
        },
        {
          name: t("reports.balances.scheduled"),
          type: "line",
          step: "end",
          symbol: "none",
          data: total.map((v, i) => (i >= Math.max(todayIdx, 0) && !past ? v : null)),
          lineStyle: { color: colors.ink, width: 2, type: "dashed", opacity: 0.55 },
          itemStyle: { color: colors.ink },
        },
      ],
    };
    // label reads buckets and the language, both covered.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buckets, total, todayIdx, past, colors, fmt, t, i18n.language]);

  useEffect(() => {
    setExport({
      name: `balances-${period.from?.slice(0, 7) ?? "all"}`,
      rows: () => [
        [
          t(`reports.buckets.${bucket}`),
          t("reports.balances.total"),
          ...(res?.series ?? []).map((s) => s.label),
        ],
        ...buckets.map((b, i) => [
          b,
          csvAmount(total[i], fmt.fracDigits),
          ...(res?.series ?? []).map((s) =>
            csvAmount(s.values[i], s.currency?.fracDigits ?? fmt.fracDigits),
          ),
        ]),
      ],
      png: () => chartRef.current?.getPng(),
    });
    return () => setExport(null);
  }, [res, buckets, total, bucket, fmt, period.from, setExport, t]);

  const name = periodName(period, t, i18n.language, true);
  const signed = (v: number, f = fmt) => `${v > 0 ? "+" : ""}${formatMinor(v, f)}`;
  const since = period.from
    ? t("reports.balances.since", { date: longDay(period.from, i18n.language) })
    : t("reports.balances.sinceStart");
  const end = total[total.length - 1] ?? 0;
  const picked = state.accounts.length > 0;

  return (
    <Stack gap="lg">
      {res && res.series.length > 0 && (
        <Figures>
          {!past && !future && (
            <Figure
              big
              testId="balances-today"
              label={t(picked ? "reports.balances.pickedToday" : "reports.balances.allToday")}
              value={formatMinor(res.todayTotal, fmt)}
              color={res.todayTotal < 0 ? colors.out : undefined}
              sub={`${signed(res.todayTotal - res.startTotal)} ${since}`}
            />
          )}
          {past && (
            <Figure
              big
              testId="balances-end"
              label={periodPhrase(period, t, i18n.language, "atEnd")}
              value={formatMinor(end, fmt)}
              sub={`${signed(end - res.startTotal)} ${since}`}
            />
          )}
          {projects && (
            <Figure
              testId="balances-projected"
              label={periodPhrase(period, t, i18n.language, "byEnd")}
              value={formatMinor(end, fmt)}
              sub={t("reports.balances.withScheduled")}
            />
          )}
        </Figures>
      )}

      <div className={classes.controls}>
        <SegmentedControl
          aria-label={t("reports.balances.which")}
          value={picking ? "pick" : "all"}
          onChange={(v) => {
            setPicking(v === "pick");
            if (v === "all") set({ accounts: [] });
          }}
          data={[
            { value: "all", label: t("reports.allAccounts") },
            { value: "pick", label: t("reports.balances.pick") },
          ]}
        />
        {picking && (
          <MultiSelect
            aria-label={t("reports.accounts")}
            placeholder={t("reports.balances.pickPlaceholder")}
            data={(accountsQuery.data ?? []).map((a) => ({ value: String(a.id), label: a.name }))}
            value={state.accounts.map(String)}
            onChange={(v) => set({ accounts: v.map(Number) })}
            searchable
            clearable
            w={isPhone ? "100%" : 320}
          />
        )}
      </div>

      {res && res.series.length === 0 && <Text c="dimmed">{t("reports.empty")}</Text>}

      {res && res.series.length > 0 && (
        <>
          <Chart
            ref={chartRef}
            option={option}
            height={isPhone ? 200 : 240}
            label={t("reports.balances.chartLabel", { period: name })}
          />
          <div data-testid="balances-accounts">
            {res.series.map((s) => (
              <AccountRow
                key={s.accountId}
                s={s}
                upTo={todayIdx < 0 ? 0 : todayIdx}
                past={past}
                when={periodPhrase(period, t, i18n.language, "in")}
                color={colors.muted}
              />
            ))}
          </div>
        </>
      )}
    </Stack>
  );
}

function AccountRow({
  s,
  upTo,
  past,
  when,
  color,
}: {
  s: BalanceSeries;
  /** The last bucket that has happened. */
  upTo: number;
  past: boolean;
  /** The period in a sentence: "in 2026". */
  when: string;
  color: string;
}) {
  const { t, i18n } = useTranslation();
  const fmt = baseFmt(s.currency);
  const balance = past ? (s.values[s.values.length - 1] ?? s.start) : s.today;
  const change = balance - s.start;
  const signed = `${change > 0 ? "+" : ""}${formatMinor(change, fmt)}`;
  return (
    <div className={classes.acc} data-testid="balances-account">
      <span>{s.label}</span>
      <Spark values={s.values.slice(0, upTo + 1)} color={color} />
      <span className={classes.accBalance}>
        <span style={{ color: balance < 0 ? "var(--cb-negative)" : undefined }}>
          {formatMinor(balance, fmt)}
        </span>
        <div className={classes.accNote}>
          {t("reports.balances.change", { amount: signed, when })}
        </div>
      </span>
      <span className={`${classes.accNote} ${classes.accLow}`}>
        {s.lowDate ? t("reports.balances.lowest", { amount: formatMinor(s.low, fmt) }) : ""}
      </span>
      {s.underMinimumOn && (
        <span className={classes.accWarn}>
          {t("reports.balances.under", {
            amount: formatMinor(s.minimumBalance, fmt),
            date: longDay(s.underMinimumOn, i18n.language),
          })}
        </span>
      )}
    </div>
  );
}

// A line of one account's balance, too small for an axis: its shape is the point,
// the figures beside it carry the numbers.
function Spark({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return <span className={classes.spark} />;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const x = (i: number) => (i / (values.length - 1)) * 116 + 2;
  const y = (v: number) => 22 - ((v - lo) / (hi - lo || 1)) * 18;
  // Stepped, like the chart above it: a balance holds until the next transaction.
  let d = `M${x(0)},${y(values[0])}`;
  for (let i = 1; i < values.length; i++) d += ` H${x(i)} V${y(values[i])}`;
  return (
    <svg
      className={classes.spark}
      width="120"
      height="26"
      viewBox="0 0 120 26"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path d={d} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
