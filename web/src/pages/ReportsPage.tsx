import { Button, Group, Modal, SegmentedControl, Stack, Table, Text, Title } from "@mantine/core";
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
} from "../api/client";
import { Chart, type ChartHandle } from "../components/Chart";
import { type MoneyFormat, formatMinor } from "../money";
import { useWallet } from "../wallet/WalletProvider";
import { RegisterFilters } from "./RegisterFilters";
import { type Filters, dateBounds, emptyFilters } from "./registerFilters";

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

export function ReportsPage() {
  const { t } = useTranslation();
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
        series: [
          {
            type: "pie",
            radius: ["40%", "70%"],
            data: groups.map((g) => ({ name: g.label, value: Math.abs(g.amount), key: g.key })),
          },
        ],
      };
    }
    return {
      tooltip: { trigger: "axis", valueFormatter },
      grid: { left: 80, right: 20, bottom: 60, top: 20 },
      xAxis: { type: "category", data: groups.map((g) => g.label), axisLabel: { rotate: 30 } },
      yAxis: { type: "value" },
      color: PALETTE,
      series: [
        {
          type: "bar",
          data: groups.map((g) => ({ value: g.amount, key: g.key })),
        },
      ],
    };
  }, [result, chartType, fmt]);

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
      <Group justify="space-between">
        <Title order={2}>{t("reports.title")}</Title>
        <Group>
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
      </Group>

      {result && result.groups.length === 0 && <Text c="dimmed">{t("reports.empty")}</Text>}

      {result && result.groups.length > 0 && view === "chart" && (
        <Chart ref={chartRef} option={option} onSelect={(key) => drilldown.mutate(key)} />
      )}

      {result && result.groups.length > 0 && view === "table" && (
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t("reports.group")}</Table.Th>
              <Table.Th ta="right">{t("reports.amount")}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {result.groups.map((g) => (
              <Table.Tr
                key={g.key}
                style={{ cursor: "pointer" }}
                onClick={() => drilldown.mutate(g.key)}
              >
                <Table.Td>{g.label}</Table.Td>
                <Table.Td ta="right" c={g.amount < 0 ? "red" : "teal"}>
                  {formatMinor(g.amount, fmt)}
                </Table.Td>
              </Table.Tr>
            ))}
            <Table.Tr fw={700}>
              <Table.Td>{t("reports.total")}</Table.Td>
              <Table.Td ta="right">{formatMinor(result.total, fmt)}</Table.Td>
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
                <Table.Td>{r.date}</Table.Td>
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
