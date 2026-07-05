import { Card, Group, Select, Stack, Text, Title } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { getRegister, listAccounts } from "../../../api/client";
import { useDateFormat } from "../../../dates";
import { formatMinor } from "../../../money";
import { accountFmt } from "./shared";

// RecentTransactionsCard lists the latest transactions in a chosen account.
export function RecentTransactionsCard({
  walletId,
  config,
  onConfig,
}: {
  walletId: number;
  config: { accountId?: number };
  onConfig: (c: { accountId?: number }) => void;
}) {
  const { t } = useTranslation();
  const fmtDate = useDateFormat();
  const accountsQ = useQuery({
    queryKey: ["accounts", walletId],
    queryFn: () => listAccounts(walletId),
    enabled: walletId > 0,
  });
  const accounts = accountsQ.data ?? [];
  const account = accounts.find((a) => a.id === config.accountId) ?? accounts[0];
  const regQ = useQuery({
    queryKey: ["register", walletId, account?.id],
    queryFn: () => getRegister(walletId, account!.id),
    enabled: walletId > 0 && !!account,
  });
  const rows = (regQ.data?.rows ?? []).slice(-8).reverse();
  return (
    <Card withBorder>
      <Group justify="space-between" mb="xs" wrap="nowrap" gap="xs">
        <Title order={4}>{t("dashboard.recentTransactions")}</Title>
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
      {account && rows.length > 0 ? (
        <Stack gap={4}>
          {rows.map((r) => (
            <Group key={r.id} justify="space-between" wrap="nowrap" gap="xs">
              <div style={{ minWidth: 0 }}>
                <Text size="sm" truncate>
                  {r.payeeName || r.memo || "—"}
                </Text>
                <Text size="xs" c="dimmed">
                  {fmtDate(r.date)}
                </Text>
              </div>
              <Text size="sm" fw={600} c={r.amount < 0 ? "red" : "teal"}>
                {formatMinor(r.amount, accountFmt(account))}
              </Text>
            </Group>
          ))}
        </Stack>
      ) : (
        <Text c="dimmed" size="sm">
          {t("dashboard.recentEmpty")}
        </Text>
      )}
    </Card>
  );
}
