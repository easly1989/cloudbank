import { Card, Group, Stack, Table, Text, Title } from "@mantine/core";
import { useTranslation } from "react-i18next";

import type { CurrencyInfo, DashboardAccount } from "../../../api/client";
import { formatMinor } from "../../../money";

// AccountsPanel groups the home-screen accounts by type with per-group subtotals
// and a base-currency grand total.
export function AccountsPanel({
  groups,
  base,
  totals,
}: {
  groups: [string, DashboardAccount[]][];
  base?: CurrencyInfo;
  totals?: { bank: number; today: number; future: number };
}) {
  const { t } = useTranslation();
  return (
    <Card withBorder>
      <Title order={4} mb="sm">
        {t("dashboard.yourAccounts")}
      </Title>
      {groups.length === 0 && <Text c="dimmed">{t("dashboard.noAccounts")}</Text>}
      <Stack gap="lg">
        {groups.map(([type, accounts]) => (
          <div key={type}>
            <Text size="sm" fw={600} c="dimmed" tt="uppercase" mb={4}>
              {t(`accounts.types.${type}`)}
            </Text>
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t("accounts.name")}</Table.Th>
                  <Table.Th ta="right">{t("register.bank")}</Table.Th>
                  <Table.Th ta="right">{t("register.today")}</Table.Th>
                  <Table.Th ta="right">{t("register.future")}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {accounts.map((a) => (
                  <Table.Tr key={a.id}>
                    <Table.Td>{a.name}</Table.Td>
                    <Table.Td ta="right">{formatMinor(a.bank, a.currency)}</Table.Td>
                    <Table.Td ta="right">{formatMinor(a.today, a.currency)}</Table.Td>
                    <Table.Td ta="right" c={a.future < 0 ? "red" : undefined}>
                      {formatMinor(a.future, a.currency)}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
              <GroupSubtotal accounts={accounts} />
            </Table>
          </div>
        ))}
        {base && totals && groups.length > 0 && (
          <Group justify="space-between" pt="xs" wrap="nowrap">
            <Text fw={700}>{t("dashboard.total")}</Text>
            <Group gap="lg" wrap="nowrap">
              <Text fw={700}>{formatMinor(totals.bank, base)}</Text>
              <Text fw={700}>{formatMinor(totals.today, base)}</Text>
              <Text fw={700} c={totals.future < 0 ? "red" : undefined}>
                {formatMinor(totals.future, base)}
              </Text>
            </Group>
          </Group>
        )}
      </Stack>
    </Card>
  );
}

// GroupSubtotal renders a table footer summing a same-type group's balances. It
// is skipped for single-account groups (the row already shows the total) and
// when the group mixes currencies (a raw sum would be meaningless).
function GroupSubtotal({ accounts }: { accounts: DashboardAccount[] }) {
  const { t } = useTranslation();
  const cur = accounts[0]?.currency;
  const mixed = accounts.some((a) => a.currencyId !== accounts[0]?.currencyId);
  if (!cur || mixed || accounts.length < 2) return null;
  const bank = accounts.reduce((s, a) => s + a.bank, 0);
  const today = accounts.reduce((s, a) => s + a.today, 0);
  const future = accounts.reduce((s, a) => s + a.future, 0);
  return (
    <Table.Tfoot>
      <Table.Tr>
        <Table.Td fw={600}>{t("dashboard.subtotal")}</Table.Td>
        <Table.Td ta="right" fw={600}>
          {formatMinor(bank, cur)}
        </Table.Td>
        <Table.Td ta="right" fw={600}>
          {formatMinor(today, cur)}
        </Table.Td>
        <Table.Td ta="right" fw={600} c={future < 0 ? "red" : undefined}>
          {formatMinor(future, cur)}
        </Table.Td>
      </Table.Tr>
    </Table.Tfoot>
  );
}
