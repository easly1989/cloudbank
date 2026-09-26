import { SegmentedControl, Stack, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import type { EChartsOption } from "echarts";
import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";

import { getTrend } from "../../api/client";
import { useChartColors } from "../../chartPalette";
import { toCivilDate } from "../../civilDate";
import { formatAxisMinor, formatMinor } from "../../money";
import { Chart, type ChartHandle } from "../Chart";
import { Figure, Figures } from "./Figures";
import { type ReportContext, csvAmount, periodName, periodPhrase, shortDay } from "./reportContext";
import { FLOW_BUCKETS, type FlowBucket, defaultBucket } from "./reportState";
import { todayBucketKey } from "./reportUtils";
import classes from "./reports.module.css";

interface Bucket {
  key: string;
  in: number;
  /** Negative: money going out. */
  out: number;
  kept: number;
  /** What was kept from the period's start through this bucket. */
  running: number;
  /** Today falls inside it, so it is not over. */
  partial: boolean;
}

// Cash flow (#491): what came in and what went out, bar by bar, and what was
// kept. One net line hid both halves, so a month whose salary had not arrived
// yet looked like a collapse; now the two are drawn apart, and the month still
// running says so.
export function CashFlowTab({ ctx }: { ctx: ReportContext }) {
  const { t, i18n } = useTranslation();
  const colors = useChartColors();
  const { walletId, state, set, period, current, params, fmt, isPhone, setExport } = ctx;
  const bucket: FlowBucket = state.bucket ?? defaultBucket(period.kind);
  const chartRef = useRef<ChartHandle>(null);

  // Up to today: the figures are "so far", and a future that has not happened
  // is not drawn as bars of zero.
  const today = toCivilDate(new Date());
  const future = !!period.from && period.from > today;
  const flowParams = useMemo(() => {
    const p = { ...params };
    if (!p.to || p.to > today) p.to = today;
    return p;
  }, [params, today]);

  const query = useQuery({
    queryKey: ["trend", walletId, bucket, "flow", flowParams],
    queryFn: () => getTrend(walletId, bucket, "flow", flowParams),
    enabled: walletId > 0 && !future,
  });

  const buckets: Bucket[] = useMemo(() => {
    const res = query.data;
    if (!res) return [];
    const ins = res.series.find((s) => s.key === "in")?.values ?? [];
    const outs = res.series.find((s) => s.key === "out")?.values ?? [];
    const now = todayBucketKey(bucket);
    let running = 0;
    return res.buckets.map((key, i) => {
      const kept = (ins[i] ?? 0) + (outs[i] ?? 0);
      running += kept;
      return { key, in: ins[i] ?? 0, out: outs[i] ?? 0, kept, running, partial: key === now };
    });
  }, [query.data, bucket]);

  const totalIn = buckets.reduce((s, b) => s + b.in, 0);
  const totalOut = buckets.reduce((s, b) => s + b.out, 0);
  const kept = totalIn + totalOut;

  // Short labels, never rotated: a year is added only when the bars span more
  // than one.
  const years = new Set(buckets.map((b) => b.key.slice(0, 4)));
  const label = (key: string) => {
    const [y, rest] = [key.slice(0, 4), key.slice(5)];
    const yy = years.size > 1 ? ` ${y.slice(2)}` : "";
    if (bucket === "quarter") return `${rest}${yy}`;
    if (bucket === "week") return shortDay(key, i18n.language);
    const name = new Intl.DateTimeFormat(i18n.language, { month: "short" }).format(
      new Date(Number(y), Number(rest) - 1, 1),
    );
    return `${name.charAt(0).toUpperCase()}${name.slice(1)}${yy}`;
  };

  const option: EChartsOption = useMemo(() => {
    const money = (v: unknown) => formatMinor(Number(v) || 0, fmt);
    const partial = (b: Bucket, color: string) => ({
      value: 0,
      itemStyle: { color, opacity: b.partial ? 0.55 : 1 },
    });
    return {
      animation: false,
      grid: { left: 8, right: 8, top: 16, bottom: 8, containLabel: true },
      tooltip: { trigger: "axis", valueFormatter: money },
      xAxis: {
        type: "category",
        data: buckets.map((b) =>
          b.partial ? `${label(b.key)}\n${t("reports.cashflow.soFar")}` : label(b.key),
        ),
        axisTick: { show: false },
        axisLabel: { rotate: 0, hideOverlap: true },
      },
      yAxis: { type: "value", axisLabel: { formatter: (v: number) => formatAxisMinor(v, fmt) } },
      series: [
        {
          name: t("reports.cashflow.in"),
          type: "bar",
          barMaxWidth: 26,
          barGap: "8%",
          data: buckets.map((b) => ({ ...partial(b, colors.in), value: b.in })),
        },
        {
          name: t("reports.cashflow.out"),
          type: "bar",
          barMaxWidth: 26,
          data: buckets.map((b) => ({ ...partial(b, colors.out), value: b.out })),
        },
        {
          name: t("reports.cashflow.kept"),
          type: "line",
          data: buckets.map((b) => b.kept),
          symbol: "circle",
          symbolSize: 9,
          lineStyle: { opacity: 0 },
          itemStyle: { color: colors.surface, borderColor: colors.ink, borderWidth: 2 },
          z: 5,
        },
      ],
    };
    // label reads buckets and the language, both covered.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buckets, colors, fmt, t, i18n.language, bucket]);

  useEffect(() => {
    setExport({
      name: `cash-flow-${period.from?.slice(0, 7) ?? "all"}`,
      rows: () => [
        [
          t(`reports.buckets.${bucket}`),
          t("reports.cashflow.in"),
          t("reports.cashflow.out"),
          t("reports.cashflow.kept"),
          t("reports.cashflow.running"),
        ],
        ...buckets.map((b) => [
          b.key,
          csvAmount(b.in, fmt.fracDigits),
          csvAmount(b.out, fmt.fracDigits),
          csvAmount(b.kept, fmt.fracDigits),
          csvAmount(b.running, fmt.fracDigits),
        ]),
      ],
      png: () => chartRef.current?.getPng(),
    });
    return () => setExport(null);
  }, [buckets, bucket, fmt, period.from, setExport, t]);

  const plain = { ...fmt, symbol: "" };
  const signed = (v: number, f = fmt) => `${v > 0 ? "+" : ""}${formatMinor(v, f)}`;
  const name = periodName(period, t, i18n.language, true);
  const share = totalIn > 0 ? Math.round((kept / totalIn) * 100) : null;

  return (
    <Stack gap="lg">
      {future ? (
        <Text c="dimmed">{t("reports.cashflow.future")}</Text>
      ) : (
        <Figures>
          <Figure
            big
            testId="cashflow-kept"
            label={t(current ? "reports.cashflow.keptSoFar" : "reports.cashflow.keptIn", {
              when: periodPhrase(period, t, i18n.language, "in"),
            })}
            value={signed(kept)}
            color={kept > 0 ? colors.in : kept < 0 ? colors.out : undefined}
            sub={
              kept < 0
                ? t("reports.cashflow.overspent")
                : share !== null
                  ? t("reports.cashflow.share", { pct: share })
                  : undefined
            }
          />
          <Figure
            label={t("reports.cashflow.in")}
            value={signed(totalIn)}
            color={totalIn ? colors.in : undefined}
          />
          <Figure
            label={t("reports.cashflow.out")}
            value={formatMinor(totalOut, fmt)}
            color={totalOut ? colors.out : undefined}
          />
        </Figures>
      )}

      <div className={classes.controls}>
        <Text size="sm" c="dimmed">
          {t("reports.cashflow.barPer")}
        </Text>
        <SegmentedControl
          aria-label={t("reports.cashflow.barPer")}
          value={bucket}
          onChange={(v) => set({ bucket: v as FlowBucket })}
          data={FLOW_BUCKETS.map((b) => ({ value: b, label: t(`reports.buckets.${b}`) }))}
        />
      </div>

      {query.data && totalIn === 0 && totalOut === 0 && (
        <Text c="dimmed">{t("reports.empty")}</Text>
      )}

      {!future && (totalIn !== 0 || totalOut !== 0) && (
        <div className={classes.cols} data-wide>
          <div>
            <Chart
              ref={chartRef}
              option={option}
              height={isPhone ? 220 : 260}
              label={t("reports.cashflow.chartLabel", { period: name })}
            />
            <div className={classes.legend}>
              <span className={classes.legendItem}>
                <span className={classes.swatch} style={{ background: colors.in }} />
                {t("reports.cashflow.in")}
              </span>
              <span className={classes.legendItem}>
                <span className={classes.swatch} style={{ background: colors.out }} />
                {t("reports.cashflow.out")}
              </span>
              <span className={classes.legendItem}>
                <span className={classes.dotSwatch} />
                {t("reports.cashflow.keptLegend")}
              </span>
            </div>
          </div>
          <table className={classes.table} data-testid="cashflow-table">
            <thead>
              <tr>
                <th>{t(`reports.buckets.${bucket}`)}</th>
                <th className={classes.wideOnly}>{t("reports.cashflow.in")}</th>
                <th className={classes.wideOnly}>{t("reports.cashflow.out")}</th>
                <th>{t("reports.cashflow.kept")}</th>
                <th>{t("reports.cashflow.running")}</th>
              </tr>
            </thead>
            <tbody>
              {[...buckets].reverse().map((b) => (
                <tr key={b.key} data-current={b.partial || undefined}>
                  <td>
                    {label(b.key)}
                    {b.partial && (
                      <Text span size="xs" c="dimmed">
                        {" "}
                        {t("reports.cashflow.soFar")}
                      </Text>
                    )}
                  </td>
                  <td className={classes.wideOnly} style={{ color: b.in ? colors.in : undefined }}>
                    {signed(b.in, plain)}
                  </td>
                  <td
                    className={classes.wideOnly}
                    style={{ color: b.out ? colors.out : undefined }}
                  >
                    {formatMinor(b.out, plain)}
                  </td>
                  <td
                    style={{ color: b.kept < 0 ? colors.out : b.kept > 0 ? colors.in : undefined }}
                  >
                    {signed(b.kept, plain)}
                  </td>
                  <td>{signed(b.running, plain)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Stack>
  );
}
