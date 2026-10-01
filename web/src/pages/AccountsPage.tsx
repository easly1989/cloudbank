import { Button, Stack, UnstyledButton } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { IconWallet } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import {
  ApiError,
  deleteAccount,
  listAccounts,
  listCurrencies,
  listGoals,
  type Account,
} from "../api/client";
import { AssetValuationsModal } from "../components/AssetValuationsModal";
import { useConfirm } from "../components/confirmContext";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import type { MoneyFormat } from "../money";
import { useToday } from "../useToday";
import { useWallet } from "../wallet/WalletProvider";
import { buildGroups } from "./accounts/accountList";
import classes from "./accounts/accounts.module.css";
import { AccountSheet } from "./accounts/AccountSheet";
import { AccountPhoneList, AccountTable, type AccountActions } from "./accounts/AccountTable";
import { useDayMonth } from "./categories/labels";
import { asideByAccount } from "./goals/goalList";

/**
 * Accounts (#564): every account with what the bank has confirmed, today's
 * balance and the future one, a band per type with its subtotal and the total
 * under them. A click opens the account's register; ⋯ edits it in the sheet
 * beside the page.
 */
export function AccountsPage() {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { currentWallet } = useWallet();
  const walletId = currentWallet?.id ?? 0;
  const phone = useMediaQuery("(max-width: 47.99em)") ?? false;
  const day = useDayMonth(useToday());

  const accountsQuery = useQuery({
    queryKey: ["accounts", walletId],
    queryFn: () => listAccounts(walletId),
    enabled: walletId > 0,
  });
  const currenciesQuery = useQuery({
    queryKey: ["currencies", walletId],
    queryFn: () => listCurrencies(walletId),
    enabled: walletId > 0,
  });
  // What the goals keep in each account, beside its line (#572).
  const goalsQuery = useQuery({
    queryKey: ["goals", walletId],
    queryFn: () => listGoals(walletId),
    enabled: walletId > 0,
  });
  const accounts = useMemo(() => accountsQuery.data ?? [], [accountsQuery.data]);
  const currencies = useMemo(() => currenciesQuery.data ?? [], [currenciesQuery.data]);
  const closedCount = accounts.filter((a) => a.closed).length;
  const [showClosed, setShowClosed] = useState(false);
  const data = useMemo(
    () => buildGroups(accounts, currencies, showClosed && closedCount > 0),
    [accounts, currencies, showClosed, closedCount],
  );
  const base = currencies.find((c) => c.isBase);
  const baseFormat: MoneyFormat = {
    fracDigits: base?.fracDigits ?? 2,
    decimalChar: base?.decimalChar ?? ".",
    groupChar: base?.groupChar ?? ",",
    symbol: base?.symbol ?? "",
    symbolPrefix: base?.symbolPrefix ?? false,
  };

  const invalidate = () => {
    for (const key of ["accounts", "dashboard", "wallets"])
      void qc.invalidateQueries({ queryKey: key === "wallets" ? [key] : [key, walletId] });
  };
  const remove = useMutation({
    mutationFn: (id: number) => deleteAccount(walletId, id),
    onSuccess: invalidate,
    onError: (err: unknown) =>
      notifications.show({
        color: "red",
        message: err instanceof ApiError ? err.message : String(err),
      }),
  });

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [valuationsFor, setValuationsFor] = useState<Account | null>(null);

  const actions: AccountActions = {
    onOpen: (a) => navigate(`/transactions?account=${a.id}`),
    onEdit: (a) => {
      setEditing(a);
      setSheetOpen(true);
    },
    onReconcile: (a) => navigate(`/transactions?account=${a.id}&reconcile=1`),
    onValuations: (a) => {
      setSheetOpen(false);
      setValuationsFor(a);
    },
    onDelete: (a) => void askDelete(a),
  };
  const askDelete = async (a: Account) => {
    setSheetOpen(false);
    const ok = await confirm({
      title: t("accounts.confirmDeleteTitle", { name: a.name }),
      body: t("accounts.confirmDeleteBody"),
      confirmLabel: t("accounts.confirmDeleteAction"),
      danger: true,
    });
    if (ok) remove.mutate(a.id);
  };

  if (!currentWallet) return null;

  // One button, shown in the header or in the empty state — never both.
  const addButton = (
    <Button
      data-tour="accounts-add"
      onClick={() => {
        setEditing(null);
        setSheetOpen(true);
      }}
    >
      {t("accounts.add")}
    </Button>
  );
  const tableProps = {
    data,
    baseFormat,
    day,
    actions,
    aside: asideByAccount(goalsQuery.data ?? []),
    baseCurrencyId: base?.id,
  };

  return (
    <Stack className={classes.page} gap="md">
      <PageHeader
        tour="accounts"
        title={t("accounts.title")}
        actions={accounts.length > 0 ? addButton : undefined}
      />

      {accounts.length === 0 && accountsQuery.isSuccess && (
        <EmptyState
          icon={IconWallet}
          message={t("accounts.empty")}
          hint={t("accounts.emptyHint")}
          action={addButton}
        />
      )}

      {accounts.length > 0 && (
        <>
          <span className={classes.line}>
            {t("accounts.line")}
            {data.converted && base && ` ${t("accounts.lineConverted", { code: base.isoCode })}`}
          </span>
          {closedCount > 0 && (
            <div className={classes.bar}>
              <UnstyledButton
                className={classes.chip}
                aria-pressed={showClosed}
                onClick={() => setShowClosed((v) => !v)}
              >
                {t("accounts.closed")}
                <em>{closedCount}</em>
              </UnstyledButton>
            </div>
          )}
          {phone ? <AccountPhoneList {...tableProps} /> : <AccountTable {...tableProps} />}
        </>
      )}

      <AccountSheet
        opened={sheetOpen}
        onClose={() => setSheetOpen(false)}
        walletId={walletId}
        editing={editing}
        currencies={currencies}
        day={day}
        onSaved={invalidate}
        actions={actions}
      />

      {valuationsFor && (
        <AssetValuationsModal
          opened
          onClose={() => setValuationsFor(null)}
          walletId={walletId}
          account={valuationsFor}
        />
      )}
    </Stack>
  );
}
