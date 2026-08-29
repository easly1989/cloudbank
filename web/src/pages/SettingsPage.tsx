import { Stack, Tabs, Title } from "@mantine/core";
import { IconKey, IconSettings, IconWallet } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

import { useWallet } from "../wallet/WalletProvider";
import { ApiTokensPage } from "./ApiTokensPage";
import { PreferencesPage } from "./PreferencesPage";
import { WalletSettingsPage } from "./WalletSettingsPage";

// SettingsPage is the single Settings hub: a "General" tab for user preferences
// and a "Wallet" tab for the current wallet's settings and data management. The
// active tab round-trips through the ?tab= query so it is deep-linkable.
export function SettingsPage() {
  const { t } = useTranslation();
  const { currentWallet } = useWallet();
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab");
  const tab = raw === "wallet" || raw === "tokens" ? raw : "general";

  return (
    <Stack>
      <Title order={2}>{t("settings.title")}</Title>
      <Tabs
        value={tab}
        onChange={(v) => setParams(v && v !== "general" ? { tab: v } : {}, { replace: true })}
      >
        <Tabs.List mb="md">
          <Tabs.Tab value="general" leftSection={<IconSettings size={16} />}>
            {t("settings.general")}
          </Tabs.Tab>
          <Tabs.Tab value="wallet" leftSection={<IconWallet size={16} />}>
            {currentWallet?.title ?? t("settings.wallet")}
          </Tabs.Tab>
          <Tabs.Tab value="tokens" leftSection={<IconKey size={16} />}>
            {t("settings.apiTokens")}
          </Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="general">
          <PreferencesPage />
        </Tabs.Panel>
        <Tabs.Panel value="wallet">
          <WalletSettingsPage />
        </Tabs.Panel>
        <Tabs.Panel value="tokens">
          <ApiTokensPage />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
