import { Card, Group, Stack, Text, Title } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { listCurrencies } from "../../../api/client";

// CurrencyRatesCard lists the wallet's non-base currencies with their exchange
// rate relative to the base currency (mirrors the Currencies page "per base").
export function CurrencyRatesCard({ walletId }: { walletId: number }) {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: ["currencies", walletId],
    queryFn: () => listCurrencies(walletId),
    enabled: walletId > 0,
  });
  const currencies = q.data ?? [];
  const base = currencies.find((c) => c.isBase);
  const others = currencies.filter((c) => !c.isBase);

  return (
    <Card withBorder>
      <Group justify="space-between" mb="xs" wrap="nowrap" gap="xs">
        <Title order={4}>{t("dashboard.currencyRates")}</Title>
        {base && (
          <Text size="xs" c="dimmed">
            {t("dashboard.perBase", { code: base.isoCode })}
          </Text>
        )}
      </Group>
      {others.length === 0 ? (
        <Text c="dimmed" size="sm">
          {t("dashboard.currencyRatesEmpty")}
        </Text>
      ) : (
        <Stack gap={4}>
          {others.map((c) => (
            <Group key={c.id} justify="space-between" wrap="nowrap" gap="xs">
              <Text size="sm" truncate>
                {c.isoCode}
                <Text span size="xs" c="dimmed">
                  {` · ${c.name}`}
                </Text>
              </Text>
              <Text size="sm" fw={600}>
                {c.rate.toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 6,
                })}
              </Text>
            </Group>
          ))}
        </Stack>
      )}
    </Card>
  );
}
