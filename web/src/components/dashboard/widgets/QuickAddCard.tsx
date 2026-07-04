import { Button, Card, Group, Select, Stack, Title } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconPlus } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { listAccounts, listTemplates } from "../../../api/client";
import { useAuth } from "../../../auth/AuthProvider";
import { TransactionForm } from "../../TransactionForm";

// QuickAddCard mirrors HomeBank: pick an account and "Add" opens the full
// transaction modal (the same one the register uses); totals/balances refresh
// on save.
export function QuickAddCard({ walletId }: { walletId: number }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [opened, modal] = useDisclosure(false);
  const accountsQuery = useQuery({
    queryKey: ["accounts", walletId],
    queryFn: () => listAccounts(walletId),
    enabled: walletId > 0,
  });
  const templatesQuery = useQuery({
    queryKey: ["templates", walletId],
    queryFn: () => listTemplates(walletId),
    enabled: walletId > 0,
  });
  const accounts = useMemo(
    () => (accountsQuery.data ?? []).filter((a) => !a.closed),
    [accountsQuery.data],
  );
  const [accountId, setAccountId] = useState<string | null>(null);

  useEffect(() => {
    if (accountId || accounts.length === 0) return;
    const pref = user?.preferences?.defaultAccountId;
    const initial = pref && accounts.some((a) => a.id === pref) ? pref : accounts[0].id;
    setAccountId(String(initial));
  }, [accounts, accountId, user]);

  const account = accounts.find((a) => String(a.id) === accountId);
  if (accounts.length === 0) return null;

  const onSaved = () => {
    void qc.invalidateQueries({ queryKey: ["dashboard", walletId] });
    void qc.invalidateQueries({ queryKey: ["accounts", walletId] });
    void qc.invalidateQueries({ queryKey: ["register", walletId] });
    modal.close();
  };

  return (
    <Card withBorder h="100%" data-tour="quick-add">
      <Stack gap="xs">
        <Title order={4}>{t("dashboard.addTransaction")}</Title>
        <Group gap="xs" wrap="nowrap">
          <Select
            aria-label={t("transactions.account")}
            data={accounts.map((a) => ({ value: String(a.id), label: a.name }))}
            value={accountId}
            onChange={setAccountId}
            allowDeselect={false}
            searchable
            style={{ flex: 1, minWidth: 0, maxWidth: 260 }}
          />
          <Button
            leftSection={<IconPlus size={16} />}
            onClick={modal.open}
            disabled={!account}
            style={{ flexShrink: 0 }}
          >
            {t("dashboard.addTransaction")}
          </Button>
        </Group>
      </Stack>
      {account && (
        <TransactionForm
          opened={opened}
          onClose={modal.close}
          walletId={walletId}
          account={account}
          editing={null}
          onSaved={onSaved}
          templates={templatesQuery.data ?? []}
          onTemplateSaved={() => void qc.invalidateQueries({ queryKey: ["templates", walletId] })}
        />
      )}
    </Card>
  );
}
