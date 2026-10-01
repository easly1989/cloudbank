import { Card, Group, Text, Title } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { type CurrencyInfo, getBudgetReport } from "../../../api/client";
import { BudgetGauge } from "../../BudgetGauge";

// BudgetWidget shows this month's combined expense budget vs actual as an
// over/under progress gauge, from the budget report's totals: the budgeted
// spending lines only.
export function BudgetWidget({ walletId, base }: { walletId: number; base?: CurrencyInfo }) {
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
  // Spending is negative; the gauge takes magnitudes.
  const budget = -(query.data?.totalBudget ?? 0);
  const actual = -(query.data?.totalActual ?? 0);

  return (
    <Card withBorder>
      <Group justify="space-between" mb="sm">
        <Title order={4}>{t("dashboard.budget")}</Title>
        <Text size="sm" c="dimmed">
          {t("dashboard.thisMonth")}
        </Text>
      </Group>
      {budget === 0 || !base ? (
        <Text c="dimmed">{t("budget.noBudgetSet")}</Text>
      ) : (
        <BudgetGauge budget={budget} actual={actual} base={base} />
      )}
    </Card>
  );
}
