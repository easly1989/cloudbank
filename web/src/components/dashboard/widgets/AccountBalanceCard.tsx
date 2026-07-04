import { Card, Group, Select, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { listAccounts } from "../../../api/client";
import { formatMinor } from "../../../money";
import { accountFmt } from "./shared";

// AccountBalanceCard shows a single account's today balance big, with the future
// balance secondary. The account is chosen per instance (defaults to the first).
export function AccountBalanceCard({
  walletId,
  config,
  onConfig,
}: {
  walletId: number;
  config: { accountId?: number };
  onConfig: (c: { accountId?: number }) => void;
}) {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: ["accounts", walletId],
    queryFn: () => listAccounts(walletId),
    enabled: walletId > 0,
  });
  const accounts = q.data ?? [];
  const account = accounts.find((a) => a.id === config.accountId) ?? accounts[0];
  return (
    <Card withBorder h="100%">
      <Group justify="space-between" mb="xs" wrap="nowrap" gap="xs">
        <Text size="xs" c="dimmed" tt="uppercase" truncate>
          {t("dashboard.accountBalance")}
        </Text>
        {accounts.length > 0 && (
          <Select
            aria-label={t("dashboard.selectAccount")}
            data={accounts.map((a) => ({ value: String(a.id), label: a.name }))}
            value={account ? String(account.id) : null}
            onChange={(v) => v && onConfig({ accountId: Number(v) })}
            allowDeselect={false}
            size="xs"
            w={150}
          />
        )}
      </Group>
      {account ? (
        <>
          <Text fw={700} size="xl" c={account.balance < 0 ? "red" : undefined}>
            {formatMinor(account.balance, accountFmt(account))}
          </Text>
          <Text size="xs" c="dimmed">
            {t("register.future")}: {formatMinor(account.futureBalance, accountFmt(account))}
          </Text>
        </>
      ) : (
        <Text c="dimmed" size="sm">
          {t("dashboard.noData")}
        </Text>
      )}
    </Card>
  );
}
