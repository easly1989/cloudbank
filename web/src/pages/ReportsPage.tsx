import {
  Button,
  Group,
  Modal,
  MultiSelect,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Table,
  Tabs,
  Text,
  Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { EChartsOption } from "echarts";
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  type ReportBucket,
  type ReportGroupBy,
  type ReportTransaction,
  type SavedReportView,
  type TrendBreakdown,
  type User,
  type VehicleReport,
  getBalanceReport,
  getStatistics,
  getStatisticsDrilldown,
  getTrend,
  getVehicleReport,
  listAccounts,
  listCategories,
  listCurrencies,
  listPayees,
  listTags,
  listVehicles,
  statisticsCsvUrl,
  updateMe,
} from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { Chart, type ChartHandle } from "../components/Chart";
import { useDateFormat } from "../dates";
import { type MoneyFormat, formatMinor } from "../money";
import { useWallet } from "../wallet/WalletProvider";
import { RegisterFilters } from "./RegisterFilters";
import { type Filters, dateBounds, emptyFilters } from "./registerFilters";

const BUCKETS: ReportBucket[] = ["day", "week", "month", "quarter", "year"];
const BREAKDOWNS: TrendBreakdown[] = ["none", "account", "payee", "category"];
const SERIES_PALETTE = [
  "#4dabf7",
  "#ff8787",
  "#69db7c",
  "#ffd43b",
  "#da77f2",
  "#3bc9db",
  "#ffa94d",
  "#a9e34b",
];

function baseFmt(
  currency:
    | {
        fracDigits: number;
        decimalChar: string;
        groupChar: string;
        symbol: string;
        symbolPrefix: boolean;
      }
    | null
    | undefined,
): MoneyFormat {
  return currency
    ? {
        fracDigits: currency.fracDigits,
        decimalChar: currency.decimalChar,
        groupChar: currency.groupChar,
        symbol: currency.symbol,
        symbolPrefix: currency.symbolPrefix,
      }
    : { fracDigits: 2, decimalChar: ".", groupChar: ",", symbol: "", symbolPrefix: false };
}

// previousPeriod returns the equal-length window ending the day before `from`,
// used for period-over-period comparison.
function previousPeriod(from: string, to: string): { from: string; to: string } {
  const day = 86400000;
  const f = Date.parse(from + "T00:00:00Z");
  const t = Date.parse(to + "T00:00:00Z");
  const len = Math.round((t - f) / day) + 1; // inclusive day count
  const prevTo = f - day;
  const prevFrom = prevTo - (len - 1) * day;
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return { from: iso(prevFrom), to: iso(prevTo) };
}

const genViewId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

// SavedViews lets the user name and re-open a report configuration. Views live
// in the per-user preferences blob, scoped by report tab + active wallet, so
// each report only sees its own. `current` is the tab's config to save;
// `onApply` restores a saved config into the tab's state.
function SavedViews({
  tab,
  walletId,
  current,
  onApply,
}: {
  tab: string;
  walletId: number;
  current: Record<string, unknown>;
  onApply: (config: Record<string, unknown>) => void;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const all = useMemo(() => user?.preferences?.reportViews ?? [], [user]);
  const views = all.filter((v) => v.tab === tab && v.walletId === walletId);

  const persist = useMutation({
    mutationFn: (next: SavedReportView[]) =>
      updateMe({ preferences: { ...(user?.preferences ?? {}), reportViews: next } }),
    onSuccess: (u: User) => qc.setQueryData(["me"], u),
  });

  const save = () => {
    const name = window.prompt(t("reports.saveViewPrompt"))?.trim();
    if (!name) return;
    const id = genViewId();
    // Overwrite a same-named view in this tab/wallet, otherwise append.
    const rest = all.filter((v) => !(v.tab === tab && v.walletId === walletId && v.name === name));
    persist.mutate([...rest, { id, walletId, tab, name, config: current }]);
    setSelected(id);
  };

  const apply = (id: string | null) => {
    setSelected(id);
    const v = views.find((x) => x.id === id);
    if (v) onApply(v.config);
  };

  const del = () => {
    if (!selected) return;
    persist.mutate(all.filter((v) => v.id !== selected));
    setSelected(null);
  };

  return (
    <Group gap="xs" align="flex-end">
      <Select
        label={t("reports.savedViews")}
        placeholder={t("reports.savedViewsPlaceholder")}
        data={views.map((v) => ({ value: v.id, label: v.name }))}
        value={selected}
        onChange={apply}
        clearable
        w={200}
      />
      <Button variant="default" onClick={save}>
        {t("reports.saveView")}
      </Button>
      {selected && (
        <Button variant="subtle" color="red" onClick={del}>
          {t("reports.deleteView")}
        </Button>
      )}
    </Group>
  );
}

export function ReportsPage() {
  const { t } = useTranslation();
  return (
    <Stack>
      <Title order={2}>{t("reports.title")}</Title>
      <Tabs defaultValue="statistics">
        <Tabs.List>
          <Tabs.Tab value="statistics">{t("reports.statistics")}</Tabs.Tab>
          <Tabs.Tab value="trend">{t("reports.trend")}</Tabs.Tab>
          <Tabs.Tab value="balance">{t("reports.balance")}</Tabs.Tab>
          <Tabs.Tab value="vehicle">{t("reports.vehicle")}</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="statistics" pt="md">
          <StatisticsTab />
        </Tabs.Panel>
        <Tabs.Panel value="trend" pt="md">
          <TrendTab />
        </Tabs.Panel>
        <Tabs.Panel value="vehicle" pt="md">
          <VehicleTab />
        </Tabs.Panel>
        <Tabs.Panel value="balance" pt="md">
          <BalanceTab />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}

const GROUPS: ReportGroupBy[] = ["category", "subcategory", "payee", "tag", "month", "year"];
const PALETTE = [
  "#4dabf7",
  "#ff8787",
  "#69db7c",
  "#ffd43b",
  "#da77f2",
  "#3bc9db",
  "#ffa94d",
  "#a9e34b",
  "#9775fa",
  "#f783ac",
];

function filterToParams(f: Filters): Record<string, string> {
  const out: Record<string, string> = {};
  const { from, to } = dateBounds(f);
  if (from) out.from = from;
  if (to) out.to = to;
  if (f.status !== null) out.status = String(f.status);
  if (f.payeeId !== null) out.payeeId = String(f.payeeId);
  if (f.categoryId !== null) out.categoryId = String(f.categoryId);
  if (f.tags.length > 0) out.tags = f.tags.join(",");
  if (f.amountMin !== null) out.amountMin = String(f.amountMin);
  if (f.amountMax !== null) out.amountMax = String(f.amountMax);
  if (f.text.trim()) out.text = f.text.trim();
  return out;
}

function StatisticsTab() {
  const { t } = useTranslation();
  const fmtDate = useDateFormat();
  const { currentWallet } = useWallet();
  const walletId = currentWallet?.id ?? 0;

  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [groupBy, setGroupBy] = useState<ReportGroupBy>("category");
  const [view, setView] = useState<"chart" | "table">("chart");
  const [chartType, setChartType] = useState<"pie" | "bar">("pie");
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
  const currenciesQuery = useQuery({
    queryKey: ["currencies", walletId],
    queryFn: () => listCurrencies(walletId),
  });
  const baseCur = (currenciesQuery.data ?? []).find((c) => c.isBase);

  const params = useMemo(() => filterToParams(filters), [filters]);
  const query = useQuery({
    queryKey: ["statistics", walletId, groupBy, params],
    queryFn: () => getStatistics(walletId, groupBy, params),
    enabled: walletId > 0,
  });
  const result = query.data;

  // Period-over-period comparison: a second query over the equal-length window
  // ending the day before the current range. Needs a bounded period.
  const [compare, setCompare] = useState(false);
  const bounds = dateBounds(filters);
  const prevParams = useMemo(() => {
    if (!compare || !bounds.from || !bounds.to) return null;
    const pp = previousPeriod(bounds.from, bounds.to);
    return { ...params, from: pp.from, to: pp.to };
  }, [compare, params, bounds.from, bounds.to]);
  const prevQuery = useQuery({
    queryKey: ["statistics", walletId, groupBy, prevParams],
    queryFn: () => getStatistics(walletId, groupBy, prevParams!),
    enabled: walletId > 0 && !!prevParams,
  });
  const prevResult = prevQuery.data;
  const prevByKey = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of prevResult?.groups ?? []) m.set(g.key, g.amount);
    return m;
  }, [prevResult]);
  const showCompare = !!prevParams && !!prevResult;

  const fmt: MoneyFormat = useMemo(() => {
    const src = result?.currency ?? baseCur;
    return src
      ? {
          fracDigits: src.fracDigits,
          decimalChar: src.decimalChar,
          groupChar: src.groupChar,
          symbol: src.symbol,
          symbolPrefix: src.symbolPrefix,
        }
      : { fracDigits: 2, decimalChar: ".", groupChar: ",", symbol: "", symbolPrefix: false };
  }, [result?.currency, baseCur]);

  const option: EChartsOption = useMemo(() => {
    const groups = result?.groups ?? [];
    const valueFormatter = (v: unknown) => {
      const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : 0;
      return formatMinor(Number.isFinite(n) ? n : 0, fmt);
    };
    if (chartType === "pie") {
      return {
        tooltip: { trigger: "item", valueFormatter },
        color: PALETTE,
        legend: {
          type: "scroll",
          orient: "vertical",
          right: 8,
          top: "middle",
          data: groups.map((g) => g.label),
        },
        series: [
          {
            type: "pie",
            radius: ["45%", "78%"],
            center: ["34%", "50%"],
            label: { show: false },
            labelLine: { show: false },
            data: groups.map((g) => ({ name: g.label, value: Math.abs(g.amount), key: g.key })),
          },
        ],
      };
    }
    return {
      tooltip: { trigger: "axis", valueFormatter },
      grid: { left: 80, right: 20, bottom: 60, top: 20 },
      legend: showCompare ? { bottom: 0 } : undefined,
      xAxis: { type: "category", data: groups.map((g) => g.label), axisLabel: { rotate: 30 } },
      yAxis: { type: "value" },
      color: PALETTE,
      series: [
        {
          name: t("reports.amount"),
          type: "bar",
          data: groups.map((g) => ({ value: g.amount, key: g.key })),
        },
        ...(showCompare
          ? [
              {
                name: t("reports.previous"),
                type: "bar" as const,
                itemStyle: { color: "#adb5bd" },
                data: groups.map((g) => prevByKey.get(g.key) ?? 0),
              },
            ]
          : []),
      ],
    };
  }, [result, chartType, fmt, showCompare, prevByKey, t]);

  // Drill-down.
  const [ddOpened, dd] = useDisclosure(false);
  const [ddRows, setDdRows] = useState<ReportTransaction[]>([]);
  const [ddLabel, setDdLabel] = useState("");
  const drilldown = useMutation({
    mutationFn: (key: string) => getStatisticsDrilldown(walletId, groupBy, key, params),
    onSuccess: (rows, key) => {
      setDdRows(rows);
      setDdLabel(result?.groups.find((g) => g.key === key)?.label ?? key);
      dd.open();
    },
  });

  const exportPng = () => {
    const url = chartRef.current?.getPng();
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = `statistics-${groupBy}.png`;
    a.click();
  };

  if (!currentWallet) return null;

  return (
    <Stack>
      <Group justify="space-between" align="flex-end">
        <SavedViews
          tab="statistics"
          walletId={walletId}
          current={{ groupBy, view, chartType, filters }}
          onApply={(c) => {
            if (c.groupBy) setGroupBy(c.groupBy as ReportGroupBy);
            if (c.view) setView(c.view as "chart" | "table");
            if (c.chartType) setChartType(c.chartType as "pie" | "bar");
            if (c.filters) setFilters(c.filters as Filters);
          }}
        />
        <Group gap="xs">
          <Button
            component="a"
            href={statisticsCsvUrl(walletId, groupBy, params)}
            variant="default"
          >
            {t("reports.exportCsv")}
          </Button>
          {view === "chart" && (
            <Button variant="default" onClick={exportPng}>
              {t("reports.exportPng")}
            </Button>
          )}
        </Group>
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
          value={groupBy}
          onChange={(v) => setGroupBy(v as ReportGroupBy)}
          data={GROUPS.map((g) => ({ value: g, label: t(`reports.groups.${g}`) }))}
        />
        <SegmentedControl
          value={view}
          onChange={(v) => setView(v as "chart" | "table")}
          data={[
            { value: "chart", label: t("reports.chart") },
            { value: "table", label: t("reports.table") },
          ]}
        />
        {view === "chart" && (
          <SegmentedControl
            value={chartType}
            onChange={(v) => setChartType(v as "pie" | "bar")}
            data={[
              { value: "pie", label: t("reports.pie") },
              { value: "bar", label: t("reports.column") },
            ]}
          />
        )}
        <Switch
          label={t("reports.compare")}
          checked={compare}
          onChange={(e) => setCompare(e.currentTarget.checked)}
        />
      </Group>

      {result && result.groups.length === 0 && <Text c="dimmed">{t("reports.empty")}</Text>}

      {result && result.groups.length > 0 && view === "chart" && (
        <Chart
          ref={chartRef}
          option={option}
          height={chartType === "pie" ? 440 : 360}
          onSelect={(key) => drilldown.mutate(key)}
        />
      )}

      {result && result.groups.length > 0 && view === "table" && (
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t("reports.group")}</Table.Th>
              <Table.Th ta="right">{t("reports.amount")}</Table.Th>
              {showCompare && <Table.Th ta="right">{t("reports.previous")}</Table.Th>}
              {showCompare && <Table.Th ta="right">{t("reports.change")}</Table.Th>}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {result.groups.map((g) => {
              const prev = prevByKey.get(g.key) ?? 0;
              const delta = g.amount - prev;
              return (
                <Table.Tr
                  key={g.key}
                  style={{ cursor: "pointer" }}
                  onClick={() => drilldown.mutate(g.key)}
                >
                  <Table.Td>{g.label}</Table.Td>
                  <Table.Td ta="right" c={g.amount < 0 ? "red" : "teal"}>
                    {formatMinor(g.amount, fmt)}
                  </Table.Td>
                  {showCompare && (
                    <Table.Td ta="right" c="dimmed">
                      {formatMinor(prev, fmt)}
                    </Table.Td>
                  )}
                  {showCompare && (
                    <Table.Td ta="right" c={delta < 0 ? "red" : "teal"}>
                      {formatMinor(delta, fmt)}
                    </Table.Td>
                  )}
                </Table.Tr>
              );
            })}
            <Table.Tr fw={700}>
              <Table.Td>{t("reports.total")}</Table.Td>
              <Table.Td ta="right">{formatMinor(result.total, fmt)}</Table.Td>
              {showCompare && prevResult && (
                <Table.Td ta="right" c="dimmed">
                  {formatMinor(prevResult.total, fmt)}
                </Table.Td>
              )}
              {showCompare && prevResult && (
                <Table.Td ta="right">{formatMinor(result.total - prevResult.total, fmt)}</Table.Td>
              )}
            </Table.Tr>
          </Table.Tbody>
        </Table>
      )}

      <Modal opened={ddOpened} onClose={dd.close} size="lg" title={ddLabel}>
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t("transactions.date")}</Table.Th>
              <Table.Th>{t("transactions.payee")}</Table.Th>
              <Table.Th>{t("transactions.memo")}</Table.Th>
              <Table.Th ta="right">{t("transactions.amount")}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {ddRows.map((r) => (
              <Table.Tr key={r.id}>
                <Table.Td>{fmtDate(r.date)}</Table.Td>
                <Table.Td>{r.payeeName}</Table.Td>
                <Table.Td>{r.memo}</Table.Td>
                <Table.Td ta="right" c={r.amount < 0 ? "red" : "teal"}>
                  {formatMinor(r.amount, fmt)}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Modal>
    </Stack>
  );
}

function cumulate(values: number[]): number[] {
  let acc = 0;
  return values.map((v) => (acc += v));
}

function TrendTab() {
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

// todayBucketKey renders today's date as the bucket key for the given interval,
// matching the server's bucket formats (see report/buckets.go) so the "today"
// marker lands on the right category.
function todayBucketKey(bucket: ReportBucket, now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const y = now.getFullYear();
  const m = now.getMonth(); // 0-based
  switch (bucket) {
    case "year":
      return String(y);
    case "quarter":
      return `${y}-Q${Math.floor(m / 3) + 1}`;
    case "month":
      return `${y}-${pad(m + 1)}`;
    case "week": {
      // Monday of this week (ISO-style), matching the server.
      const d = new Date(y, m, now.getDate());
      d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      return iso(d);
    }
    default:
      return iso(now); // day
  }
}

function BalanceTab() {
  const { t } = useTranslation();
  const { currentWallet } = useWallet();
  const walletId = currentWallet?.id ?? 0;

  const accountsQuery = useQuery({
    queryKey: ["accounts", walletId],
    queryFn: () => listAccounts(walletId),
    enabled: walletId > 0,
  });
  const accounts = accountsQuery.data ?? [];

  const [accountIds, setAccountIds] = useState<string[]>([]);
  const [bucket, setBucket] = useState<ReportBucket>("month");
  const year = new Date().getFullYear();
  const [from, setFrom] = useState(`${year}-01-01`);
  const [to, setTo] = useState(`${year}-12-31`);
  const chartRef = useRef<ChartHandle>(null);

  const query = useQuery({
    queryKey: ["balance", walletId, bucket, accountIds, from, to],
    queryFn: () => getBalanceReport(walletId, bucket, accountIds.map(Number), from, to),
    enabled: walletId > 0,
  });
  const result = query.data;
  const fmt = useMemo(() => baseFmt(result?.currency), [result?.currency]);

  const option: EChartsOption = useMemo(() => {
    const buckets = result?.buckets ?? [];
    const todayKey = todayBucketKey(bucket);
    const showToday = buckets.includes(todayKey);
    const series = (result?.series ?? []).map((s, i) => {
      // Per-line markLine entries: each account's overdraft level (red), plus a
      // single "today" vertical line attached to the first series (grey).
      const lines: Record<string, unknown>[] = [];
      if (s.minimumBalance !== 0)
        lines.push({
          yAxis: s.minimumBalance,
          name: t("reports.overdraft"),
          lineStyle: { type: "dashed", color: "#fa5252" },
        });
      if (i === 0 && showToday)
        lines.push({
          xAxis: todayKey,
          name: t("reports.today"),
          lineStyle: { type: "solid", color: "#868e96" },
          label: { formatter: t("reports.today"), color: "#868e96", position: "insideEndTop" },
        });
      return {
        name: s.label,
        type: "line" as const,
        smooth: true,
        data: s.values,
        itemStyle: { color: SERIES_PALETTE[i % SERIES_PALETTE.length] },
        markLine: lines.length ? { symbol: "none", data: lines } : undefined,
      };
    });
    return {
      tooltip: {
        trigger: "axis",
        valueFormatter: (v: unknown) =>
          formatMinor(typeof v === "number" ? v : typeof v === "string" ? Number(v) : 0, fmt),
      },
      legend: { type: "scroll" },
      grid: { left: 90, right: 20, bottom: 60, top: 40 },
      xAxis: { type: "category", data: buckets, axisLabel: { rotate: 30 } },
      yAxis: { type: "value" },
      series,
    };
  }, [result, fmt, t, bucket]);

  const exportPng = () => {
    const url = chartRef.current?.getPng();
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = `balance-${bucket}.png`;
    a.click();
  };

  if (!currentWallet) return null;

  return (
    <Stack>
      <Group justify="flex-end">
        <Button variant="default" onClick={exportPng}>
          {t("reports.exportPng")}
        </Button>
      </Group>
      <Group align="flex-end">
        <MultiSelect
          label={t("reports.accounts")}
          placeholder={t("reports.allAccounts")}
          data={accounts.map((a) => ({ value: String(a.id), label: a.name }))}
          value={accountIds}
          onChange={setAccountIds}
          searchable
          clearable
          w={300}
        />
        <SegmentedControl
          value={bucket}
          onChange={(v) => setBucket(v as ReportBucket)}
          data={BUCKETS.map((b) => ({ value: b, label: t(`reports.buckets.${b}`) }))}
        />
      </Group>
      <Group>
        <input type="date" value={from} onChange={(e) => setFrom(e.currentTarget.value)} />
        <input type="date" value={to} onChange={(e) => setTo(e.currentTarget.value)} />
      </Group>
      {result && result.buckets.length === 0 && <Text c="dimmed">{t("reports.empty")}</Text>}
      {result && result.buckets.length > 0 && <Chart ref={chartRef} option={option} />}
    </Stack>
  );
}

function VehicleTab() {
  const { t } = useTranslation();
  const fmtDate = useDateFormat();
  const { currentWallet } = useWallet();
  const walletId = currentWallet?.id ?? 0;

  const vehiclesQuery = useQuery({
    queryKey: ["vehicles", walletId],
    queryFn: () => listVehicles(walletId),
    enabled: walletId > 0,
  });
  const currenciesQuery = useQuery({
    queryKey: ["currencies", walletId],
    queryFn: () => listCurrencies(walletId),
    enabled: walletId > 0,
  });
  const base = (currenciesQuery.data ?? []).find((c) => c.isBase);

  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["vehicle", walletId, vehicleId],
    queryFn: () => getVehicleReport(walletId, Number(vehicleId)),
    enabled: walletId > 0 && !!vehicleId,
  });
  const report: VehicleReport | undefined = query.data;
  const fmt = useMemo(() => baseFmt(report?.currency ?? base), [report?.currency, base]);

  const num = (v: number, digits = 1) =>
    v.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });

  return (
    <Stack>
      <Group align="flex-end">
        <Select
          label={t("reports.vehicle")}
          placeholder={t("reports.pickVehicle")}
          data={(vehiclesQuery.data ?? []).map((v) => ({ value: String(v.id), label: v.name }))}
          value={vehicleId}
          onChange={setVehicleId}
          searchable
          clearable
          w={280}
        />
      </Group>

      {report && (
        <Group gap="xl">
          <Stat
            label={t("reports.distance")}
            value={`${num(report.totalDistance, 0)} ${t("reports.unitDistance")}`}
          />
          <Stat
            label={t("reports.volume")}
            value={`${num(report.totalVolume)} ${t("reports.unitVolume")}`}
          />
          <Stat
            label={t("reports.consumption")}
            value={`${num(report.avgConsumption)} ${t("reports.unitConsumption")}`}
          />
          <Stat label={t("reports.totalCost")} value={formatMinor(report.totalCost, fmt)} />
          <Stat
            label={t("reports.costPerDistance")}
            value={
              report.totalDistance > 0
                ? `${formatMinor(Math.round(report.totalCost / report.totalDistance), fmt)} / ${t("reports.unitDistance")}`
                : "—"
            }
          />
        </Group>
      )}

      {report && report.entries.length === 0 && vehicleId && (
        <Text c="dimmed">{t("reports.empty")}</Text>
      )}

      {report && report.entries.length > 0 && (
        <Table striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t("transactions.date")}</Table.Th>
              <Table.Th ta="right">{t("reports.meter")}</Table.Th>
              <Table.Th ta="right">{t("reports.distance")}</Table.Th>
              <Table.Th ta="right">{t("reports.volume")}</Table.Th>
              <Table.Th ta="right">{t("reports.consumption")}</Table.Th>
              <Table.Th ta="right">{t("reports.amount")}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {report.entries.map((e) => (
              <Table.Tr key={e.transactionId}>
                <Table.Td>{fmtDate(e.date)}</Table.Td>
                <Table.Td ta="right">{num(e.meter, 0)}</Table.Td>
                <Table.Td ta="right">{e.distance > 0 ? num(e.distance, 0) : "—"}</Table.Td>
                <Table.Td ta="right">
                  {e.partial ? (
                    <Text span c="dimmed">
                      {t("reports.partial")}
                    </Text>
                  ) : (
                    num(e.volume)
                  )}
                </Table.Td>
                <Table.Td ta="right">{e.consumption > 0 ? num(e.consumption) : "—"}</Table.Td>
                <Table.Td ta="right">{formatMinor(e.cost, fmt)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Stack>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <Text size="xs" c="dimmed" tt="uppercase">
        {label}
      </Text>
      <Text fw={600}>{value}</Text>
    </div>
  );
}
