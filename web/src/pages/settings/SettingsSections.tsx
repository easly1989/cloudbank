import { Anchor, Card, Group, Stack, Text } from "@mantine/core";
import { IconExternalLink } from "@tabler/icons-react";
import { Trans, useTranslation } from "react-i18next";

import {
  API_DOCS_URL,
  DONATE_URL,
  GUIDE_URL,
  HOMEBANK_URL,
  SOURCE_URL,
  useVersion,
} from "../../aboutLinks";

import { AiSettingsCard } from "../../components/AiSettingsCard";
import { EntryFieldsCard } from "../../components/EntryFieldsCard";
import { Logo } from "../../components/Logo";
import { NavLayoutEditor } from "../../components/NavLayoutEditor";
import { NotificationsCard } from "../../components/NotificationsCard";
import { PasswordCard } from "../../components/PasswordCard";
import { TwoFactorCard } from "../../components/TwoFactorCard";
import { UpdateStatusCard } from "../../components/updates/UpdateStatusCard";
import { useAuth } from "../../auth/AuthProvider";
import { ApiTokensPage } from "../ApiTokensPage";
import { BankSyncSettings } from "../BankSyncPage";
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
        {!__DEMO__ && <PasswordCard />}
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
      {!__DEMO__ && (
        <SettingsGroup title={t("settings.ai")} hint={t("settings.aiHint")}>
          <AiSettingsCard />
        </SettingsGroup>
      )}
      {/* The demo's section is Bank sync alone, so a group of the same name
          would only repeat it, and its hint names providers the demo lacks. */}
      {__DEMO__ ? (
        <BankSyncSettings />
      ) : (
        <SettingsGroup title={t("banksync.title")} hint={t("banksync.hint")}>
          <BankSyncSettings />
        </SettingsGroup>
      )}
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

/**
 * What this installation is (#513): the version, the licence in one sentence,
 * and the links the footer carries. It exists so that turning the footer off
 * hides nothing — the AGPL wants the source in reach of whoever uses the app.
 */
export function AboutSection() {
  const { t } = useTranslation();
  const version = useVersion();
  const { user } = useAuth();
  const links = [
    { href: GUIDE_URL, label: t("app.guide"), hint: t("about.guideHint") },
    { href: SOURCE_URL, label: t("about.source"), hint: "github.com/easly1989/cloudbank" },
    { href: API_DOCS_URL, label: t("app.apiDocs"), hint: t("about.apiDocsHint") },
    { href: DONATE_URL, label: t("about.support"), hint: t("about.supportHint") },
    { href: HOMEBANK_URL, label: "HomeBank", hint: t("about.homebankHint") },
  ];
  return (
    <Stack gap="lg" maw={560}>
      <Group gap="sm" wrap="nowrap">
        <Logo size={40} />
        <div>
          <Text fw={700} fz="lg">
            {t("app.name")}
          </Text>
          <Text ff="monospace" fz="sm" c="dimmed" data-testid="about-version">
            {t("about.version", { version: version ?? "…" })}
          </Text>
        </div>
      </Group>
      {/* Admins only, and never in the demo (#582). */}
      {!__DEMO__ && user?.isAdmin && <UpdateStatusCard />}
      <Text>
        <Trans i18nKey="about.licence" components={{ b: <b /> }} />
      </Text>
      <Card withBorder p={0}>
        {links.map((l, i) => (
          <Anchor
            key={l.href}
            href={l.href}
            target="_blank"
            rel="noreferrer"
            underline="never"
            c="inherit"
            className="cb-about-link"
            style={
              i > 0 ? { borderTop: "1px solid var(--mantine-color-default-border)" } : undefined
            }
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <Text fw={500}>{l.label}</Text>
              <Text size="xs" c="dimmed" truncate>
                {l.hint}
              </Text>
            </div>
            <IconExternalLink size={16} style={{ opacity: 0.6, flexShrink: 0 }} />
          </Anchor>
        ))}
      </Card>
    </Stack>
  );
}
