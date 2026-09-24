import { Anchor, Stack } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { AiSettingsCard } from "../../components/AiSettingsCard";
import { EntryFieldsCard } from "../../components/EntryFieldsCard";
import { NavLayoutEditor } from "../../components/NavLayoutEditor";
import { NotificationsCard } from "../../components/NotificationsCard";
import { TwoFactorCard } from "../../components/TwoFactorCard";
import { ApiTokensPage } from "../ApiTokensPage";
import { PreferencesPage } from "../PreferencesPage";
import { WalletSettingsPage } from "../WalletSettingsPage";
import { UsersPage } from "../admin/UsersPage";
import { SettingsGroup } from "./SettingsLayout";

// One component per section of the settings screen. They are thin on purpose:
// the work lives in the cards and forms that were already there, and what
// changes here is only which of them belong together.
//
// Where a card moved, it moved because the tile says so. Two-factor and API
// tokens are both "who can get in", so they share a section; the AI key and the
// bank connections are both "something else acting on your behalf", so they
// share another; and the navigation layout is appearance, not a page of its own.

export function GeneralSection() {
  const { t } = useTranslation();
  return (
    <Stack gap="xl">
      <PreferencesPage section="general" />
      <SettingsGroup title={t("entryFields.title")} hint={t("entryFields.hint")}>
        <EntryFieldsCard />
      </SettingsGroup>
    </Stack>
  );
}

export function AppearanceSection() {
  const { t } = useTranslation();
  return (
    <Stack gap="xl">
      <PreferencesPage section="appearance" />
      <SettingsGroup title={t("settings.navigation")} hint={t("settings.navigationHint")}>
        <NavLayoutEditor />
      </SettingsGroup>
    </Stack>
  );
}

export function WalletSection() {
  return <WalletSettingsPage only="general" />;
}

export function SecuritySection() {
  const { t } = useTranslation();
  return (
    <Stack gap="xl">
      <SettingsGroup title={t("settings.signIn")} hint={t("settings.signInHint")}>
        <TwoFactorCard />
      </SettingsGroup>
      <SettingsGroup title={t("settings.apiTokens")} hint={t("settings.apiTokensHint")}>
        <ApiTokensPage />
      </SettingsGroup>
      <SettingsGroup title={t("notif.title")} hint={t("settings.notificationsHint")}>
        <NotificationsCard />
      </SettingsGroup>
    </Stack>
  );
}

export function IntegrationsSection() {
  const { t } = useTranslation();
  return (
    <Stack gap="xl">
      <SettingsGroup title={t("settings.ai")} hint={t("settings.aiHint")}>
        <AiSettingsCard />
      </SettingsGroup>
      <SettingsGroup title={t("banksync.title")} hint={t("settings.bankSyncHint")}>
        {/* The connections themselves are a page, not a setting: they have
            their own state, their own errors and their own history. */}
        <Anchor component={Link} to="/bank-sync">
          {t("settings.bankSyncOpen")}
        </Anchor>
      </SettingsGroup>
    </Stack>
  );
}

export function DataSection() {
  const { t } = useTranslation();
  return (
    <Stack gap="xl">
      <div data-tour="data-import">
        <SettingsGroup title={t("settings.sectionImport")} hint={t("settings.importHint")}>
          <WalletSettingsPage only="import" />
        </SettingsGroup>
      </div>
      <div data-tour="data-backup">
        <SettingsGroup title={t("settings.sectionBackup")} hint={t("settings.backupHint")}>
          <WalletSettingsPage only="backup" />
        </SettingsGroup>
      </div>
      <WalletSettingsPage only="danger" />
    </Stack>
  );
}

export function PeopleSection() {
  return <UsersPage />;
}
