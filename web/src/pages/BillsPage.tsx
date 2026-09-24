import { Button, Card, Stack } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { BillQuickAddModal } from "../components/BillQuickAddModal";
import { BillsList } from "../components/BillsList";
import { useWallet } from "../wallet/WalletProvider";
import { PageHeader } from "../components/PageHeader";

// BillsPage is the dedicated "what's due" surface: one row per bill (its last
// payment and next occurrence, classified overdue / due), with a base-currency
// total, a one-click "mark paid", and a quick form to add a new bill.
export function BillsPage() {
  const { t } = useTranslation();
  const { currentWallet } = useWallet();
  const qc = useQueryClient();
  const [addOpened, addModal] = useDisclosure(false);
  const walletId = currentWallet?.id ?? 0;

  if (!currentWallet) return null;

  return (
    <Stack>
      <PageHeader
        title={t("bills.title")}
        hint={t("bills.hint")}
        actions={<Button onClick={addModal.open}>{t("bills.add")}</Button>}
      />
      <Card withBorder>
        <BillsList walletId={walletId} />
      </Card>
      <BillQuickAddModal
        opened={addOpened}
        onClose={addModal.close}
        walletId={walletId}
        billsCategoryId={currentWallet.billsCategoryId}
        onAdded={() => void qc.invalidateQueries({ queryKey: ["bills", walletId] })}
      />
    </Stack>
  );
}
