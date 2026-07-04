import { Card, Group, Text, Title } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { type CurrencyInfo, getBudgetReport } from "../../../api/client";
import { BudgetGauge } from "../../BudgetGauge";

// BudgetWidget shows this month's combined expense budget vs actual as an
// over/under progress gauge, from the budget report (rolled up).
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
    queryKey: ["budgetReport", walletId, from, to, true],
    queryFn: () => getBudgetReport(walletId, from, to, true),
    enabled: walletId > 0,
  });
  // Combined expense budget vs actual (magnitudes), over the non-income rows.
  const { budget, actual } = useMemo(() => {
    let budget = 0;
    let actual = 0;
    for (const r of query.data?.rows ?? []) {
      if (r.isIncome) continue;
      budget += Math.abs(r.budget);
      actual += Math.abs(r.actual);
    }
    return { budget, actual };
  }, [query.data]);

  return (
    <Card withBorder h="100%">
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
