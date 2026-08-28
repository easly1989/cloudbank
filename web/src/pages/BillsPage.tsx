import { Card, Stack, Text, Title } from "@mantine/core";
import { useTranslation } from "react-i18next";

import { BillsList } from "../components/BillsList";
import { useWallet } from "../wallet/WalletProvider";

// BillsPage is the dedicated "what's due" surface: every scheduled outflow for
// the window, classified overdue / due / paid, with a base-currency total and a
// one-click "mark paid" (post the scheduled transaction).
export function BillsPage() {
  const { t } = useTranslation();
  const { currentWallet } = useWallet();
  const walletId = currentWallet?.id ?? 0;

  if (!currentWallet) return null;

  return (
    <Stack>
      <div>
        <Title order={2}>{t("bills.title")}</Title>
        <Text c="dimmed" size="sm">
          {t("bills.hint")}
        </Text>
      </div>
      <Card withBorder>
        <BillsList walletId={walletId} />
      </Card>
    </Stack>
  );
}
