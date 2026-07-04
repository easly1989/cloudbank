import { Card, Group, Select, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import type { EChartsOption } from "echarts";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { getBalanceReport, listAccounts } from "../../../api/client";
import { formatMinor } from "../../../money";
import { Chart } from "../../Chart";
import { trailingYearBounds } from "./shared";

// BalanceSparklineCard shows a compact balance-over-time line for one chosen
// account (last ~12 months), with the latest balance called out.
export function BalanceSparklineCard({
  walletId,
  config,
  onConfig,
}: {
  walletId: number;
  config: { accountId?: number };
  onConfig: (c: { accountId?: number }) => void;
}) {
  const { t } = useTranslation();
  const { from, to } = useMemo(trailingYearBounds, []);
  const accountsQ = useQuery({
    queryKey: ["accounts", walletId],
    queryFn: () => listAccounts(walletId),
    enabled: walletId > 0,
  });
  const accounts = accountsQ.data ?? [];
  const account = accounts.find((a) => a.id === config.accountId) ?? accounts[0];

  const q = useQuery({
    queryKey: ["balance", walletId, "month", account?.id, from, to],
    queryFn: () => getBalanceReport(walletId, "month", [account!.id], from, to),
    enabled: walletId > 0 && !!account,
  });
  const buckets = q.data?.buckets ?? [];
  const values = q.data?.series?.[0]?.values ?? [];
  const base = q.data?.currency ?? undefined;

  const option: EChartsOption = useMemo(
    () => ({
      tooltip: {
        trigger: "axis",
        valueFormatter: (v: unknown) =>
          base ? formatMinor(typeof v === "number" ? v : Number(v) || 0, base) : String(v),
      },
      grid: { left: 0, right: 0, top: 6, bottom: 6 },
      xAxis: { type: "category", show: false, data: buckets },
      yAxis: { type: "value", show: false, scale: true },
      series: [
        {
          type: "line",
          smooth: true,
          symbol: "none",
          areaStyle: {},
          color: "#12b886",
          data: values,
        },
      ],
    }),
    [buckets, values, base],
  );

  const latest = values.length > 0 ? values[values.length - 1] : undefined;
  return (
    <Card withBorder h="100%">
      <Group justify="space-between" mb="xs" wrap="nowrap" gap="xs">
        <Text size="xs" c="dimmed" tt="uppercase" truncate>
          {t("dashboard.balanceSparkline")}
        </Text>
        {accounts.length > 0 && (
          <Select
            aria-label={t("dashboard.selectAccount")}
            data={accounts.map((a) => ({ value: String(a.id), label: a.name }))}
            value={account ? String(account.id) : null}
            onChange={(v) => v && onConfig({ accountId: Number(v) })}
            allowDeselect={false}
            size="xs"
            w={150}
          />
        )}
      </Group>
      {account && values.length > 0 ? (
        <>
          <Text fw={700} size="lg" c={latest != null && latest < 0 ? "red" : undefined}>
            {base && latest != null ? formatMinor(latest, base) : "—"}
          </Text>
          <Chart option={option} height={90} />
        </>
      ) : (
        <Text c="dimmed" size="sm">
          {t("dashboard.noData")}
        </Text>
      )}
    </Card>
  );
}
