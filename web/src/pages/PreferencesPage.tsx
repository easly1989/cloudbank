import {
  Button,
  Card,
  Chip,
  ColorSwatch,
  Group,
  Input,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  useMantineColorScheme,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconCheck } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { ApiError, listAccounts, updateMe, type User } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { supportedLanguages } from "../i18n";
import { SIDEBAR_ACCOUNTS_MAX } from "../components/sidebarAccounts";
import {
  ALL_BALANCES,
  pickBalances,
  type BalanceKey,
} from "../components/dashboard/overviewFigureModel";

// The three figures, in the order they are offered and shown.
const BALANCE_LABEL: Record<BalanceKey, string> = {
  bank: "register.bank",
  today: "overview.balanceToday",
  future: "register.future",
};
import { ACCENT_COLORS } from "../theme";
import { useWallet } from "../wallet/WalletProvider";

const langLabels: Record<string, string> = { en: "English", it: "Italiano" };

/**
 * Your own preferences, rendered one settings section at a time.
 *
 * The state and the save live here rather than in each section because the API
 * takes the whole preferences blob in one call: splitting them would mean three
 * requests where the reader made one change, and three chances to lose an edit
 * they made in a section they did not press Save in.
 */
export function PreferencesPage({ section = "general" }: { section?: "general" | "appearance" }) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const { user } = useAuth();
  const { setColorScheme } = useMantineColorScheme();
  const { currentWallet } = useWallet();
  const walletId = currentWallet?.id ?? 0;

  const accountsQuery = useQuery({
    queryKey: ["accounts", walletId],
    queryFn: () => listAccounts(walletId),
    enabled: walletId > 0,
  });
  const accounts = accountsQuery.data ?? [];

  const prefs = user?.preferences ?? {};
  const [locale, setLocale] = useState(user?.locale ?? "en");
  const [theme, setTheme] = useState(user?.theme ?? "auto");
  const [dateFormat, setDateFormat] = useState(prefs.dateFormat ?? "iso");
  const [startScreen, setStartScreen] = useState(prefs.startScreen ?? "dashboard");
  const [defaultAccount, setDefaultAccount] = useState<string | null>(
    prefs.defaultAccountId ? String(prefs.defaultAccountId) : null,
  );
  const [smartAmount, setSmartAmount] = useState(prefs.smartAmountInput ?? true);
  const [accent, setAccent] = useState(prefs.themeAccent ?? "cloudbank");
  const [sidebarAccountIds, setSidebarAccountIds] = useState<number[]>(
    prefs.sidebarAccountIds ?? [],
  );
  const [balances, setBalances] = useState<BalanceKey[]>(() =>
    pickBalances(prefs.registerBalances),
  );

  // Turning the last one off would leave the overview and the register with no
  // figure at all, so the last one stays on.
  const toggleBalance = (key: BalanceKey) =>
    setBalances((prev) =>
      prev.includes(key)
        ? prev.length > 1
          ? prev.filter((k) => k !== key)
          : prev
        : ALL_BALANCES.filter((k) => k === key || prev.includes(k)),
    );

  // Picking a fourth drops the oldest rather than refusing the click: the cap
  // is there to keep the strip a glance, not to scold anyone.
  const toggleSidebarAccount = (id: number) =>
    setSidebarAccountIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id].slice(-SIDEBAR_ACCOUNTS_MAX),
    );

  const save = useMutation({
    mutationFn: () =>
      updateMe({
        locale,
        theme,
        // Spread the existing blob so keys this page doesn't manage (e.g.
        // registerColumns, dashboard layout) are preserved.
        preferences: {
          ...prefs,
          dateFormat,
          startScreen,
          defaultAccountId: defaultAccount ? Number(defaultAccount) : undefined,
          smartAmountInput: smartAmount,
          themeAccent: accent,
          sidebarAccountIds,
          registerBalances: balances,
        },
      }),
    onSuccess: (updated: User) => {
      qc.setQueryData(["me"], updated);
      void i18n.changeLanguage(updated.locale);
      setColorScheme((updated.theme as "auto" | "light" | "dark") ?? "auto");
      notifications.show({ color: "teal", message: t("preferences.saved") });
    },
    onError: (err: unknown) =>
      notifications.show({
        color: "red",
        message: err instanceof ApiError ? err.message : String(err),
      }),
  });

  const general = section === "general";
  const appearance = section === "appearance";

  return (
    <Stack>
      <Card withBorder>
        <Stack>
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
            {general && (
              <Select
                label={t("preferences.language")}
                data={supportedLanguages.map((l) => ({ value: l, label: langLabels[l] ?? l }))}
                value={locale}
                onChange={(v) => v && setLocale(v)}
                allowDeselect={false}
              />
            )}
            {appearance && (
              <div>
                <Group gap="xs" mb={4}>
                  {t("preferences.theme")}
                </Group>
                <SegmentedControl
                  className="cb-choice"
                  value={theme}
                  onChange={setTheme}
                  data={[
                    { label: t("preferences.themeAuto"), value: "auto" },
                    { label: t("preferences.themeLight"), value: "light" },
                    { label: t("preferences.themeDark"), value: "dark" },
                  ]}
                />
              </div>
            )}
            {appearance && (
              <Input.Wrapper label={t("preferences.accent")}>
                <Group gap="xs" mt={4}>
                  {ACCENT_COLORS.map((c) => (
                    <ColorSwatch
                      key={c}
                      size={22}
                      component="button"
                      type="button"
                      color={`var(--mantine-color-${c}-6)`}
                      onClick={() => setAccent(c)}
                      aria-label={c}
                      style={{ color: "#fff", cursor: "pointer" }}
                    >
                      {accent === c && <IconCheck size={12} />}
                    </ColorSwatch>
                  ))}
                </Group>
              </Input.Wrapper>
            )}
            {general && (
              <Select
                label={t("preferences.dateFormat")}
                data={[
                  { value: "iso", label: "2026-01-31" },
                  { value: "dmy", label: "31/01/2026" },
                  { value: "mdy", label: "01/31/2026" },
                  { value: "long", label: t("preferences.dateLong") },
                ]}
                value={dateFormat}
                onChange={(v) => v && setDateFormat(v)}
                allowDeselect={false}
              />
            )}
            {general && (
              <Select
                label={t("preferences.startScreen")}
                data={[
                  { value: "dashboard", label: t("nav.dashboard") },
                  { value: "accounts", label: t("nav.accounts") },
                  { value: "transactions", label: t("nav.transactions") },
                  { value: "budget", label: t("nav.budget") },
                  { value: "reports", label: t("nav.reports") },
                ]}
                value={startScreen}
                onChange={(v) => v && setStartScreen(v)}
                allowDeselect={false}
              />
            )}
            {general && (
              <Select
                label={t("preferences.defaultAccount")}
                placeholder={t("preferences.noDefaultAccount")}
                data={accounts.map((a) => ({ value: String(a.id), label: a.name }))}
                value={defaultAccount}
                onChange={setDefaultAccount}
                clearable
                searchable
              />
            )}
            {general && (
              <Switch
                label={t("preferences.smartAmount")}
                description={t("preferences.smartAmountHint")}
                checked={smartAmount}
                onChange={(e) => setSmartAmount(e.currentTarget.checked)}
              />
            )}
          </SimpleGrid>

          {appearance && (
            <Input.Wrapper
              label={t("preferences.sidebarAccounts")}
              description={t("preferences.sidebarAccountsHint", { max: SIDEBAR_ACCOUNTS_MAX })}
            >
              <Group gap="xs" mt={6}>
                {accounts.map((a) => {
                  const on = sidebarAccountIds.includes(a.id);
                  return (
                    <Chip
                      key={a.id}
                      checked={on}
                      onChange={() => toggleSidebarAccount(a.id)}
                      variant={on ? "filled" : "outline"}
                    >
                      {a.name}
                    </Chip>
                  );
                })}
                {accounts.length > 0 && (
                  <Text size="xs" c="dimmed">
                    {sidebarAccountIds.length} / {SIDEBAR_ACCOUNTS_MAX}
                  </Text>
                )}
              </Group>
            </Input.Wrapper>
          )}

          {appearance && (
            <Input.Wrapper
              label={t("preferences.balances")}
              description={t("preferences.balancesHint")}
            >
              <Group gap="xs" mt={6}>
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
            </Input.Wrapper>
          )}

          <Group justify="space-between">
            {general ? (
              <Button component={Link} to="/?tour=1" variant="default">
                {t("preferences.restartTour")}
              </Button>
            ) : (
              <span />
            )}
            <Button onClick={() => save.mutate()} loading={save.isPending}>
              {t("preferences.save")}
            </Button>
          </Group>
        </Stack>
      </Card>
    </Stack>
  );
}
