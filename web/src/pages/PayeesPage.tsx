import { Button, Stack, TextInput, UnstyledButton } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { IconSearch, IconUsers } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  ApiError,
  deletePayee,
  getPayeeActivity,
  listCategories,
  listPayees,
  mergePayee,
  updatePayee,
  type Payee,
} from "../api/client";
import { useConfirm } from "../components/confirmContext";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { formatMinor, type MoneyFormat } from "../money";
import { useToday } from "../useToday";
import { useWallet } from "../wallet/WalletProvider";
import { MergeModal } from "./categories/CategoryModals";
import { lastTwelveMonths } from "./categories/categoryTree";
import { useDayMonth } from "./categories/labels";
import {
  arrange,
  buildRows,
  DEFAULT_SORT,
  isUnused,
  type PayeeRow,
  type Sort,
} from "./payees/payeeList";
import classes from "./payees/payees.module.css";
import { PayeeSheet } from "./payees/PayeeSheet";
import { PayeePhoneList, PayeeTable } from "./payees/PayeeTable";

/** Plain two-decimal numbers, for a wallet with no base currency yet. */
const PLAIN: MoneyFormat = {
  fracDigits: 2,
  decimalChar: ".",
  groupChar: ",",
  symbol: "",
  symbolPrefix: false,
};

/**
 * Payees (#554): every payee with what it held over the last twelve months,
 * its default category and, while it has none, the one it usually gets, which
 * one click makes its default. A payee opens in the sheet beside the page.
 */
export function PayeesPage() {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const { currentWallet } = useWallet();
  const walletId = currentWallet?.id ?? 0;
  const phone = useMediaQuery("(max-width: 47.99em)") ?? false;
  const today = useToday();
  const day = useDayMonth(today);
  const { from, to } = useMemo(() => lastTwelveMonths(today), [today]);

  const payeesQuery = useQuery({
    queryKey: ["payees", walletId],
    queryFn: () => listPayees(walletId),
    enabled: walletId > 0,
  });
  const categoriesQuery = useQuery({
    queryKey: ["categories", walletId],
    queryFn: () => listCategories(walletId),
    enabled: walletId > 0,
  });
  const activityQuery = useQuery({
    queryKey: ["payee-activity", walletId, from, to],
    queryFn: () => getPayeeActivity(walletId, from, to),
    enabled: walletId > 0,
  });
  const payees = useMemo(() => payeesQuery.data ?? [], [payeesQuery.data]);
  const categories = useMemo(() => categoriesQuery.data ?? [], [categoriesQuery.data]);
  const rows = useMemo(
    () => buildRows(payees, activityQuery.data?.payees ?? [], categories),
    [payees, activityQuery.data, categories],
  );
  const format = useMemo(() => {
    const fmt = activityQuery.data?.currency ?? PLAIN;
    return (amount: number) => formatMinor(amount, fmt);
  }, [activityQuery.data]);

  const [search, setSearch] = useState("");
  const [noDefault, setNoDefault] = useState(false);
  const [unusedOnly, setUnusedOnly] = useState(false);
  const [sort, setSort] = useState<Sort>(DEFAULT_SORT);
  const noDefaultCount = rows.filter((r) => !r.defaultCategory).length;
  const unusedCount = rows.filter(isUnused).length;
  const shown = useMemo(
    () =>
      arrange(
        rows,
        {
          query: search,
          noDefault: noDefault && noDefaultCount > 0,
          unusedOnly: unusedOnly && unusedCount > 0,
        },
        sort,
      ),
    [rows, search, noDefault, noDefaultCount, unusedOnly, unusedCount, sort],
  );

  const invalidate = () => {
    for (const key of ["payees", "payee-activity"])
      void qc.invalidateQueries({ queryKey: [key, walletId] });
  };
  const onError = (err: unknown) =>
    notifications.show({
      color: "red",
      message: err instanceof ApiError ? err.message : String(err),
    });

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<Payee | null>(null);
  const [mergeFrom, setMergeFrom] = useState<Payee | null>(null);

  const remove = useMutation({
    mutationFn: (id: number) => deletePayee(walletId, id),
    onSuccess: invalidate,
    onError,
  });
  // "Use it" on a row: the usual category becomes the default, the rest as is.
  const adopt = useMutation({
    mutationFn: (r: PayeeRow) =>
      updatePayee(walletId, r.payee.id, {
        name: r.payee.name,
        defaultCategoryId: r.suggested!.id,
        defaultPaymentMode: r.payee.defaultPaymentMode ?? null,
      }),
    onSuccess: invalidate,
    onError,
  });

  const actions = {
    onOpen: (p: Payee) => {
      setEditing(p);
      setSheetOpen(true);
    },
    onUseSuggestion: (r: PayeeRow) => adopt.mutate(r),
    onMerge: (p: Payee) => {
      setSheetOpen(false);
      setMergeFrom(p);
    },
    onDelete: (p: Payee) => void askDelete(p),
  };
  const askDelete = async (p: Payee) => {
    setSheetOpen(false);
    const ok = await confirm({
      title: t("payees.confirmDeleteTitle", { name: p.name }),
      body: t("payees.confirmDeleteBody"),
      confirmLabel: t("payees.delete"),
      danger: true,
    });
    if (ok) remove.mutate(p.id);
  };

  if (!currentWallet) return null;

  // One button, shown in the header or in the empty state — never both.
  const addButton = (
    <Button
      onClick={() => {
        setEditing(null);
        setSheetOpen(true);
      }}
    >
      {t("payees.add")}
    </Button>
  );
  const chip = (on: boolean, toggle: () => void, label: string, n: number) => (
    <UnstyledButton className={classes.chip} aria-pressed={on} onClick={toggle}>
      {label}
      <em>{n}</em>
    </UnstyledButton>
  );
  const searchBox = (
    <TextInput
      className={classes.search}
      leftSection={<IconSearch size={16} />}
      placeholder={t("payees.find")}
      aria-label={t("payees.find")}
      value={search}
      onChange={(e) => setSearch(e.currentTarget.value)}
    />
  );
  const chips = (
    <>
      {noDefaultCount > 0 &&
        chip(
          noDefault,
          () => setNoDefault((v) => !v),
          t("payees.filter.noDefault"),
          noDefaultCount,
        )}
      {unusedCount > 0 &&
        chip(
          unusedOnly,
          () => setUnusedOnly((v) => !v),
          phone ? t("payees.filter.unusedShort") : t("payees.filter.unused"),
          unusedCount,
        )}
    </>
  );

  const tableProps = { rows: shown, categories, format, day, actions };
  const editingRow = editing ? (rows.find((r) => r.payee.id === editing.id) ?? null) : null;

  return (
    <Stack className={`${classes.page} ${phone ? classes.phone : ""}`} gap="md">
      <PageHeader
        title={t("payees.title")}
        hint={t("payees.hint")}
        actions={payees.length > 0 ? addButton : undefined}
      />

      {payees.length === 0 && payeesQuery.isSuccess && (
        <EmptyState
          icon={IconUsers}
          message={t("payees.empty")}
          hint={t("payees.emptyHint")}
          action={addButton}
        />
      )}

      {payees.length > 0 && (
        <>
          {phone ? (
            <>
              {searchBox}
              {(noDefaultCount > 0 || unusedCount > 0) && (
                <div className={classes.bar}>{chips}</div>
              )}
            </>
          ) : (
            <div className={classes.bar}>
              {searchBox}
              {chips}
              <span className={classes.period}>{t("payees.period")}</span>
            </div>
          )}
          {shown.length === 0 ? (
            <div className={classes.card}>
              <div className={classes.none}>{t("payees.noMatch")}</div>
            </div>
          ) : phone ? (
            <PayeePhoneList {...tableProps} />
          ) : (
            <PayeeTable {...tableProps} sort={sort} onSort={setSort} />
          )}
        </>
      )}

      <PayeeSheet
        opened={sheetOpen}
        onClose={() => setSheetOpen(false)}
        walletId={walletId}
        editing={editing}
        row={editingRow}
        categories={categories}
        others={payees.filter((p) => p.id !== editing?.id).map((p) => p.name)}
        format={format}
        day={day}
        onSaved={invalidate}
        onMerge={actions.onMerge}
        onDelete={actions.onDelete}
      />
      <MergeModal
        key={`merge-${mergeFrom?.id ?? "none"}`}
        title={t("payees.mergeTitle")}
        source={mergeFrom}
        options={payees
          .filter((p) => p.id !== mergeFrom?.id)
          .map((p) => ({ value: String(p.id), label: p.name }))}
        onClose={() => setMergeFrom(null)}
        onMerge={(targetId) =>
          mergePayee(walletId, mergeFrom!.id, targetId)
            .then(() => {
              setMergeFrom(null);
              invalidate();
            })
            .catch(onError)
        }
      />
    </Stack>
  );
}
