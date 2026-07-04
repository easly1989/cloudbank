import { Card, Group, Stack, Text, Title } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { getUnclearedReport } from "../../../api/client";
import { formatMinor } from "../../../money";

// UnclearedSummaryCard lists the accounts that still have uncleared (status
// None) transactions, with the count and net amount — the reconciliation
// backlog. Empty state when everything is cleared.
export function UnclearedSummaryCard({ walletId }: { walletId: number }) {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: ["uncleared", walletId],
    queryFn: () => getUnclearedReport(walletId),
    enabled: walletId > 0,
  });
  const accounts = q.data?.accounts ?? [];

  return (
    <Card withBorder h="100%">
      <Group justify="space-between" mb="xs" wrap="nowrap" gap="xs">
        <Title order={4}>{t("dashboard.uncleared")}</Title>
      </Group>
      {accounts.length === 0 ? (
        <Text c="dimmed" size="sm">
          {t("dashboard.allCleared")}
        </Text>
      ) : (
        <Stack gap={6}>
          {accounts.map((a) => (
            <Group key={a.accountId} justify="space-between" wrap="nowrap" gap="xs">
              <div style={{ minWidth: 0 }}>
                <Text size="sm" truncate>
                  {a.accountName}
                </Text>
                <Text size="xs" c="dimmed">
                  {t("dashboard.unclearedCount", { count: a.count })}
                </Text>
              </div>
              <Text size="sm" fw={600} c={a.amount < 0 ? "red" : "teal"}>
                {formatMinor(a.amount, a.currency)}
              </Text>
            </Group>
          ))}
        </Stack>
      )}
    </Card>
  );
}
