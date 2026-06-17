import { Card, Group, SimpleGrid, Stack, Table, Text, Title } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { type CurrencyInfo, type DashboardAccount, getDashboard } from "../api/client";
import { Donut } from "../components/Donut";
import { formatMinor } from "../money";
import { useWallet } from "../wallet/WalletProvider";

// A fixed, color-blind-friendly palette cycled across donut slices.
const DONUT_PALETTE = [
  "#4dabf7",
  "#ff8787",
  "#69db7c",
  "#ffd43b",
  "#da77f2",
  "#3bc9db",
  "#ffa94d",
  "#a9e34b",
  "#9775fa",
];

export function DashboardPage() {
  const { t } = useTranslation();
  const { currentWallet } = useWallet();
  const walletId = currentWallet?.id ?? 0;

  const query = useQuery({
    queryKey: ["dashboard", walletId],
    queryFn: () => getDashboard(walletId),
    enabled: walletId > 0,
  });
  const data = query.data;

  // Accounts shown on the home screen exclude closed and excluded-from-summary
  // accounts; group the rest by account type.
  const groups = useMemo(() => {
    const visible = (data?.accounts ?? []).filter((a) => !a.closed && !a.noSummary);
    const byType = new Map<string, DashboardAccount[]>();
    for (const a of visible) {
      const arr = byType.get(a.type) ?? [];
      arr.push(a);
      byType.set(a.type, arr);
    }
    return [...byType.entries()];
  }, [data]);

  if (!currentWallet) return null;
  const base = data?.baseCurrency ?? undefined;

  return (
    <Stack>
      <Title order={2}>{t("dashboard.title")}</Title>

      {base && data && (
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          <TotalCard label={t("register.bank")} value={data.totals.bank} fmt={base} />
          <TotalCard label={t("register.today")} value={data.totals.today} fmt={base} />
          <TotalCard label={t("register.future")} value={data.totals.future} fmt={base} />
        </SimpleGrid>
      )}

      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
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
                </Table>
              </div>
            ))}
          </Stack>
        </Card>

        <Stack>
          <Card withBorder>
            <Title order={4} mb="sm">
              {t("dashboard.whereMoneyGoes")}
            </Title>
            <SpendingDonut slices={data?.topCategories ?? []} base={base} />
          </Card>

          <Card withBorder>
            <Title order={4} mb="sm">
              {t("dashboard.upcoming")}
            </Title>
            {(data?.upcoming ?? []).length === 0 ? (
              <Text c="dimmed">{t("dashboard.noUpcoming")}</Text>
            ) : (
              <Stack gap={6}>
                {(data?.upcoming ?? []).map((u) => (
                  <Group key={u.id} justify="space-between" wrap="nowrap">
                    <Text size="sm" truncate>
                      {u.templateName}
                    </Text>
                    <Text size="sm" c="dimmed">
                      {u.nextDue}
                    </Text>
                  </Group>
                ))}
              </Stack>
            )}
          </Card>
        </Stack>
      </SimpleGrid>
    </Stack>
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

function SpendingDonut({
  slices,
  base,
}: {
  slices: { categoryId: number; name: string; amount: number }[];
  base?: CurrencyInfo;
}) {
  const { t } = useTranslation();
  if (slices.length === 0 || !base) {
    return <Text c="dimmed">{t("dashboard.noSpending")}</Text>;
  }
  const data = slices.map((s, i) => ({
    label: s.categoryId === 0 ? t("dashboard.other") : s.name,
    value: s.amount,
    color: DONUT_PALETTE[i % DONUT_PALETTE.length],
  }));
  return (
    <Group align="center" wrap="wrap" gap="xl">
      <Donut data={data} />
      <Stack gap={4} style={{ flex: 1, minWidth: 160 }}>
        {data.map((d) => (
          <Group key={d.label} justify="space-between" wrap="nowrap" gap="sm">
            <Group gap={6} wrap="nowrap">
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 2,
                  background: d.color,
                  display: "inline-block",
                }}
              />
              <Text size="sm" truncate>
                {d.label}
              </Text>
            </Group>
            <Text size="sm" fw={500}>
              {formatMinor(d.value, base)}
            </Text>
          </Group>
        ))}
      </Stack>
    </Group>
  );
}
