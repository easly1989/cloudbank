import { Anchor, Card, Group, Title } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { BillsList } from "../../BillsList";

// BillsPanel is the dashboard widget: a compact "what's due" list (overdue and
// due only) with the base-currency total, linking to the full Bills page.
export function BillsPanel({ walletId }: { walletId: number }) {
  const { t } = useTranslation();
  return (
    <Card withBorder>
      <Group justify="space-between" mb="sm">
        <Title order={4}>{t("bills.title")}</Title>
        <Anchor component={Link} to="/bills" size="sm">
          {t("bills.viewAll")}
        </Anchor>
      </Group>
      <BillsList walletId={walletId} compact limit={6} />
    </Card>
  );
}
