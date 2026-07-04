import { Button, Group, SegmentedControl, Stack, Switch, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import type { EChartsOption } from "echarts";
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  type ReportBucket,
  type TrendBreakdown,
  getTrend,
  listCategories,
  listPayees,
  listTags,
} from "../../api/client";
import { formatMinor } from "../../money";
import { RegisterFilters } from "../../pages/RegisterFilters";
import { type Filters, dateBounds, emptyFilters } from "../../pages/registerFilters";
import { useWallet } from "../../wallet/WalletProvider";
import { Chart, type ChartHandle } from "../Chart";
import { SavedViews } from "./SavedViews";
import {
  BREAKDOWNS,
  BUCKETS,
  SERIES_PALETTE,
  baseFmt,
  cumulate,
  previousPeriod,
} from "./reportUtils";

export function TrendTab() {
  const { t } = useTranslation();
  const { currentWallet } = useWallet();
  const walletId = currentWallet?.id ?? 0;

  const [filters, setFilters] = useState<Filters>({ ...emptyFilters, preset: "thisYear" });
  const [bucket, setBucket] = useState<ReportBucket>("month");
  const [breakdown, setBreakdown] = useState<TrendBreakdown>("none");
  const [chartType, setChartType] = useState<"line" | "bar">("line");
  const [cumulative, setCumulative] = useState(false);
  const chartRef = useRef<ChartHandle>(null);

  const payeesQuery = useQuery({
    queryKey: ["payees", walletId],
    queryFn: () => listPayees(walletId),
  });
  const categoriesQuery = useQuery({
    queryKey: ["categories", walletId],
    queryFn: () => listCategories(walletId),
  });
  const tagsQuery = useQuery({ queryKey: ["tags", walletId], queryFn: () => listTags(walletId) });

  const params = useMemo(() => {
    const out: Record<string, string> = {};
    const { from, to } = dateBounds(filters);
    if (from) out.from = from;
    if (to) out.to = to;
    if (filters.status !== null) out.status = String(filters.status);
    if (filters.payeeId !== null) out.payeeId = String(filters.payeeId);
    if (filters.categoryId !== null) out.categoryId = String(filters.categoryId);
    if (filters.tags.length > 0) out.tags = filters.tags.join(",");
    if (filters.amountMin !== null) out.amountMin = String(filters.amountMin);
    if (filters.amountMax !== null) out.amountMax = String(filters.amountMax);
    if (filters.text.trim()) out.text = filters.text.trim();
    return out;
  }, [filters]);

  const query = useQuery({
    queryKey: ["trend", walletId, bucket, breakdown, params],
    queryFn: () => getTrend(walletId, bucket, breakdown, params),
    enabled: walletId > 0,
  });
  const result = query.data;
  const fmt = useMemo(() => baseFmt(result?.currency), [result?.currency]);

  // Overlay the previous equal-length period as a dashed line. Only meaningful
  // for the single total series (breakdown "none") over a bounded range.
  const [compare, setCompare] = useState(false);
  const bounds = dateBounds(filters);
  const prevParams = useMemo(() => {
    if (!compare || breakdown !== "none" || !bounds.from || !bounds.to) return null;
    const pp = previousPeriod(bounds.from, bounds.to);
    return { ...params, from: pp.from, to: pp.to };
  }, [compare, breakdown, params, bounds.from, bounds.to]);
  const prevQuery = useQuery({
    queryKey: ["trend", walletId, bucket, "none", prevParams],
    queryFn: () => getTrend(walletId, bucket, "none", prevParams!),
    enabled: walletId > 0 && !!prevParams,
  });
  const prevResult = prevQuery.data;
  const showCompare = !!prevParams && !!prevResult;

  const option: EChartsOption = useMemo(() => {
    const buckets = result?.buckets ?? [];
    const series: EChartsOption["series"] = (result?.series ?? []).map((s, i) => ({
      name: s.label,
      type: chartType,
      smooth: chartType === "line",
      data: cumulative ? cumulate(s.values) : s.values,
      itemStyle: { color: SERIES_PALETTE[i % SERIES_PALETTE.length] },
    }));
    if (showCompare && prevResult) {
      // Align the previous series to the current axis by index (period-over-period).
      const prevVals = prevResult.series[0]?.values ?? [];
      const aligned = Array.from({ length: buckets.length }, (_, i) => prevVals[i] ?? 0);
      series.push({
        name: t("reports.previous"),
        type: chartType,
        smooth: chartType === "line",
        data: cumulative ? cumulate(aligned) : aligned,
        lineStyle: { type: "dashed" },
        itemStyle: { color: "#adb5bd" },
      });
    }
    return {
      tooltip: {
        trigger: "axis",
        valueFormatter: (v: unknown) =>
          formatMinor(typeof v === "number" ? v : typeof v === "string" ? Number(v) : 0, fmt),
      },
      legend: { type: "scroll", show: breakdown !== "none" || showCompare },
      grid: { left: 80, right: 20, bottom: 60, top: 40 },
      xAxis: { type: "category", data: buckets, axisLabel: { rotate: 30 } },
      yAxis: { type: "value" },
      series,
    };
  }, [result, chartType, cumulative, breakdown, fmt, showCompare, prevResult, t]);

  const exportPng = () => {
    const url = chartRef.current?.getPng();
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = `trend-${bucket}.png`;
    a.click();
  };

  if (!currentWallet) return null;

  return (
    <Stack>
      <Group justify="space-between" align="flex-end">
        <SavedViews
          tab="trend"
          walletId={walletId}
          current={{ bucket, breakdown, chartType, cumulative, filters }}
          onApply={(c) => {
            if (c.bucket) setBucket(c.bucket as ReportBucket);
            if (c.breakdown) setBreakdown(c.breakdown as TrendBreakdown);
            if (c.chartType) setChartType(c.chartType as "line" | "bar");
            if (typeof c.cumulative === "boolean") setCumulative(c.cumulative);
            if (c.filters) setFilters(c.filters as Filters);
          }}
        />
        <Button variant="default" onClick={exportPng}>
          {t("reports.exportPng")}
        </Button>
      </Group>
      <RegisterFilters
        filters={filters}
        onChange={setFilters}
        payees={payeesQuery.data ?? []}
        categories={categoriesQuery.data ?? []}
        tags={tagsQuery.data ?? []}
        fmt={fmt}
      />
      <Group>
        <SegmentedControl
          value={bucket}
          onChange={(v) => setBucket(v as ReportBucket)}
          data={BUCKETS.map((b) => ({ value: b, label: t(`reports.buckets.${b}`) }))}
        />
        <SegmentedControl
          value={breakdown}
          onChange={(v) => setBreakdown(v as TrendBreakdown)}
          data={BREAKDOWNS.map((b) => ({ value: b, label: t(`reports.breakdowns.${b}`) }))}
        />
        <SegmentedControl
          value={chartType}
          onChange={(v) => setChartType(v as "line" | "bar")}
          data={[
            { value: "line", label: t("reports.line") },
            { value: "bar", label: t("reports.column") },
          ]}
        />
        <Switch
          label={t("reports.cumulative")}
          checked={cumulative}
          onChange={(e) => setCumulative(e.currentTarget.checked)}
        />
        <Switch
          label={t("reports.compare")}
          checked={compare}
          onChange={(e) => setCompare(e.currentTarget.checked)}
          disabled={breakdown !== "none"}
        />
      </Group>
      {result && result.buckets.length === 0 && <Text c="dimmed">{t("reports.empty")}</Text>}
      {result && result.buckets.length > 0 && <Chart ref={chartRef} option={option} />}
    </Stack>
  );
}
