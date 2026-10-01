import { Card, Group, Select, Text, Title } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { type CurrencyInfo, getBudgetReport } from "../../../api/client";
import { BudgetGauge } from "../../BudgetGauge";

// CategoryBudgetCard shows this month's budget vs actual for one chosen category
// as an over/under gauge. The category is picked per instance (defaults to the
// first budgeted one). Reuses the budget report, one row per budget line.
export function CategoryBudgetCard({
  walletId,
  base,
  config,
  onConfig,
}: {
  walletId: number;
  base?: CurrencyInfo;
  config: { categoryId?: number };
  onConfig: (c: { categoryId?: number }) => void;
}) {
  const { t } = useTranslation();
  const { from, to } = useMemo(() => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const y = now.getFullYear();
    const m = now.getMonth();
    const lastDay = new Date(y, m + 1, 0).getDate();
    return { from: `${y}-${pad(m + 1)}-01`, to: `${y}-${pad(m + 1)}-${pad(lastDay)}` };
  }, []);
  const query = useQuery({
    queryKey: ["budgetReport", walletId, from, to],
    queryFn: () => getBudgetReport(walletId, from, to),
    enabled: walletId > 0,
  });
  // Only categories with a budget configured are selectable.
  const budgeted = (query.data?.rows ?? []).filter((r) => r.budgeted);
  const row = budgeted.find((r) => r.categoryId === config.categoryId) ?? budgeted[0];

  return (
    <Card withBorder>
      <Group justify="space-between" mb="sm" wrap="nowrap" gap="xs">
        <Title order={4}>{t("dashboard.categoryBudget")}</Title>
        {budgeted.length > 0 && (
          <Select
            aria-label={t("dashboard.selectCategory")}
            data={budgeted.map((r) => ({ value: String(r.categoryId), label: r.name }))}
            value={row ? String(row.categoryId) : null}
            onChange={(v) => v && onConfig({ categoryId: Number(v) })}
            allowDeselect={false}
            size="xs"
            w={160}
          />
        )}
      </Group>
      {row && base ? (
        <BudgetGauge budget={Math.abs(row.budget)} actual={Math.abs(row.actual)} base={base} />
      ) : (
        <Text c="dimmed" size="sm">
          {t("dashboard.noBudgetForCategory")}
        </Text>
      )}
    </Card>
  );
}
