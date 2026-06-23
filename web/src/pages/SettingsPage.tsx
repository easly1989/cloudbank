import { Stack, Tabs, Title } from "@mantine/core";
import { IconSettings, IconWallet } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

import { PreferencesPage } from "./PreferencesPage";
import { WalletSettingsPage } from "./WalletSettingsPage";

// SettingsPage is the single Settings hub: a "General" tab for user preferences
// and a "Wallet" tab for the current wallet's settings and data management. The
// active tab round-trips through the ?tab= query so it is deep-linkable.
export function SettingsPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "wallet" ? "wallet" : "general";

  return (
    <Stack>
      <Title order={2}>{t("settings.title")}</Title>
      <Tabs
        value={tab}
        onChange={(v) => setParams(v === "wallet" ? { tab: "wallet" } : {}, { replace: true })}
      >
        <Tabs.List mb="md">
          <Tabs.Tab value="general" leftSection={<IconSettings size={16} />}>
            {t("settings.general")}
          </Tabs.Tab>
          <Tabs.Tab value="wallet" leftSection={<IconWallet size={16} />}>
            {t("settings.wallet")}
          </Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="general">
          <PreferencesPage />
        </Tabs.Panel>
        <Tabs.Panel value="wallet">
          <WalletSettingsPage />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
