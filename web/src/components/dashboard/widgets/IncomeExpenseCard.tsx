import {
  ActionIcon,
  Box,
  Card,
  Group,
  Menu,
  SegmentedControl,
  Select,
  Switch,
  Text,
  Title,
} from "@mantine/core";
import { IconAdjustmentsHorizontal } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import type { EChartsOption } from "echarts";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { type CurrencyInfo, type MonthPoint, getDashboard } from "../../../api/client";
import { formatMinor } from "../../../money";
import { Chart } from "../../Chart";
import { type IEConfig, type IEStyle, IE_MONTHS } from "./shared";

// IncomeExpenseCard is the income/expense-over-time widget: a HomeBank-style
// diverging chart (income up, expense down) with a period dropdown and a gear to
// switch between bars and lines. It is self-contained: it fetches its own series
// for its configured trailing window, so multiple instances are independent.
export function IncomeExpenseCard({
  walletId,
  base,
  config,
  onConfig,
}: {
  walletId: number;
  base?: CurrencyInfo;
  config: IEConfig;
  onConfig: (c: IEConfig) => void;
}) {
  const { t } = useTranslation();
  // The income/expense series depends only on the trailing-month window, so the
  // range is left wide (it drives topCategories, unused here).
  const q = useQuery({
    queryKey: ["dashboard", walletId, "0001-01-01", "9999-12-31", "category", config.months],
    queryFn: () => getDashboard(walletId, "0001-01-01", "9999-12-31", "category", config.months),
    enabled: walletId > 0,
  });
  const points = q.data?.incomeExpense ?? [];
  return (
    <Card withBorder h="100%">
      <Group justify="space-between" mb="sm" wrap="nowrap" gap="xs">
        <Title order={4}>{t("dashboard.incomeExpense")}</Title>
        <Group gap="xs" wrap="nowrap">
          <Select
            aria-label={t("dashboard.period")}
            data={IE_MONTHS.map((m) => ({
              value: String(m),
              label: m === 0 ? t("filters.presets.all") : t("dashboard.lastMonths", { count: m }),
            }))}
            value={String(config.months)}
            onChange={(v) => v != null && onConfig({ ...config, months: Number(v) })}
            allowDeselect={false}
            w={160}
          />
          <Menu position="bottom-end" withinPortal closeOnItemClick={false}>
            <Menu.Target>
              <ActionIcon
                variant="subtle"
                color="gray"
                size="lg"
                aria-label={t("dashboard.chartOptions")}
              >
                <IconAdjustmentsHorizontal size={18} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Label>{t("dashboard.chartType")}</Menu.Label>
              <Box px="sm" pb="xs">
                <SegmentedControl
                  fullWidth
                  size="xs"
                  value={config.style}
                  onChange={(v) => onConfig({ ...config, style: v as IEStyle })}
                  data={[
                    { value: "bars", label: t("dashboard.chartBar") },
                    { value: "lines", label: t("dashboard.chartLines") },
                  ]}
                />
              </Box>
              <Box px="sm" pb="xs">
                <Switch
                  size="xs"
                  label={t("dashboard.showNet")}
                  checked={config.net}
                  onChange={(e) => onConfig({ ...config, net: e.currentTarget.checked })}
                />
                <Switch
                  size="xs"
                  mt={6}
                  label={t("dashboard.cumulative")}
                  checked={config.cumulative}
                  disabled={!config.net}
                  onChange={(e) => onConfig({ ...config, cumulative: e.currentTarget.checked })}
                />
              </Box>
            </Menu.Dropdown>
          </Menu>
        </Group>
      </Group>
      <IncomeExpenseChart
        points={points}
        base={base}
        style={config.style}
        showNet={config.net}
        cumulative={config.cumulative}
      />
    </Card>
  );
}

// IncomeExpenseChart plots income above the zero line (green) and expense below
// it (red), as bars or lines, over the month axis — mirroring the HomeBank
// desktop "income vs expense" chart.
function IncomeExpenseChart({
  points,
  base,
  style,
  showNet,
  cumulative,
}: {
  points: MonthPoint[];
  base?: CurrencyInfo;
  style: IEStyle;
  showNet: boolean;
  cumulative: boolean;
}) {
  const { t } = useTranslation();
  const incomeLabel = t("dashboard.income");
  const expenseLabel = t("dashboard.expense");
  const netLabel = cumulative ? t("dashboard.netCumulative") : t("dashboard.net");

  const option: EChartsOption = useMemo(() => {
    const seriesType = style === "lines" ? "line" : "bar";
    // Net per month = income − expense (both stored as positive magnitudes);
    // optionally accumulated into a running total across the window.
    let acc = 0;
    const net = points.map((p) => {
      const m = p.income - p.expense;
      acc += m;
      return cumulative ? acc : m;
    });
    const legend = showNet ? [incomeLabel, expenseLabel, netLabel] : [incomeLabel, expenseLabel];
    return {
      tooltip: {
        trigger: "axis",
        // Income/expense bars show their magnitude; the net line keeps its sign.
        formatter: (params) => {
          const arr = Array.isArray(params) ? params : [params];
          // axisValue is present at runtime for axis-trigger tooltips but not on
          // the base param type; read it through a narrow cast.
          const head = arr.length
            ? String((arr[0] as { axisValue?: string | number }).axisValue ?? "")
            : "";
          const lines = arr.map((p) => {
            const raw = typeof p.value === "number" ? p.value : Number(p.value) || 0;
            const v = p.seriesName === netLabel ? raw : Math.abs(raw);
            const text = base ? formatMinor(v, base) : String(v);
            return `${p.marker ?? ""}${p.seriesName}: ${text}`;
          });
          return [head, ...lines].join("<br/>");
        },
      },
      legend: { data: legend, bottom: 0 },
      grid: { left: 8, right: 16, top: 16, bottom: 48, containLabel: true },
      xAxis: {
        type: "category",
        data: points.map((p) => p.month),
        axisLabel: { rotate: points.length > 14 ? 60 : 30 },
      },
      yAxis: { type: "value" },
      series: [
        {
          name: incomeLabel,
          type: seriesType,
          color: "#37b24d",
          data: points.map((p) => p.income),
        },
        {
          name: expenseLabel,
          type: seriesType,
          color: "#f03e3e",
          data: points.map((p) => -p.expense),
        },
        ...(showNet
          ? [
              {
                name: netLabel,
                type: "line" as const,
                color: "#1c7ed6",
                smooth: true,
                symbolSize: 6,
                z: 3,
                data: net,
              },
            ]
          : []),
      ],
    };
  }, [points, base, style, showNet, cumulative, incomeLabel, expenseLabel, netLabel]);

  const empty = points.every((p) => p.income === 0 && p.expense === 0);
  if (!base || empty) {
    return <Text c="dimmed">{t("dashboard.noSpending")}</Text>;
  }
  return <Chart option={option} height={340} />;
}
