import {
  ActionIcon,
  Box,
  Card,
  Group,
  Menu,
  SegmentedControl,
  Select,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { IconAdjustmentsHorizontal } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import type { EChartsOption } from "echarts";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { type CurrencyInfo, type DashboardGroupBy, getDashboard } from "../../../api/client";
import { formatMinor } from "../../../money";
import type { DatePreset } from "../../../pages/registerFilters";
import { Chart } from "../../Chart";
import { Donut } from "../../Donut";
import {
  type ChartType,
  DONUT_PALETTE,
  PERIODS,
  type SpendingConfig,
  resolveBounds,
} from "./shared";

// SpendingCard is self-contained: it fetches its own top-categories slice for
// its configured period/dimension, so multiple instances are independent.
export function SpendingCard({
  walletId,
  base,
  config,
  onConfig,
}: {
  walletId: number;
  base?: CurrencyInfo;
  config: SpendingConfig;
  onConfig: (c: SpendingConfig) => void;
}) {
  const { t } = useTranslation();
  const { from, to } = resolveBounds(config.period);
  const q = useQuery({
    queryKey: ["dashboard", walletId, from, to, config.groupBy, 12],
    queryFn: () => getDashboard(walletId, from, to, config.groupBy, 12),
    enabled: walletId > 0,
  });
  const slices = q.data?.topCategories ?? [];
  return (
    <Card withBorder h="100%">
      <Group justify="space-between" mb="sm" wrap="nowrap" gap="xs">
        <Title order={4}>{t("dashboard.whereMoneyGoes")}</Title>
        <Group gap="xs" wrap="nowrap">
          <Select
            aria-label={t("dashboard.period")}
            data={PERIODS.map((p) => ({ value: p, label: t(`filters.presets.${p}`) }))}
            value={config.period}
            onChange={(v) => v && onConfig({ ...config, period: v as DatePreset })}
            allowDeselect={false}
            w={150}
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
                  value={config.chartType}
                  onChange={(v) => onConfig({ ...config, chartType: v as ChartType })}
                  data={[
                    { value: "donut", label: t("dashboard.chartDonut") },
                    { value: "bar", label: t("dashboard.chartBar") },
                  ]}
                />
              </Box>
              <Menu.Label>{t("dashboard.groupBy")}</Menu.Label>
              <Box px="sm" pb="xs">
                <SegmentedControl
                  fullWidth
                  size="xs"
                  value={config.groupBy}
                  onChange={(v) => onConfig({ ...config, groupBy: v as DashboardGroupBy })}
                  data={[
                    { value: "category", label: t("dashboard.byCategory") },
                    { value: "payee", label: t("dashboard.byPayee") },
                  ]}
                />
              </Box>
            </Menu.Dropdown>
          </Menu>
        </Group>
      </Group>
      <SpendingChart slices={slices} base={base} chartType={config.chartType} />
    </Card>
  );
}

// SpendingChart renders the spending breakdown either as the SVG donut with a
// legend or as a horizontal ECharts bar; both share the same colours and the
// rolled-up "Other" slice (categoryId/payeeId 0).
function SpendingChart({
  slices,
  base,
  chartType,
}: {
  slices: { categoryId: number; name: string; amount: number }[];
  base?: CurrencyInfo;
  chartType: ChartType;
}) {
  const { t } = useTranslation();

  const data = useMemo(
    () =>
      slices.map((s, i) => ({
        label: s.categoryId === 0 ? t("dashboard.other") : s.name,
        value: s.amount,
        color: DONUT_PALETTE[i % DONUT_PALETTE.length],
      })),
    [slices, t],
  );

  const barOption: EChartsOption = useMemo(() => {
    // Reverse so the largest slice sits at the top of the (bottom-up) y-axis.
    const ordered = [...data].reverse();
    return {
      tooltip: {
        trigger: "axis",
        valueFormatter: (v) =>
          base ? formatMinor(typeof v === "number" ? v : Number(v) || 0, base) : String(v),
      },
      grid: { left: 8, right: 16, top: 8, bottom: 8, containLabel: true },
      xAxis: { type: "value" },
      yAxis: { type: "category", data: ordered.map((d) => d.label) },
      series: [
        {
          type: "bar",
          data: ordered.map((d) => ({ value: d.value, itemStyle: { color: d.color } })),
        },
      ],
    };
  }, [data, base]);

  if (slices.length === 0 || !base) {
    return <Text c="dimmed">{t("dashboard.noSpending")}</Text>;
  }

  if (chartType === "bar") {
    return <Chart option={barOption} height={Math.max(180, data.length * 34)} />;
  }

  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <Group align="center" wrap="wrap" gap="xl">
      <Donut data={data} />
      <Stack gap={4} style={{ flex: 1, minWidth: 200 }}>
        {data.map((d) => (
          <Group key={d.label} justify="space-between" wrap="nowrap" gap="sm">
            <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 2,
                  background: d.color,
                  display: "inline-block",
                  flexShrink: 0,
                }}
              />
              <Text size="sm" truncate>
                {d.label}
              </Text>
            </Group>
            <Group gap={10} wrap="nowrap">
              <Text size="sm" fw={500}>
                {formatMinor(d.value, base)}
              </Text>
              <Text size="xs" c="dimmed" w={36} ta="right">
                {total > 0 ? Math.round((d.value / total) * 100) : 0}%
              </Text>
            </Group>
          </Group>
        ))}
      </Stack>
    </Group>
  );
}
