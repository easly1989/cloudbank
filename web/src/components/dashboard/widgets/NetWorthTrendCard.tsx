import { Card, Group, Text, Title } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import type { EChartsOption } from "echarts";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { getBalanceReport } from "../../../api/client";
import { formatMinor } from "../../../money";
import { Chart } from "../../Chart";
import { trailingYearBounds } from "./shared";

// NetWorthTrendCard plots total net worth (the sum of every account's balance,
// so liabilities net out) over the last ~12 months, from the balance report.
export function NetWorthTrendCard({ walletId }: { walletId: number }) {
  const { t } = useTranslation();
  const { from, to } = useMemo(trailingYearBounds, []);
  const q = useQuery({
    queryKey: ["balance", walletId, "month", [], from, to],
    queryFn: () => getBalanceReport(walletId, "month", [], from, to),
    enabled: walletId > 0,
  });
  const result = q.data;
  const buckets = result?.buckets ?? [];
  const base = result?.currency ?? undefined;
  // Net worth per bucket = sum of every account's running balance at that bucket.
  const net = useMemo(
    () =>
      buckets.map((_, i) => (result?.series ?? []).reduce((s, ser) => s + (ser.values[i] ?? 0), 0)),
    [result, buckets],
  );

  const option: EChartsOption = useMemo(
    () => ({
      tooltip: {
        trigger: "axis",
        valueFormatter: (v: unknown) =>
          base ? formatMinor(typeof v === "number" ? v : Number(v) || 0, base) : String(v),
      },
      grid: { left: 8, right: 12, top: 12, bottom: 24, containLabel: true },
      xAxis: {
        type: "category",
        data: buckets,
        axisLabel: { rotate: buckets.length > 8 ? 45 : 0 },
      },
      yAxis: { type: "value" },
      series: [{ type: "line", smooth: true, areaStyle: {}, color: "#1c7ed6", data: net }],
    }),
    [buckets, net, base],
  );

  const latest = net.length > 0 ? net[net.length - 1] : undefined;
  return (
    <Card withBorder>
      <Group justify="space-between" mb="xs" wrap="nowrap" gap="xs">
        <Title order={4}>{t("dashboard.netWorth")}</Title>
        {base && latest != null && (
          <Text size="sm" fw={700} c={latest < 0 ? "red" : undefined}>
            {formatMinor(latest, base)}
          </Text>
        )}
      </Group>
      {buckets.length === 0 ? (
        <Text c="dimmed" size="sm">
          {t("dashboard.noData")}
        </Text>
      ) : (
        <Chart option={option} height={220} />
      )}
    </Card>
  );
}
