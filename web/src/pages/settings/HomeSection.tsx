import { Anchor, Button, Text } from "@mantine/core";
import {
  IconBook,
  IconBrandGithub,
  IconChevronRight,
  IconCoffee,
  IconDownload,
  IconHome,
  IconLicense,
  IconMail,
  IconShieldLock,
  IconApi,
  type Icon,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import {
  API_DOCS_URL,
  DONATE_URL,
  GUIDE_URL,
  HOMEBANK_URL,
  SOURCE_URL,
  useVersion,
} from "../../aboutLinks";
import { checkIntegrity, downloadWalletBackup, listPasskeys } from "../../api/client";
import { useAuth, useAuthConfig } from "../../auth/AuthProvider";
import { sinceNow } from "../../bankSyncNotice";
import { useUpdateStatus } from "../../components/updates/updateModel";
import { notifyError } from "../../notifyError";
import { useWallet } from "../../wallet/WalletProvider";
import { backupAgeDays, backupAgeText, backupStale, recordBackup } from "./backupAge";
import { SettingRow, SettingsGroup, SettingState } from "./SettingRow";
import { useBankConnections, useMailStatus } from "./statusHooks";
import classes from "./Settings.module.css";

/** A status tile: a title, a few lines of label and value, and where to go. */
function Tile({
  title,
  lines,
  to,
  action,
  testId,
}: {
  title: ReactNode;
  lines: [string, ReactNode][];
  to: string;
  action: string;
  testId?: string;
}) {
  return (
    <div className={classes.tile}>
      <h2 className={classes.tileTitle} data-testid={testId}>
        {title}
      </h2>
      {lines.map(([k, v]) => (
        <div key={k} className={classes.line}>
          <Text span fz={14} c="dimmed">
            {k}
          </Text>
          <Text span fz={14} ta="end">
            {v}
          </Text>
        </div>
      ))}
      <Anchor component={Link} to={to} fz={14} className={classes.tileAction}>
        {action}
        <IconChevronRight size={14} aria-hidden />
      </Anchor>
    </div>
  );
}

/**
 * Settings › Home (#800): how security, the connections and the data stand,
 * what is worth doing now, and what this installation is. The last part was
 * About (#513), and stays for everyone: the AGPL wants the source in reach of
 * whoever uses the app, footer or no footer.
 */
export function HomeSection() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const { user } = useAuth();
  const config = useAuthConfig().data;
  const { currentWallet } = useWallet();
  const walletId = currentWallet?.id ?? 0;
  const version = useVersion();
  const ssoOnly = config?.passwordLogin === false;
  const showPasskeys = !__DEMO__ && !!config?.passkeys;
  const passkeys = useQuery({
    queryKey: ["passkeys"],
    queryFn: listPasskeys,
    enabled: showPasskeys,
  });
  const banks = useBankConnections();
  const mail = useMailStatus();
  const integrity = useQuery({
    queryKey: ["integrity", walletId],
    queryFn: () => checkIntegrity(walletId),
    enabled: walletId > 0,
    staleTime: 5 * 60_000,
  });
  const updates = useUpdateStatus();
  const days = backupAgeDays(user, walletId);

  const backup = useMutation({
    mutationFn: () => downloadWalletBackup(walletId),
    onSuccess: () => void recordBackup(qc, walletId),
    onError: notifyError,
  });

  const twoFactor = user?.twoFactorEnabled ?? false;
  const issues = integrity.data?.issues.length ?? 0;
  const st = updates.data;

  const security: [string, ReactNode][] = [];
  if (!ssoOnly) {
    security.push([
      t("twofa.title"),
      <SettingState key="2fa" tone={twoFactor ? "ok" : "warn"}>
        {twoFactor ? t("twofa.on") : t("twofa.off")}
      </SettingState>,
    ]);
  }
  if (showPasskeys && passkeys.data) {
    const n = passkeys.data.length;
    security.push([
      t("passkeys.title"),
      <SettingState key="pk" tone={n > 0 ? "ok" : "off"}>
        {n}
      </SettingState>,
    ]);
  }

  const links: [string, string, Icon, string][] = [
    [t("app.guide"), t("about.guideHint"), IconBook, GUIDE_URL],
    [t("about.source"), "github.com/easly1989/cloudbank", IconBrandGithub, SOURCE_URL],
    [t("app.apiDocs"), t("about.apiDocsHint"), IconApi, API_DOCS_URL],
    [t("about.support"), t("about.supportHint"), IconCoffee, DONATE_URL],
    ["HomeBank", t("about.homebankHint"), IconHome, HOMEBANK_URL],
  ];

  const stale = backupStale(days);
  const showTwoFactor = !__DEMO__ && !ssoOnly && !twoFactor;

  return (
    <>
      <div className={classes.tiles}>
        {!__DEMO__ && security.length > 0 && (
          <Tile
            title={t("settings.home.security")}
            lines={security}
            to="/settings/account#password"
            action={t("settings.sections.account")}
          />
        )}
        <Tile
          title={t("settings.sections.connections")}
          lines={[
            [
              t("settings.home.banks"),
              <SettingState key="b" tone={banks.count > 0 ? "ok" : "off"}>
                {t("settings.home.banksLinked", { count: banks.count })}
              </SettingState>,
            ],
            [t("settings.home.lastSync"), banks.last ? sinceNow(banks.last, i18n.language) : "—"],
            ...(mail.available
              ? ([
                  [
                    t("mail.title"),
                    <SettingState key="m" tone={mail.review > 0 ? "warn" : "ok"}>
                      {mail.review > 0
                        ? t("settings.home.toReview", { count: mail.review })
                        : t("settings.home.mailboxes", { count: mail.mailboxes })}
                    </SettingState>,
                  ],
                ] as [string, ReactNode][])
              : []),
          ]}
          to="/settings/connections"
          action={t("settings.sections.connections")}
        />
        <Tile
          title={t("settings.home.data")}
          lines={[
            [
              t("settings.home.lastBackup"),
              <SettingState key="b" tone={stale ? "warn" : "ok"}>
                {backupAgeText(t, days)}
              </SettingState>,
            ],
            [
              t("integrity.title"),
              integrity.data ? (
                <SettingState key="i" tone={issues > 0 ? "warn" : "ok"}>
                  {issues > 0
                    ? t("settings.home.issues", { count: issues })
                    : t("settings.home.ok")}
                </SettingState>
              ) : (
                "…"
              ),
            ],
          ]}
          to="/settings/wallet"
          action={t("settings.wallet")}
        />
        <Tile
          title={t("settings.about")}
          testId="about-version"
          lines={[
            [t("app.name"), version ?? "…"],
            ...(st && !__DEMO__
              ? ([
                  [
                    t("settings.row.updates"),
                    <SettingState
                      key="u"
                      tone={
                        st.available
                          ? "warn"
                          : st.error
                            ? "error"
                            : st.enabled && st.allowed && st.channel !== ""
                              ? "ok"
                              : "off"
                      }
                    >
                      {st.available
                        ? t("settings.home.updateOut")
                        : st.error
                          ? t("updates.noAnswer")
                          : st.enabled && st.allowed && st.channel !== ""
                            ? t("settings.home.upToDate")
                            : t("settings.home.notChecked")}
                    </SettingState>,
                  ],
                ] as [string, ReactNode][])
              : []),
            [t("settings.home.licence"), "AGPL-3.0"],
          ]}
          to={st && !__DEMO__ ? "/settings/admin#updates" : "/settings/home#about"}
          action={st && !__DEMO__ ? t("settings.sections.admin") : t("settings.about")}
        />
      </div>

      <SettingsGroup title={t("settings.home.recommended")}>
        {stale && (
          <SettingRow
            icon={IconDownload}
            title={t("settings.home.backupTitle")}
            description={
              days === null
                ? t("settings.home.backupNever")
                : t("settings.home.backupOld", { count: days })
            }
            control={
              <Button variant="default" loading={backup.isPending} onClick={() => backup.mutate()}>
                {t("backup.download")}
              </Button>
            }
          />
        )}
        {mail.available && mail.review > 0 && (
          <SettingRow
            icon={IconMail}
            title={t("settings.home.mailTitle", { count: mail.review })}
            description={t("settings.home.mailHint")}
            control={
              <Button component={Link} to="/settings/connections/mail" variant="default">
                {t("settings.open")}
              </Button>
            }
          />
        )}
        {showTwoFactor && (
          <SettingRow
            icon={IconShieldLock}
            title={t("settings.home.twoFactorTitle")}
            description={t("twofa.hint")}
            control={
              <Button component={Link} to="/settings/account#two-factor" variant="default">
                {t("settings.open")}
              </Button>
            }
          />
        )}
        {!stale && !(mail.available && mail.review > 0) && !showTwoFactor && (
          <Text fz={14} c="dimmed">
            {t("settings.home.nothing")}
          </Text>
        )}
      </SettingsGroup>

      <div id="about">
        <SettingsGroup title={t("settings.about")}>
          <SettingRow
            icon={IconLicense}
            title={t("settings.home.licence")}
            description={<Trans i18nKey="about.licence" components={{ b: <b /> }} />}
          />
          {links.map(([title, hint, icon, href]) => (
            <SettingRow key={href} icon={icon} title={title} description={hint} href={href} />
          ))}
        </SettingsGroup>
      </div>
    </>
  );
}
