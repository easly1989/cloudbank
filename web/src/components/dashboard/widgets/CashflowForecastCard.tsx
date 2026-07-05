import { Card, Group, SegmentedControl, Select, Text, Title } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import type { EChartsOption } from "echarts";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { getCashflowForecast, listAccounts } from "../../../api/client";
import { formatMinor } from "../../../money";
import { Chart } from "../../Chart";

const HORIZONS = [30, 60, 90] as const;

// CashflowForecastCard projects a chosen account's balance forward, applying
// future-dated transactions and simulated schedule occurrences. A dashed line
// marks the account minimum; the ending balance turns red if it dips below it.
export function CashflowForecastCard({
  walletId,
  config,
  onConfig,
}: {
  walletId: number;
  config: { accountId?: number; days?: number };
  onConfig: (c: { accountId?: number; days?: number }) => void;
}) {
  const { t } = useTranslation();
  const days = config.days ?? 90;
  const accountsQ = useQuery({
    queryKey: ["accounts", walletId],
    queryFn: () => listAccounts(walletId),
    enabled: walletId > 0,
  });
  const accounts = accountsQ.data ?? [];
  const account = accounts.find((a) => a.id === config.accountId) ?? accounts[0];

  const q = useQuery({
    queryKey: ["cashflow", walletId, account?.id, days],
    queryFn: () => getCashflowForecast(walletId, account!.id, days),
    enabled: walletId > 0 && !!account,
  });
  const dates = q.data?.dates ?? [];
  const balances = q.data?.balances ?? [];
  const base = q.data?.currency ?? undefined;
  const minimum = q.data?.minimum ?? 0;
  const low = balances.length ? Math.min(...balances) : 0;
  const ending = balances.length ? balances[balances.length - 1] : undefined;
  const breaches = balances.length > 0 && low < minimum;

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
        data: dates,
        axisLabel: { formatter: (v: string) => v.slice(5) }, // MM-DD
      },
      yAxis: { type: "value", scale: true },
      series: [
        {
          type: "line",
          smooth: true,
          symbol: "none",
          areaStyle: {},
          color: breaches ? "#f03e3e" : "#1c7ed6",
          data: balances,
          markLine:
            minimum !== 0
              ? {
                  symbol: "none",
                  data: [{ yAxis: minimum, lineStyle: { type: "dashed", color: "#fa5252" } }],
                }
              : undefined,
        },
      ],
    }),
    [dates, balances, base, minimum, breaches],
  );

  return (
    <Card withBorder>
      <Group justify="space-between" mb="xs" wrap="nowrap" gap="xs">
        <Title order={4}>{t("dashboard.cashflow")}</Title>
        <Group gap="xs" wrap="nowrap">
          <SegmentedControl
            size="xs"
            value={String(days)}
            onChange={(v) => onConfig({ ...config, days: Number(v) })}
            data={HORIZONS.map((h) => ({ value: String(h), label: `${h}d` }))}
          />
          {accounts.length > 0 && (
            <Select
              aria-label={t("dashboard.selectAccount")}
              data={accounts.map((a) => ({ value: String(a.id), label: a.name }))}
              value={account ? String(account.id) : null}
              onChange={(v) => v && onConfig({ ...config, accountId: Number(v) })}
              allowDeselect={false}
              size="xs"
              w={140}
            />
          )}
        </Group>
      </Group>
      {account && balances.length > 0 ? (
        <>
          <Text fw={700} size="lg" c={breaches ? "red" : undefined}>
            {base && ending != null ? formatMinor(ending, base) : "—"}
          </Text>
          <Chart option={option} height={200} />
        </>
      ) : (
        <Text c="dimmed" size="sm">
          {t("dashboard.noData")}
        </Text>
      )}
    </Card>
  );
}
