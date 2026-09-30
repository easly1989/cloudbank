import { Alert, Button, Group, Stack } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { IconAlertTriangle, IconRefresh } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  ApiError,
  deleteCurrency,
  getCurrencyCatalog,
  listAccounts,
  listCurrencies,
  refreshRates,
  setBaseCurrency,
  type Currency,
} from "../api/client";
import { useConfirm } from "../components/confirmContext";
import { PageHeader } from "../components/PageHeader";
import { useToday } from "../useToday";
import { useWallet } from "../wallet/WalletProvider";
import { useDayMonth } from "./categories/labels";
import classes from "./currencies/currencies.module.css";
import { buildRows, latestEcbDate } from "./currencies/currencyList";
import { CurrencySheet } from "./currencies/CurrencySheet";
import { CurrencyPhoneList, CurrencyTable } from "./currencies/CurrencyTable";

/**
 * Currencies (#558): every currency the wallet can use, the base first, with
 * its rate against the base, where that rate came from, and the accounts kept
 * in it. A currency opens in the sheet beside the page.
 */
export function CurrenciesPage() {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const { currentWallet } = useWallet();
  const walletId = currentWallet?.id ?? 0;
  const phone = useMediaQuery("(max-width: 47.99em)") ?? false;
  const day = useDayMonth(useToday());
  const [providerError, setProviderError] = useState<string | null>(null);

  const currenciesQuery = useQuery({
    queryKey: ["currencies", walletId],
    queryFn: () => listCurrencies(walletId),
    enabled: walletId > 0,
  });
  const accountsQuery = useQuery({
    queryKey: ["accounts", walletId],
    queryFn: () => listAccounts(walletId),
    enabled: walletId > 0,
  });
  const catalogQuery = useQuery({ queryKey: ["currency-catalog"], queryFn: getCurrencyCatalog });

  const currencies = useMemo(() => currenciesQuery.data ?? [], [currenciesQuery.data]);
  const rows = useMemo(
    () => buildRows(currencies, accountsQuery.data ?? []),
    [currencies, accountsQuery.data],
  );
  const base = currencies.find((c) => c.isBase);
  const ecbDate = latestEcbDate(rows);
  const catalog = useMemo(() => {
    const have = new Set(currencies.map((c) => c.isoCode));
    return (catalogQuery.data ?? [])
      .filter((c) => !have.has(c.code))
      .map((c) => ({ value: c.code, label: `${c.code} — ${c.name}` }));
  }, [catalogQuery.data, currencies]);

  // Amounts everywhere are converted at these rates.
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["currencies", walletId] });
    void qc.invalidateQueries({ queryKey: ["wallets"] });
    void qc.invalidateQueries({ queryKey: ["dashboard", walletId] });
  };
  const onError = (err: unknown) =>
    notifications.show({
      color: "red",
      message: err instanceof ApiError ? err.message : String(err),
    });

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<Currency | null>(null);

  const refresh = useMutation({
    mutationFn: () => refreshRates(walletId),
    onSuccess: (res) => {
      setProviderError(res.providerError ?? null);
      if (!res.providerError)
        notifications.show({
          color: "teal",
          message: t("currencies.refreshed", { count: res.updated.length }),
        });
      invalidate();
    },
    onError,
  });
  const makeBase = useMutation({
    mutationFn: (id: number) => setBaseCurrency(walletId, id),
    onSuccess: invalidate,
    onError,
  });
  const remove = useMutation({
    mutationFn: (id: number) => deleteCurrency(walletId, id),
    onSuccess: invalidate,
    onError,
  });

  const actions = {
    onOpen: (c: Currency) => {
      setEditing(c);
      setSheetOpen(true);
    },
    onMakeBase: (c: Currency) => void askBase(c),
    onDelete: (c: Currency) => void askDelete(c),
  };
  const askBase = async (c: Currency) => {
    setSheetOpen(false);
    const ok = await confirm({
      title: t("currencies.confirmBaseTitle", { name: c.name }),
      body: t("currencies.confirmBaseBody", { name: c.name }),
      confirmLabel: t("currencies.makeBase"),
    });
    if (ok) makeBase.mutate(c.id);
  };
  const askDelete = async (c: Currency) => {
    setSheetOpen(false);
    const ok = await confirm({
      title: t("currencies.confirmDeleteTitle", { name: c.name }),
      body: t("currencies.confirmDeleteBody"),
      confirmLabel: t("currencies.delete"),
      danger: true,
    });
    if (ok) remove.mutate(c.id);
  };

  if (!currentWallet) return null;

  const header = (
    <Group gap="sm" wrap="nowrap">
      <Button
        variant="default"
        leftSection={<IconRefresh size={16} />}
        onClick={() => refresh.mutate()}
        loading={refresh.isPending}
        disabled={currencies.length < 2}
      >
        {phone ? t("currencies.refreshShort") : t("currencies.refresh")}
      </Button>
      <Button
        onClick={() => {
          setEditing(null);
          setSheetOpen(true);
        }}
      >
        {t("currencies.add")}
      </Button>
    </Group>
  );

  const tableProps = base ? { rows, base, day, actions } : null;
  const editingRow = editing ? (rows.find((r) => r.currency.id === editing.id) ?? null) : null;

  return (
    <Stack className={`${classes.page} ${phone ? classes.phone : ""}`} gap="md">
      <PageHeader title={t("currencies.title")} hint={t("currencies.hint")} actions={header} />

      {providerError && (
        <Alert
          color="yellow"
          icon={<IconAlertTriangle size={16} />}
          title={t("currencies.providerDown")}
        >
          {t("currencies.providerDownHint")}
        </Alert>
      )}

      {base && (
        <span className={classes.line}>
          {t("currencies.line", { name: base.name })}
          {ecbDate && ` ${t("currencies.lineEcb", { date: day(ecbDate) })}`}
        </span>
      )}

      {tableProps &&
        (phone ? <CurrencyPhoneList {...tableProps} /> : <CurrencyTable {...tableProps} />)}

      {base && (
        <CurrencySheet
          opened={sheetOpen}
          onClose={() => setSheetOpen(false)}
          walletId={walletId}
          editing={editing}
          row={editingRow}
          base={base}
          catalog={catalog}
          day={day}
          onSaved={invalidate}
          onAdded={(c) => {
            invalidate();
            // One the ECB does not publish stays open, to have its rate typed.
            if (c.rateSource) setSheetOpen(false);
            else setEditing(c);
          }}
          actions={actions}
        />
      )}
    </Stack>
  );
}
