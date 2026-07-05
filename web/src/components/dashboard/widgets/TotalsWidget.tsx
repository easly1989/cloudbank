import { Card, SimpleGrid, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";

import type { CurrencyInfo } from "../../../api/client";
import { formatMinor } from "../../../money";

// TotalsWidget shows the wallet's bank / today / future base-currency totals as
// three cards. Renders nothing until the base currency and totals are loaded.
export function TotalsWidget({
  totals,
  base,
}: {
  totals?: { bank: number; today: number; future: number };
  base?: CurrencyInfo;
}) {
  const { t } = useTranslation();
  if (!base || !totals) return null;
  return (
    <SimpleGrid cols={{ base: 1, sm: 3 }}>
      <TotalCard label={t("register.bank")} value={totals.bank} fmt={base} />
      <TotalCard label={t("register.today")} value={totals.today} fmt={base} />
      <TotalCard label={t("register.future")} value={totals.future} fmt={base} />
    </SimpleGrid>
  );
}

function TotalCard({ label, value, fmt }: { label: string; value: number; fmt: CurrencyInfo }) {
  return (
    <Card withBorder padding="sm">
      <Text size="xs" c="dimmed" tt="uppercase">
        {label} · {fmt.code}
      </Text>
      <Text size="xl" fw={700} c={value < 0 ? "red" : undefined}>
        {formatMinor(value, fmt)}
      </Text>
    </Card>
  );
}
