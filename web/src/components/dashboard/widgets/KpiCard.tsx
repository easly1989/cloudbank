import { Card, Group, Select, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";

import type { CurrencyInfo } from "../../../api/client";
import { formatMinor } from "../../../money";
import type { KpiConfig } from "./shared";

// KpiCard shows one wallet-wide figure as a big number.
export function KpiCard({
  data,
  base,
  config,
  onConfig,
}: {
  data?: { totals: { bank: number; today: number; future: number } };
  base?: CurrencyInfo;
  config: KpiConfig;
  onConfig: (c: KpiConfig) => void;
}) {
  const { t } = useTranslation();
  const metrics: Record<KpiConfig["metric"], { label: string; value?: number }> = {
    today: { label: t("dashboard.metricToday"), value: data?.totals.today },
    future: { label: t("dashboard.metricFuture"), value: data?.totals.future },
    bank: { label: t("dashboard.metricBank"), value: data?.totals.bank },
  };
  const m = metrics[config.metric];
  return (
    <Card withBorder h="100%">
      <Group justify="space-between" mb="xs" wrap="nowrap" gap="xs">
        <Text size="xs" c="dimmed" tt="uppercase" truncate>
          {m.label}
        </Text>
        <Select
          aria-label={t("dashboard.metric")}
          data={(["today", "future", "bank"] as const).map((k) => ({
            value: k,
            label: metrics[k].label,
          }))}
          value={config.metric}
          onChange={(v) => v && onConfig({ metric: v as KpiConfig["metric"] })}
          allowDeselect={false}
          size="xs"
          w={130}
        />
      </Group>
      <Text fw={700} size="xl" c={m.value != null && m.value < 0 ? "red" : undefined}>
        {base && m.value != null ? formatMinor(m.value, base) : "—"}
      </Text>
    </Card>
  );
}
