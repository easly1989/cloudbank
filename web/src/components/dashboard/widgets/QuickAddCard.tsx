import { Button, Card, Group, Select, Stack, Title } from "@mantine/core";
import { IconPlus } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

import { useQuickEntry } from "../useQuickEntry";

// QuickAddCard mirrors HomeBank: pick an account and "Add" opens the full
// transaction modal (the same one the register uses); totals/balances refresh
// on save.
export function QuickAddCard({ walletId }: { walletId: number }) {
  const { t } = useTranslation();
  const { accounts, accountId, account, pick, open, form } = useQuickEntry(walletId);
  if (accounts.length === 0) return null;

  return (
    <Card withBorder data-tour="quick-add">
      <Stack gap="xs">
        <Title order={4}>{t("dashboard.addTransaction")}</Title>
        <Group gap="xs" wrap="nowrap">
          <Select
            aria-label={t("transactions.account")}
            data={accounts.map((a) => ({ value: String(a.id), label: a.name }))}
            value={accountId}
            onChange={pick}
            allowDeselect={false}
            searchable
            style={{ flex: 1, minWidth: 0, maxWidth: 260 }}
          />
          <Button
            leftSection={<IconPlus size={16} />}
            onClick={open}
            disabled={!account}
            style={{ flexShrink: 0 }}
          >
            {t("dashboard.addTransaction")}
          </Button>
        </Group>
      </Stack>
      {form}
    </Card>
  );
}
