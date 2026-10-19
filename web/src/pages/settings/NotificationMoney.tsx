import {
  Anchor,
  Box,
  Card,
  Checkbox,
  Divider,
  Group,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
  UnstyledButton,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { IconChevronLeft, IconChevronRight, IconCoins } from "@tabler/icons-react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import {
  getNotificationSettings,
  getWalletNotifications,
  listAccounts,
  setNotificationSettings,
  setNotificationThreshold,
  setWalletNotificationsIncluded,
  type Account,
  type NotificationThreshold,
  type Wallet,
} from "../../api/client";
import { formatMinor, minorToInput, parseMinor } from "../../money";
import { notifyError } from "../../notifyError";
import { useWallet } from "../../wallet/WalletProvider";
import { accountFormat } from "../accounts/accountList";
import classes from "./NotificationsPages.module.css";
import { SettingsGroup } from "./SettingsLayout";

// Settings › Notifications › Thresholds and wallets (#691): when and from
// where the money events reach the reader. Everything here is the reader's
// own; the other members of a wallet choose for themselves.

const SETTINGS_KEY = ["notification-settings"] as const;
const walletKey = (id: number) => ["wallet-notifications", id] as const;

function useWalletSettings(wallets: Wallet[]) {
  return useQueries({
    queries: wallets.map((w) => ({
      queryKey: walletKey(w.id),
      queryFn: () => getWalletNotifications(w.id),
    })),
  });
}

/** The overview's row: how the thresholds and wallets stand, one click away. */
export function MoneyRow() {
  const { t } = useTranslation();
  const { wallets } = useWallet();
  const settings = useWalletSettings(wallets);
  const accounts = settings.reduce((n, s) => n + (s.data?.thresholds.length ?? 0), 0);
  const off = settings.filter((s) => s.data && !s.data.included).length;
  const status = [
    accounts > 0
      ? t("notif.money.summaryThresholds", { count: accounts })
      : t("notif.money.summaryNone"),
    off > 0 ? t("notif.money.summaryOff", { count: off }) : t("notif.money.summaryAll"),
  ].join(", ");
  return (
    <Card withBorder p={0}>
      <UnstyledButton component={Link} to="/settings/notifications/money" className={classes.row}>
        <Box className={classes.icon}>
          <IconCoins size={16} />
        </Box>
        <Box style={{ flex: 1, minWidth: 0 }}>
          <Text fz={14} fw={500}>
            {t("notif.money.title")}
          </Text>
          <Text fz={13} c="dimmed" truncate>
            {status}
          </Text>
        </Box>
        <IconChevronRight size={16} className={classes.chevron} />
      </UnstyledButton>
    </Card>
  );
}

type Field = "largeOver" | "lowUnder";

/** One threshold, saved when the field is left. */
function AmountField({
  walletId,
  account,
  field,
  saved,
  placeholder,
  label,
}: {
  walletId: number;
  account: Account;
  field: Field;
  saved: NotificationThreshold;
  placeholder: string;
  label: string;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const frac = account.currencyFracDigits;
  const dec = account.currencyDecimalChar;
  const shown = (v: number | null) => (v == null ? "" : minorToInput(v, frac, dec));
  const [value, setValue] = useState(() => shown(saved[field]));
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (v: number | null) => setNotificationThreshold(walletId, { ...saved, [field]: v }),
    onSuccess: () => notifications.show({ color: "green", message: t("notif.saved") }),
    onError: notifyError,
    onSettled: () => qc.invalidateQueries({ queryKey: walletKey(walletId) }),
  });
  const commit = () => {
    let v = value.trim() === "" ? null : parseMinor(value, frac, dec);
    if (value.trim() !== "" && v == null) {
      setError(t("notif.money.notAmount"));
      return;
    }
    // An expense over a threshold is a size: the sign typed does not matter.
    if (field === "largeOver" && v != null) v = Math.abs(v);
    if (field === "largeOver" && v === 0) {
      setError(t("notif.money.aboveZero"));
      return;
    }
    setError(null);
    setValue(shown(v));
    if (v !== saved[field]) save.mutate(v);
  };
  const sym = (
    <Text fz={13} c="dimmed">
      {account.currencySymbol}
    </Text>
  );
  return (
    <TextInput
      aria-label={`${label}, ${account.name}`}
      value={value}
      onChange={(e) => setValue(e.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && commit()}
      placeholder={placeholder}
      inputMode="decimal"
      error={error}
      leftSection={account.currencySymbolPrefix ? sym : undefined}
      rightSection={account.currencySymbolPrefix ? undefined : sym}
      classNames={{ input: classes.amountInput }}
    />
  );
}

function WalletThresholds({ wallet }: { wallet: Wallet }) {
  const { t } = useTranslation();
  const phone = useMediaQuery("(max-width: 47.99em)") ?? false;
  const accounts = useQuery({
    queryKey: ["accounts", wallet.id],
    queryFn: () => listAccounts(wallet.id),
  });
  const settings = useQuery({
    queryKey: walletKey(wallet.id),
    queryFn: () => getWalletNotifications(wallet.id),
  });
  if (!accounts.data || !settings.data) return null;
  const open = accounts.data.filter((a) => !a.closed);
  const byAccount = new Map(settings.data.thresholds.map((th) => [th.accountId, th]));
  return (
    <Card withBorder p={0}>
      <Text fz={13} fw={600} px="md" pt="sm" pb={phone || open.length === 0 ? 4 : 0}>
        {wallet.title}
      </Text>
      {open.length === 0 && (
        <Text fz={13} c="dimmed" px="md" pb="sm">
          {t("notif.money.noAccounts")}
        </Text>
      )}
      {!phone && open.length > 0 && (
        <div className={`${classes.thresholdGrid} ${classes.thresholdHead}`}>
          <Text fz={12} c="dimmed">
            {t("notif.money.colAccount")}
          </Text>
          <Text fz={12} c="dimmed" ta="right">
            {t("notif.money.colBalance")}
          </Text>
          <Text fz={12} c="dimmed">
            {t("notif.money.colLarge")}
          </Text>
          <Text fz={12} c="dimmed">
            {t("notif.money.colLow")}
          </Text>
        </div>
      )}
      {open.map((a, i) => {
        const fmt = accountFormat(a);
        const saved = byAccount.get(a.id) ?? { accountId: a.id, largeOver: null, lowUnder: null };
        // The account's own minimum balance, as a suggestion only.
        const low = a.minimumBalance
          ? t("notif.money.minHint", {
              amount: formatMinor(a.minimumBalance, { ...fmt, symbol: "" }).trim(),
            })
          : t("notif.money.none");
        const large = (
          <AmountField
            walletId={wallet.id}
            account={a}
            field="largeOver"
            saved={saved}
            placeholder={t("notif.money.none")}
            label={t("notif.money.colLarge")}
          />
        );
        const lowField = (
          <AmountField
            walletId={wallet.id}
            account={a}
            field="lowUnder"
            saved={saved}
            placeholder={low}
            label={t("notif.money.colLow")}
          />
        );
        const balance = formatMinor(a.balance, fmt);
        return (
          <Fragment key={a.id}>
            {(i > 0 || phone) && <Divider />}
            {phone ? (
              <Box px="md" py="sm">
                <Group justify="space-between" mb={6} wrap="nowrap">
                  <Text fz={14} fw={500} truncate>
                    {a.name}
                  </Text>
                  <Text fz={13} ff="monospace" c="dimmed">
                    {balance}
                  </Text>
                </Group>
                <Group grow gap="sm" align="flex-start">
                  <Stack gap={2}>
                    <Text fz={12} c="dimmed">
                      {t("notif.money.colLarge")}
                    </Text>
                    {large}
                  </Stack>
                  <Stack gap={2}>
                    <Text fz={12} c="dimmed">
                      {t("notif.money.colLow")}
                    </Text>
                    {lowField}
                  </Stack>
                </Group>
              </Box>
            ) : (
              <div className={classes.thresholdGrid}>
                <Text fz={14} fw={500} truncate>
                  {a.name}
                </Text>
                <Text fz={14} ff="monospace" ta="right">
                  {balance}
                </Text>
                {large}
                {lowField}
              </div>
            )}
          </Fragment>
        );
      })}
    </Card>
  );
}

function Wallets() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { wallets } = useWallet();
  const settings = useWalletSettings(wallets);
  const accounts = useQueries({
    queries: wallets.map((w) => ({
      queryKey: ["accounts", w.id],
      queryFn: () => listAccounts(w.id),
    })),
  });
  const save = useMutation({
    mutationFn: (v: { walletId: number; included: boolean }) =>
      setWalletNotificationsIncluded(v.walletId, v.included),
    onSuccess: (data, v) => qc.setQueryData(walletKey(v.walletId), data),
    onError: notifyError,
  });
  return (
    <SettingsGroup title={t("notif.money.wallets")} hint={t("notif.money.walletsHint")}>
      <Card withBorder p={0}>
        {wallets.map((w, i) => (
          <Fragment key={w.id}>
            {i > 0 && <Divider />}
            <Checkbox
              px="md"
              py="sm"
              checked={settings[i]?.data?.included ?? true}
              disabled={!settings[i]?.data}
              onChange={(e) => save.mutate({ walletId: w.id, included: e.currentTarget.checked })}
              label={w.title}
              description={t("notif.money.accountCount", {
                count: (accounts[i]?.data ?? []).filter((a) => !a.closed).length,
              })}
            />
          </Fragment>
        ))}
      </Card>
    </SettingsGroup>
  );
}

function Amounts() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: SETTINGS_KEY, queryFn: getNotificationSettings });
  const save = useMutation({
    mutationFn: setNotificationSettings,
    onSuccess: (s) => qc.setQueryData(SETTINGS_KEY, s),
    onError: notifyError,
  });
  const on = data?.amountsOutside ?? true;
  return (
    <SettingsGroup title={t("notif.money.amounts")} hint={t("notif.money.amountsHint")}>
      <Card withBorder p="md">
        <Switch
          checked={on}
          disabled={!data}
          onChange={(e) => save.mutate({ amountsOutside: e.currentTarget.checked })}
          label={t("notif.money.amountsOutside")}
          description={on ? t("notif.money.amountsOn") : t("notif.money.amountsOff")}
        />
      </Card>
    </SettingsGroup>
  );
}

/** The page of its own, under Settings › Notifications. */
export function NotificationMoneySection() {
  const { t } = useTranslation();
  const { wallets } = useWallet();
  return (
    <Stack gap="xl">
      <div>
        <Anchor component={Link} to="/settings/notifications" size="sm">
          <Group gap={4} component="span">
            <IconChevronLeft size={14} />
            {t("notif.title")}
          </Group>
        </Anchor>
        <Group gap="xs" mt="xs" wrap="nowrap">
          <IconCoins size={20} />
          <Title order={3} fz={20}>
            {t("notif.money.title")}
          </Title>
        </Group>
        <Text fz={13} c="dimmed" mt={2}>
          {t("notif.money.subtitle")}
        </Text>
      </div>
      <SettingsGroup title={t("notif.money.thresholds")} hint={t("notif.money.thresholdsHint")}>
        {wallets.map((w) => (
          <WalletThresholds key={w.id} wallet={w} />
        ))}
        <Text fz={13} c="dimmed">
          {t("notif.money.offNote")}
        </Text>
      </SettingsGroup>
      <Wallets />
      <Amounts />
    </Stack>
  );
}
