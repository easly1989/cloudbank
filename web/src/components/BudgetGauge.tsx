import { Group, Progress, Stack, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";

import { type MoneyFormat, formatMinor } from "../money";

// BudgetGauge renders an over/under progress bar for a budget vs actual pair
// (both positive magnitudes, in the base currency).
export function BudgetGauge({
  budget,
  actual,
  base,
}: {
  budget: number;
  actual: number;
  base: MoneyFormat;
}) {
  const { t } = useTranslation();
  const over = actual > budget;
  const pct = budget > 0 ? Math.min(100, Math.round((actual / budget) * 100)) : 0;
  return (
    <Stack gap={6}>
      <Group justify="space-between" gap="xs" wrap="nowrap">
        <Text size="sm">
          {t("budget.spentOf", {
            spent: formatMinor(actual, base),
            budget: formatMinor(budget, base),
          })}
        </Text>
        <Text size="sm" fw={600} c={over ? "red" : "teal"}>
          {over
            ? t("budget.overBy", { amount: formatMinor(actual - budget, base) })
            : t("budget.remaining", { amount: formatMinor(budget - actual, base) })}
        </Text>
      </Group>
      <Progress value={pct} color={over ? "red" : "teal"} size="lg" radius="sm" />
    </Stack>
  );
}
