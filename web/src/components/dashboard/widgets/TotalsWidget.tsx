import { Card, Group, SimpleGrid, Text, Tooltip } from "@mantine/core";
import { IconInfoCircle } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

import type { CurrencyInfo } from "../../../api/client";
import { formatMinor } from "../../../money";

// TotalsWidget shows the wallet's reconciled / today / future base-currency
// totals as three cards. Renders nothing until the base currency and totals are
// loaded. Definitions match the register header (see TransactionsPage).
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
      <TotalCard
        label={t("register.bank")}
        help={t("register.bankHelp")}
        value={totals.bank}
        fmt={base}
      />
      <TotalCard
        label={t("register.today")}
        help={t("register.todayHelp")}
        value={totals.today}
        fmt={base}
      />
      <TotalCard
        label={t("register.future")}
        help={t("register.futureHelp")}
        value={totals.future}
        fmt={base}
      />
    </SimpleGrid>
  );
}

function TotalCard({
  label,
  value,
  fmt,
  help,
}: {
  label: string;
  value: number;
  fmt: CurrencyInfo;
  help?: string;
}) {
  return (
    <Card withBorder padding="sm">
      <Group gap={4} wrap="nowrap">
        <Text size="xs" c="dimmed" tt="uppercase">
          {label} · {fmt.code}
        </Text>
        {help && (
          <Tooltip label={help} multiline w={240} withArrow>
            <IconInfoCircle size={13} style={{ opacity: 0.5, flexShrink: 0 }} />
          </Tooltip>
        )}
      </Group>
      <Text size="xl" fw={700} c={value < 0 ? "red" : undefined}>
        {formatMinor(value, fmt)}
      </Text>
    </Card>
  );
}
