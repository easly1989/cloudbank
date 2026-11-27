import {
  Anchor,
  Button,
  Chip,
  ColorSwatch,
  Group,
  SegmentedControl,
  Select,
  Switch,
  Text,
  useMantineColorScheme,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconCheck, IconExternalLink } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { listAccounts, saveMe } from "../../api/client";
import type { MeChange } from "../../api/preferences";
import { useAuth } from "../../auth/AuthProvider";
import { BetaBadge } from "../../components/LanguageSwitcher";
import { SIDEBAR_ACCOUNTS_MAX } from "../../components/sidebarAccounts";
import {
  ALL_BALANCES,
  pickBalances,
  type BalanceKey,
} from "../../components/dashboard/overviewFigureModel";
import { correctionUrl, languageOf, orderedLanguages } from "../../i18n/languages";
import { notifyError } from "../../notifyError";
import { useTour } from "../../onboarding/tourContext";
import { ACCENT_COLORS } from "../../theme";
import { useWallet } from "../../wallet/WalletProvider";
import { SettingRow, SettingState } from "./SettingRow";

// Your own preferences (#800), each row saving the moment it changes. A save
// goes through saveMe, which shows the change at once, queues the writes and
// merges each over the stored preferences, so two quick changes never undo
// each other and a failed one puts the stored value back.

// The three figures, in the order they are offered and shown.
const BALANCE_LABEL: Record<BalanceKey, string> = {
  bank: "register.bank",
  today: "overview.balanceToday",
  future: "register.future",
};

function usePreferences() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const save = (change: MeChange) => void saveMe(qc, change).catch(notifyError);
  return { user, prefs: user?.preferences ?? {}, save };
}

function useAccounts() {
  const { currentWallet } = useWallet();
  const walletId = currentWallet?.id ?? 0;
  const q = useQuery({
    queryKey: ["accounts", walletId],
    queryFn: () => listAccounts(walletId),
    enabled: walletId > 0,
  });
  return q.data ?? [];
}

const SELECT_W = 200;

/** Account › Preferences: language, dates, where you start, tours, amounts. */
export function AccountPreferenceRows() {
  const { t, i18n } = useTranslation();
  const { user, prefs, save } = usePreferences();
  const { resetAll } = useTour();
  const locale = user?.locale ?? "en";
  const lang = languageOf(locale);
  const tourOffers = prefs.tourOffers ?? true;

  return (
    <>
      <SettingRow
        id="language"
        description={
          <>
            {t("settings.row.languageHint")}
            {/* A beta translation asks to be corrected, in its own words (#595). */}
            {lang.beta && lang.correction && (
              <>
                {" "}
                <Anchor
                  href={correctionUrl(lang.code)}
                  target="_blank"
                  rel="noopener"
                  fz={12}
                  lang={lang.code}
                >
                  {lang.correction} <IconExternalLink size={11} />
                </Anchor>
              </>
            )}
          </>
        }
        control={
          <Select
            w={SELECT_W}
            aria-label={t("preferences.language")}
            data={orderedLanguages().map((l) => ({ value: l.code, label: l.name }))}
            renderOption={({ option }) => (
              <Group gap={6} wrap="nowrap">
                <span lang={option.value}>{option.label}</span>
                {languageOf(option.value).beta && <BetaBadge />}
              </Group>
            )}
            value={locale}
            onChange={(v) => {
              if (!v) return;
              void i18n.changeLanguage(v);
              save({ locale: v });
            }}
            allowDeselect={false}
          />
        }
      />
      <SettingRow
        id="date-format"
        control={
          <Select
            w={SELECT_W}
            aria-label={t("preferences.dateFormat")}
            data={[
              { value: "iso", label: "2026-01-31" },
              { value: "dmy", label: "31/01/2026" },
              { value: "mdy", label: "01/31/2026" },
              { value: "long", label: t("preferences.dateLong") },
            ]}
            value={prefs.dateFormat ?? "iso"}
            onChange={(v) => v && save({ preferences: { dateFormat: v } })}
            allowDeselect={false}
          />
        }
      />
      <SettingRow
        id="start-screen"
        control={
          <Select
            w={SELECT_W}
            aria-label={t("preferences.startScreen")}
            data={[
              { value: "dashboard", label: t("nav.dashboard") },
              { value: "accounts", label: t("nav.accounts") },
              { value: "transactions", label: t("nav.transactions") },
              { value: "budget", label: t("nav.budget") },
              { value: "reports", label: t("nav.reports") },
            ]}
            value={prefs.startScreen ?? "dashboard"}
            onChange={(v) => v && save({ preferences: { startScreen: v } })}
            allowDeselect={false}
          />
        }
      />
      <SettingRow
        id="tours"
        control={
          <Switch
            aria-label={t("preferences.tourOffers")}
            checked={tourOffers}
            onChange={(e) => save({ preferences: { tourOffers: e.currentTarget.checked } })}
          />
        }
      >
        {/* Forgetting which tours were offered is its own action: it is undone
            by nothing but opening the pages again. */}
        <Button
          variant="default"
          onClick={() => {
            resetAll();
            if (!tourOffers) save({ preferences: { tourOffers: true } });
            notifications.show({ color: "teal", message: t("preferences.toursReset") });
          }}
        >
          {t("preferences.resetTours")}
        </Button>
      </SettingRow>
      <SettingRow
        id="smart-amount"
        control={
          <Switch
            aria-label={t("preferences.smartAmount")}
            checked={prefs.smartAmountInput ?? true}
            onChange={(e) => save({ preferences: { smartAmountInput: e.currentTarget.checked } })}
          />
        }
      />
    </>
  );
}

/** Wallet › the account every new entry starts in: yours, on this wallet's list. */
export function DefaultAccountRow() {
  const { t } = useTranslation();
  const { prefs, save } = usePreferences();
  const accounts = useAccounts();
  return (
    <SettingRow
      id="default-account"
      control={
        <Select
          w={SELECT_W}
          aria-label={t("preferences.defaultAccount")}
          placeholder={t("preferences.noDefaultAccount")}
          data={accounts.map((a) => ({ value: String(a.id), label: a.name }))}
          value={prefs.defaultAccountId ? String(prefs.defaultAccountId) : null}
          onChange={(v) => save({ preferences: { defaultAccountId: v ? Number(v) : undefined } })}
          clearable
          searchable
        />
      }
    />
  );
}

/** Personalisation: the theme, the accent, and what the shell shows. */
export function AppearanceRows() {
  const { t } = useTranslation();
  const { user, prefs, save } = usePreferences();
  const { setColorScheme } = useMantineColorScheme();
  const accounts = useAccounts();
  const accent = prefs.themeAccent ?? "cloudbank";
  const sidebar = prefs.sidebarAccountIds ?? [];
  const balances = pickBalances(prefs.registerBalances);

  // Picking a fourth drops the oldest rather than refusing the click: the cap
  // is there to keep the strip a glance, not to scold anyone.
  const toggleSidebar = (id: number) =>
    save({
      preferences: {
        sidebarAccountIds: sidebar.includes(id)
          ? sidebar.filter((x) => x !== id)
          : [...sidebar, id].slice(-SIDEBAR_ACCOUNTS_MAX),
      },
    });
  // Turning the last one off would leave the overview and the register with no
  // figure at all, so the last one stays on.
  const toggleBalance = (key: BalanceKey) => {
    const next = balances.includes(key)
      ? balances.filter((k) => k !== key)
      : ALL_BALANCES.filter((k) => k === key || balances.includes(k));
    if (next.length > 0) save({ preferences: { registerBalances: next } });
  };

  return (
    <>
      <SettingRow
        id="theme"
        control={
          <SegmentedControl
            aria-label={t("preferences.theme")}
            value={user?.theme ?? "auto"}
            onChange={(v) => {
              setColorScheme(v as "auto" | "light" | "dark");
              save({ theme: v });
            }}
            data={[
              { label: t("preferences.themeAuto"), value: "auto" },
              { label: t("preferences.themeLight"), value: "light" },
              { label: t("preferences.themeDark"), value: "dark" },
            ]}
          />
        }
      />
      <SettingRow
        id="accent"
        control={
          <Group gap="xs" role="radiogroup" aria-label={t("preferences.accent")}>
            {ACCENT_COLORS.map((c) => (
              <ColorSwatch
                key={c}
                size={22}
                component="button"
                type="button"
                role="radio"
                aria-checked={accent === c}
                color={`var(--mantine-color-${c}-6)`}
                onClick={() => save({ preferences: { themeAccent: c } })}
                aria-label={c}
                style={{ color: "#fff", cursor: "pointer" }}
              >
                {accent === c && <IconCheck size={12} />}
              </ColorSwatch>
            ))}
          </Group>
        }
      />
      <SettingRow
        id="footer"
        control={
          <Switch
            aria-label={t("preferences.showFooter")}
            checked={prefs.showFooter ?? true}
            onChange={(e) => save({ preferences: { showFooter: e.currentTarget.checked } })}
          />
        }
      />
      <SettingRow
        id="sidebar-accounts"
        control={
          <SettingState tone={sidebar.length > 0 ? "ok" : "off"}>
            {sidebar.length} / {SIDEBAR_ACCOUNTS_MAX}
          </SettingState>
        }
      >
        <Group gap="xs">
          {accounts.map((a) => {
            const on = sidebar.includes(a.id);
            return (
              <Chip
                key={a.id}
                checked={on}
                onChange={() => toggleSidebar(a.id)}
                variant={on ? "filled" : "outline"}
              >
                {a.name}
              </Chip>
            );
          })}
          {accounts.length === 0 && (
            <Text fz="sm" c="dimmed">
              {t("preferences.noDefaultAccount")}
            </Text>
          )}
        </Group>
      </SettingRow>
      <SettingRow
        id="balances"
        control={
          <SettingState>
            {balances.length} / {ALL_BALANCES.length}
          </SettingState>
        }
      >
        <Group gap="xs">
          {ALL_BALANCES.map((key) => {
            const on = balances.includes(key);
            return (
              <Chip
                key={key}
                checked={on}
                onChange={() => toggleBalance(key)}
                variant={on ? "filled" : "outline"}
              >
                {t(BALANCE_LABEL[key])}
              </Chip>
            );
          })}
        </Group>
      </SettingRow>
    </>
  );
}
