import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Navigate } from "react-router-dom";

import { listApiTokens } from "../../api/client";
import { useAuth, useAuthConfig } from "../../auth/AuthProvider";
import { AccessCodesCard } from "../../components/AccessCodesCard";
import { EntryFieldsCard } from "../../components/EntryFieldsCard";
import { NavLayoutEditor } from "../../components/NavLayoutEditor";
import { OidcSettingsGroup } from "../../components/OidcSettingsGroup";
import { PasskeysCard } from "../../components/PasskeysCard";
import { PasswordCard } from "../../components/PasswordCard";
import { TwoFactorCard } from "../../components/TwoFactorCard";
import { UpdateStatusCard } from "../../components/updates/UpdateStatusCard";
import { ApiTokensPage } from "../ApiTokensPage";
import { HotBackupRow } from "../BackupCard";
import { BankSyncSettings } from "../BankSyncPage";
import { MailSettings } from "../MailSettings";
import { UsersPage } from "../admin/UsersPage";
import { AiSettings } from "./AiSettings";
import { AccountPreferenceRows, AppearanceRows } from "./PreferenceRows";
import { RelatedSettings, SettingRow, SettingsGroup, SettingState } from "./SettingRow";
import { useBankConnections, useMailStatus } from "./statusHooks";

// One component per page of the settings screen (#800). They are thin on
// purpose: the work lives in the rows and forms that were already there, and
// what changes here is only which of them belong together. A form too big for
// a row (the import wizard, the navigation editor, the bank connections) is
// hosted as it is, under a row or on a page of its own.

export { HomeSection } from "./HomeSection";
export {
  WalletBackupSection,
  WalletExportSection,
  WalletImportSection,
  WalletSection,
} from "./WalletPages";
// Where CloudBank reaches the reader, and with what (#685, #688).
export { NotificationChannelSection, NotificationsSection } from "./NotificationsPages";
export { NotificationMoneySection } from "./NotificationMoney";
export { NotificationTimingSection } from "./NotificationTiming";

export function AccountSection() {
  const { t } = useTranslation();
  const config = useAuthConfig().data;
  // Signing in through SSO only (#620), there is no password to change and no
  // second step on top of it: the recovery codes take their place.
  const ssoOnly = config?.passwordLogin === false;
  const tokens = useQuery({ queryKey: ["apiTokens"], queryFn: listApiTokens, enabled: !__DEMO__ });
  const count = tokens.data?.length ?? 0;
  return (
    <>
      <SettingsGroup title={t("preferences.title")}>
        <AccountPreferenceRows />
      </SettingsGroup>
      {!__DEMO__ && (
        <SettingsGroup title={t("settings.signIn")}>
          {ssoOnly ? (
            <AccessCodesCard />
          ) : (
            <>
              <PasswordCard />
              <TwoFactorCard />
              {config?.passkeys && <PasskeysCard />}
            </>
          )}
          <SettingRow
            id="api-tokens"
            control={
              tokens.isSuccess && (
                <SettingState tone={count > 0 ? "ok" : "off"}>
                  {t("settings.tokensCount", { count })}
                </SettingState>
              )
            }
          />
        </SettingsGroup>
      )}
      <RelatedSettings ids={["notif-inapp", "sso"]} />
    </>
  );
}

export function ApiTokensSection() {
  return (
    <>
      <ApiTokensPage />
      <RelatedSettings ids={["two-factor", "passkeys"]} />
    </>
  );
}

export function PersonalizationSection() {
  const { t } = useTranslation();
  return (
    <>
      <SettingsGroup title={t("settings.appearance")}>
        <AppearanceRows />
      </SettingsGroup>
      <SettingsGroup title={t("settings.layoutGroup")}>
        <SettingRow id="navigation">
          <NavLayoutEditor />
        </SettingRow>
        <SettingRow id="entry-fields" tour="entry-fields">
          <EntryFieldsCard />
        </SettingRow>
      </SettingsGroup>
      <RelatedSettings ids={["start-screen", "ai-motion"]} />
    </>
  );
}

export function ConnectionsSection() {
  const { t } = useTranslation();
  const banks = useBankConnections();
  const mail = useMailStatus();
  return (
    <>
      <SettingsGroup title={t("settings.connectionsGroup")}>
        <SettingRow
          id="bank-sync"
          control={
            banks.loaded && (
              <SettingState tone={banks.count > 0 ? "ok" : "off"}>
                {t("settings.home.banksLinked", { count: banks.count })}
              </SettingState>
            )
          }
        />
        {!__DEMO__ && (
          <SettingRow
            id="mail"
            control={
              mail.available && (
                <SettingState tone={mail.review > 0 ? "warn" : mail.mailboxes > 0 ? "ok" : "off"}>
                  {mail.review > 0
                    ? t("settings.home.toReview", { count: mail.review })
                    : t("settings.home.mailboxes", { count: mail.mailboxes })}
                </SettingState>
              )
            }
          />
        )}
      </SettingsGroup>
      <RelatedSettings ids={["import", "ai-mail", "notif-inapp"]} />
    </>
  );
}

export function BankSyncSection() {
  return (
    <>
      <BankSyncSettings />
      <RelatedSettings ids={["mail", "import"]} />
    </>
  );
}

export function MailSection() {
  return (
    <>
      <MailSettings />
      <RelatedSettings ids={["bank-sync", "ai-mail"]} />
    </>
  );
}

export function AiSection() {
  return (
    <>
      <AiSettings />
      <RelatedSettings ids={["mail", "notif-inapp"]} />
    </>
  );
}

/** Administration (#800): only an administrator has it. */
function useAdmin() {
  return !!useAuth().user?.isAdmin;
}

export function AdminSection() {
  const { t } = useTranslation();
  if (!useAdmin()) return <Navigate to="/settings/home" replace />;
  return (
    <>
      <SettingsGroup title={t("settings.adminAccess")}>
        <SettingRow id="people" />
        {!__DEMO__ && <OidcSettingsGroup />}
      </SettingsGroup>
      <SettingsGroup title={t("settings.adminServer")}>
        {/* Never in the demo (#582). */}
        {!__DEMO__ && <UpdateStatusCard />}
        <HotBackupRow />
      </SettingsGroup>
      <RelatedSettings ids={["backup", "api-tokens"]} />
    </>
  );
}

export function PeopleSection() {
  if (!useAdmin()) return <Navigate to="/settings/home" replace />;
  return (
    <>
      <UsersPage />
      <RelatedSettings ids={["sso", "database"]} />
    </>
  );
}
