import { Stack, Tabs } from "@mantine/core";
import { IconKey, IconMenu2, IconSettings, IconUsers, IconWallet } from "@tabler/icons-react";
import { PageHeader } from "../components/PageHeader";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

import { NavLayoutEditor } from "../components/NavLayoutEditor";
import { useAuth } from "../auth/AuthProvider";
import { useWallet } from "../wallet/WalletProvider";
import { UsersPage } from "./admin/UsersPage";
import { ApiTokensPage } from "./ApiTokensPage";
import { PreferencesPage } from "./PreferencesPage";
import { WalletSettingsPage } from "./WalletSettingsPage";

// SettingsPage is the single Settings hub: user preferences, the current
// wallet's settings, the navigation layout, API tokens, and — for an admin —
// the people who can sign in. The active tab round-trips through the ?tab=
// query so it is deep-linkable, and /admin/users redirects to ?tab=people so
// older bookmarks still land somewhere sensible.
export function SettingsPage() {
  const { t } = useTranslation();
  const { currentWallet } = useWallet();
  const { user } = useAuth();
  const isAdmin = Boolean(user?.isAdmin);
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab");
  const known = raw === "wallet" || raw === "tokens" || raw === "nav";
  const tab = known ? raw : raw === "people" && isAdmin ? "people" : "general";

  return (
    <Stack>
      <PageHeader title={t("settings.title")} />
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
          <Tabs.Tab value="nav" leftSection={<IconMenu2 size={16} />}>
            {t("settings.navigation")}
          </Tabs.Tab>
          <Tabs.Tab value="tokens" leftSection={<IconKey size={16} />}>
            {t("settings.apiTokens")}
          </Tabs.Tab>
          {isAdmin && (
            <Tabs.Tab value="people" leftSection={<IconUsers size={16} />}>
              {t("settings.people")}
            </Tabs.Tab>
          )}
        </Tabs.List>
        <Tabs.Panel value="general">
          <PreferencesPage />
        </Tabs.Panel>
        <Tabs.Panel value="wallet">
          <WalletSettingsPage />
        </Tabs.Panel>
        <Tabs.Panel value="nav">
          <NavLayoutEditor />
        </Tabs.Panel>
        <Tabs.Panel value="tokens">
          <ApiTokensPage />
        </Tabs.Panel>
        {isAdmin && (
          <Tabs.Panel value="people">
            <UsersPage />
          </Tabs.Panel>
        )}
      </Tabs>
    </Stack>
  );
}
