import { Button, Group, Modal, SegmentedControl, Stack, Switch, Table, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { EChartsOption } from "echarts";
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  type ReportGroupBy,
  type ReportTransaction,
  getStatistics,
  getStatisticsDrilldown,
  listCategories,
  listCurrencies,
  listPayees,
  listTags,
  statisticsCsvUrl,
} from "../../api/client";
import { useDateFormat } from "../../dates";
import { type MoneyFormat, formatMinor } from "../../money";
import { RegisterFilters } from "../../pages/RegisterFilters";
import { type Filters, dateBounds, emptyFilters } from "../../pages/registerFilters";
import { useWallet } from "../../wallet/WalletProvider";
import { Chart, type ChartHandle } from "../Chart";
import { SavedViews } from "./SavedViews";
import { GROUPS, PALETTE, filterToParams, previousPeriod } from "./reportUtils";

export function StatisticsTab() {
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
