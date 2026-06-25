import {
  Button,
  Card,
  ColorSwatch,
  Group,
  Input,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  useMantineColorScheme,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconCheck } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { ApiError, listAccounts, updateMe, type User } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { supportedLanguages } from "../i18n";
import { useTour } from "../onboarding/tourContext";
import { ACCENT_COLORS } from "../theme";
import { useWallet } from "../wallet/WalletProvider";

const langLabels: Record<string, string> = { en: "English", it: "Italiano" };

export function PreferencesPage() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const { user } = useAuth();
  const { setColorScheme } = useMantineColorScheme();
  const { currentWallet } = useWallet();
  const tour = useTour();
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
  const [accent, setAccent] = useState(prefs.themeAccent ?? "teal");

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

  return (
    <Stack>
      <Card withBorder>
        <Stack>
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
            <Select
              label={t("preferences.language")}
              data={supportedLanguages.map((l) => ({ value: l, label: langLabels[l] ?? l }))}
              value={locale}
              onChange={(v) => v && setLocale(v)}
              allowDeselect={false}
            />
            <div>
              <Group gap="xs" mb={4}>
                {t("preferences.theme")}
              </Group>
              <SegmentedControl
                value={theme}
                onChange={setTheme}
                data={[
                  { label: t("preferences.themeAuto"), value: "auto" },
                  { label: t("preferences.themeLight"), value: "light" },
                  { label: t("preferences.themeDark"), value: "dark" },
                ]}
              />
            </div>
            <Input.Wrapper label={t("preferences.accent")}>
              <Group gap="xs" mt={4}>
                {ACCENT_COLORS.map((c) => (
                  <ColorSwatch
                    key={c}
                    component="button"
                    type="button"
                    color={`var(--mantine-color-${c}-6)`}
                    onClick={() => setAccent(c)}
                    aria-label={c}
                    style={{ color: "#fff", cursor: "pointer" }}
                  >
                    {accent === c && <IconCheck size={14} />}
                  </ColorSwatch>
                ))}
              </Group>
            </Input.Wrapper>
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
            <Select
              label={t("preferences.defaultAccount")}
              placeholder={t("preferences.noDefaultAccount")}
              data={accounts.map((a) => ({ value: String(a.id), label: a.name }))}
              value={defaultAccount}
              onChange={setDefaultAccount}
              clearable
              searchable
            />
            <Switch
              label={t("preferences.smartAmount")}
              description={t("preferences.smartAmountHint")}
              checked={smartAmount}
              onChange={(e) => setSmartAmount(e.currentTarget.checked)}
            />
          </SimpleGrid>
          <Group justify="space-between">
            <Button variant="default" onClick={() => tour.start()}>
              {t("preferences.restartTour")}
            </Button>
            <Button onClick={() => save.mutate()} loading={save.isPending}>
              {t("preferences.save")}
            </Button>
          </Group>
        </Stack>
      </Card>
    </Stack>
  );
}
