import { Button, Group, MultiSelect, SegmentedControl, Stack, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import type { EChartsOption } from "echarts";
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { type ReportBucket, getBalanceReport, listAccounts } from "../../api/client";
import { formatMinor } from "../../money";
import { useWallet } from "../../wallet/WalletProvider";
import { Chart, type ChartHandle } from "../Chart";
import { BUCKETS, SERIES_PALETTE, baseFmt, todayBucketKey } from "./reportUtils";

export function BalanceTab() {
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
