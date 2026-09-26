import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Card,
  Divider,
  Group,
  Stack,
  Select,
  Text,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useDisclosure, useMediaQuery } from "@mantine/hooks";
import { IconArrowsLeftRight, IconGitMerge, IconPencil, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useConfirm } from "../components/confirmContext";

import {
  ApiError,
  type Account,
  type ReviewTxn,
  type Transaction,
  bulkEditTransactions,
  deleteTransaction,
  dismissAllDuplicatePairs,
  dismissDuplicatePair,
  getTransaction,
  getTransactionReview,
  listAccounts,
  listCategories,
  listPayees,
  listTemplates,
  mergeTransactions,
} from "../api/client";
import { TransactionForm } from "../components/TransactionForm";
import { useDateFormat } from "../dates";
import { formatMinor, type MoneyFormat } from "../money";
import { useWallet } from "../wallet/WalletProvider";
import { PageHeader } from "../components/PageHeader";
import { amountColor, errorColor } from "../amountTone";
import { compareRows, type CompareField, type CompareRow, type Described } from "./reviewCompare";

// The label each compared field goes by (#484).
const FIELD_LABEL: Record<CompareField, string> = {
  amount: "transactions.amount",
  account: "transactions.account",
  transfer: "transfers.transfer",
  payee: "transactions.payee",
  category: "transactions.category",
  memo: "transactions.memo",
  info: "transactions.info",
  paymentMode: "transactions.paymentMode",
  status: "transactions.status",
  tags: "transactions.tags",
};

// A compared row's rule, between it and the next.
const ROW_RULE = "1px solid var(--mantine-color-default-border)";

function fmtFor(acc?: Account): MoneyFormat {
  return {
    fracDigits: acc?.currencyFracDigits ?? 2,
    decimalChar: acc?.currencyDecimalChar ?? ".",
    groupChar: acc?.currencyGroupChar ?? ",",
    symbol: acc?.currencySymbol ?? "",
    symbolPrefix: acc?.currencySymbolPrefix ?? false,
  };
}

// ReviewPage is the bank-sync review: imported transactions that still need a
// category (set it inline), and suspected duplicate pairs to merge, delete, edit,
// or mark "not a duplicate".
export function ReviewPage() {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const fmtDate = useDateFormat();
  const qc = useQueryClient();
  const { currentWallet } = useWallet();
  const walletId = currentWallet?.id ?? 0;

  const review = useQuery({
    queryKey: ["review", walletId],
    queryFn: () => getTransactionReview(walletId),
    enabled: walletId > 0,
  });
  const accountsQuery = useQuery({
    queryKey: ["accounts", walletId],
    queryFn: () => listAccounts(walletId),
    enabled: walletId > 0,
  });
  const categoriesQuery = useQuery({
    queryKey: ["categories", walletId],
    queryFn: () => listCategories(walletId),
    enabled: walletId > 0,
  });
  const payeesQuery = useQuery({
    queryKey: ["payees", walletId],
    queryFn: () => listPayees(walletId),
    enabled: walletId > 0,
  });
  const templatesQuery = useQuery({
    queryKey: ["templates", walletId],
    queryFn: () => listTemplates(walletId),
    enabled: walletId > 0,
  });

  const accounts = useMemo(() => accountsQuery.data ?? [], [accountsQuery.data]);
  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const categoryOptions = useMemo(() => {
    const cats = categoriesQuery.data ?? [];
    return cats.map((c) => ({
      value: String(c.id),
      label: c.parentId
        ? `   ${cats.find((p) => p.id === c.parentId)?.name ?? ""} › ${c.name}`
        : c.name,
    }));
  }, [categoriesQuery.data]);

  const payeeById = useMemo(
    () => new Map((payeesQuery.data ?? []).map((p) => [p.id, p.name])),
    [payeesQuery.data],
  );
  const categoryName = useMemo(() => {
    const cats = categoriesQuery.data ?? [];
    const byId = new Map(cats.map((c) => [c.id, c]));
    return (id?: number | null) => {
      const c = id ? byId.get(id) : undefined;
      if (!c) return "";
      const parent = c.parentId ? byId.get(c.parentId) : undefined;
      return parent ? `${parent.name} › ${c.name}` : c.name;
    };
  }, [categoriesQuery.data]);
  // Side by side on a desktop; on a phone the two stack.
  const phone = useMediaQuery("(max-width: 47.99em)");

  const [editTx, setEditTx] = useState<{ tx: Transaction; account: Account } | null>(null);
  const [formOpen, form] = useDisclosure(false);

  const onError = (err: unknown) =>
    notifications.show({
      color: "red",
      message: err instanceof ApiError ? err.message : String(err),
    });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["review", walletId] });
    void qc.invalidateQueries({ queryKey: ["register", walletId] });
    void qc.invalidateQueries({ queryKey: ["dashboard", walletId] });
    void qc.invalidateQueries({ queryKey: ["accounts", walletId] });
  };

  const setCategory = useMutation({
    mutationFn: (v: { id: number; categoryId: number }) =>
      bulkEditTransactions(walletId, [v.id], "category", v.categoryId),
    onSuccess: refresh,
    onError,
  });
  const merge = useMutation({
    mutationFn: (v: { keepId: number; dropId: number }) =>
      mergeTransactions(walletId, v.keepId, v.dropId),
    onSuccess: () => {
      refresh();
      notifications.show({ color: "green", message: t("review.merged"), autoClose: 1600 });
    },
    onError,
  });
  const dismiss = useMutation({
    mutationFn: (v: { aId: number; bId: number }) => dismissDuplicatePair(walletId, v.aId, v.bId),
    onSuccess: refresh,
    onError,
  });
  const dismissAll = useMutation({
    mutationFn: () => dismissAllDuplicatePairs(walletId),
    onSuccess: (res) => {
      refresh();
      notifications.show({
        color: "green",
        message: t("review.dismissedAll", { count: res.dismissed }),
        autoClose: 2000,
      });
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: (id: number) => deleteTransaction(walletId, id),
    onSuccess: refresh,
    onError,
  });

  const openEdit = async (id: number, accountId: number) => {
    const account = accountById.get(accountId);
    if (!account) return;
    try {
      const tx = await getTransaction(walletId, id);
      setEditTx({ tx, account });
      form.open();
    } catch (err) {
      onError(err);
    }
  };

  if (!currentWallet) return null;

  const needs = review.data?.needsCategory ?? [];
  const dups = review.data?.duplicates ?? [];

  // A transaction's compared fields, as the reader sees them.
  const describe = (tx: ReviewTxn): Described => {
    const acc = accountById.get(tx.accountId);
    const other = tx.transferAccountId ? accountById.get(tx.transferAccountId) : undefined;
    return {
      amount: formatMinor(tx.amount, fmtFor(acc)),
      account: acc?.name ?? "",
      transfer: tx.transferAccountId ? (other?.name ?? "?") : "",
      payee: tx.payeeId ? (payeeById.get(tx.payeeId) ?? "") : "",
      category: tx.isSplit ? t("transactions.split") : categoryName(tx.categoryId),
      memo: tx.memo,
      info: tx.info,
      paymentMode: tx.paymentMode ? t(`paymentModes.${tx.paymentMode}`) : "",
      status: t(`status.${tx.status}`),
      tags: (tx.tags ?? []).join(", "),
    };
  };

  // One side's value in a compared row. What the two share is dimmed, so the
  // differences are what the eye lands on; the memo is never cut short.
  const value = (row: CompareRow, side: "a" | "b", tx: ReviewTxn): ReactNode => {
    const text = row[side];
    if (text === "") {
      return (
        <Text size="sm" c="dimmed">
          —
        </Text>
      );
    }
    if (row.field === "amount") {
      return (
        <Text
          size="sm"
          fw={600}
          ff="monospace"
          c={amountColor(tx.amount)}
          opacity={row.same ? 0.6 : 1}
        >
          {text}
        </Text>
      );
    }
    return (
      <Text
        size="sm"
        c={row.same ? "dimmed" : undefined}
        style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
      >
        {row.field === "transfer" && (
          <IconArrowsLeftRight size={13} style={{ marginRight: 4, verticalAlign: -2 }} />
        )}
        {text}
      </Text>
    );
  };

  const label = (field: CompareField) => (
    <Text size="xs" fw={600} c="dimmed" tt="uppercase" style={{ letterSpacing: "0.04em" }}>
      {t(FIELD_LABEL[field])}
    </Text>
  );

  // The date and where the row came from, above its column.
  const heading = (tx: ReviewTxn) => (
    <Group gap={8} wrap="nowrap">
      <Text fw={700} size="sm" ff="monospace">
        {fmtDate(tx.date)}
      </Text>
      {tx.importRef ? (
        <Badge size="xs" variant="dot" color="blue">
          {t("review.fromBank")}
        </Badge>
      ) : (
        <Badge size="xs" variant="dot" color="gray">
          {t("review.manual")}
        </Badge>
      )}
    </Group>
  );

  const actions = (tx: ReviewTxn, other: ReviewTxn) => (
    <Group gap={4} wrap="nowrap">
      <Button
        size="xs"
        variant="light"
        leftSection={<IconGitMerge size={14} />}
        onClick={() => merge.mutate({ keepId: tx.id, dropId: other.id })}
        loading={merge.isPending}
      >
        {t("review.keepThis")}
      </Button>
      <Tooltip label={t("review.edit")} withArrow>
        <ActionIcon
          variant="subtle"
          size="sm"
          aria-label={t("review.edit")}
          onClick={() => void openEdit(tx.id, tx.accountId)}
        >
          <IconPencil size={15} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label={t("review.delete")} withArrow>
        <ActionIcon
          variant="subtle"
          size="sm"
          color="red"
          aria-label={t("review.delete")}
          onClick={async () => {
            const ok = await confirm({
              title: t("transactions.confirmDeleteTitle"),
              body: t("transactions.confirmDeleteBody"),
              confirmLabel: t("transactions.confirmDeleteAction"),
              danger: true,
            });
            if (ok) remove.mutate(tx.id);
          }}
        >
          <IconTrash size={15} />
        </ActionIcon>
      </Tooltip>
    </Group>
  );

  // A pair, field by field (#484): one row per field with the two side by side,
  // so a row is as tall as its longer value and the columns stay aligned.
  const comparison = (a: ReviewTxn, b: ReviewTxn) => {
    const rows = compareRows(describe(a), describe(b));
    const cell = { padding: "6px 0", borderBottom: ROW_RULE, minWidth: 0 };
    if (phone) {
      const sides = [
        [a, b, "a"],
        [b, a, "b"],
      ] as const;
      return (
        <Stack gap="sm">
          {sides.map(([tx, other, side]) => (
            <Box
              key={tx.id}
              p="sm"
              style={{ border: ROW_RULE, borderRadius: "var(--mantine-radius-md)" }}
            >
              {heading(tx)}
              <Box
                mt={6}
                style={{
                  display: "grid",
                  gridTemplateColumns: "92px minmax(0, 1fr)",
                  columnGap: 10,
                }}
              >
                {rows.map((row) => (
                  <Fragment key={row.field}>
                    <Box style={{ ...cell, paddingTop: 8 }}>{label(row.field)}</Box>
                    <Box style={cell}>{value(row, side, tx)}</Box>
                  </Fragment>
                ))}
              </Box>
              <Box mt="sm">{actions(tx, other)}</Box>
            </Box>
          ))}
        </Stack>
      );
    }
    return (
      <Box
        style={{
          display: "grid",
          gridTemplateColumns: "max-content minmax(0, 1fr) minmax(0, 1fr)",
          columnGap: 20,
        }}
      >
        <Box style={{ ...cell, paddingBottom: 10 }} />
        <Box style={{ ...cell, paddingBottom: 10 }}>{heading(a)}</Box>
        <Box style={{ ...cell, paddingBottom: 10 }}>{heading(b)}</Box>
        {rows.map((row) => (
          <Fragment key={row.field}>
            <Box style={{ ...cell, paddingTop: 8 }}>{label(row.field)}</Box>
            <Box style={cell}>{value(row, "a", a)}</Box>
            <Box style={cell}>{value(row, "b", b)}</Box>
          </Fragment>
        ))}
        <Box />
        <Box pt="sm">{actions(a, b)}</Box>
        <Box pt="sm">{actions(b, a)}</Box>
      </Box>
    );
  };

  return (
    <Stack>
      <PageHeader tour="review" title={t("review.title")} hint={t("review.hint")} />

      {review.isError && <Text c={errorColor}>{t("review.error")}</Text>}

      <Card withBorder data-tour="review-categories">
        <Stack gap="sm">
          <Text fw={600}>{t("review.needsCategory", { count: needs.length })}</Text>
          {needs.length === 0 ? (
            <Text c="dimmed" size="sm">
              {t("review.needsCategoryEmpty")}
            </Text>
          ) : (
            needs.map((tx) => {
              const acc = accountById.get(tx.accountId);
              return (
                <Group key={tx.id} justify="space-between" wrap="nowrap" gap="sm">
                  <div style={{ minWidth: 0 }}>
                    <Text size="sm" truncate>
                      {tx.memo || t("review.noMemo")}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {fmtDate(tx.date)}
                      {acc ? ` · ${acc.name}` : ""} · {formatMinor(tx.amount, fmtFor(acc))}
                    </Text>
                  </div>
                  <Select
                    placeholder={t("transactions.category")}
                    data={categoryOptions}
                    value={tx.categoryId ? String(tx.categoryId) : null}
                    onChange={(v) => v && setCategory.mutate({ id: tx.id, categoryId: Number(v) })}
                    searchable
                    w={240}
                  />
                </Group>
              );
            })
          )}
        </Stack>
      </Card>

      <Card withBorder data-tour="review-duplicates">
        <Stack gap="sm">
          {/* Wraps on a phone, where the title and the button do not fit one line. */}
          <Group justify="space-between" gap="xs">
            <Text fw={600}>{t("review.duplicates", { count: dups.length })}</Text>
            {dups.length > 0 && (
              <Button
                size="xs"
                variant="light"
                color="gray"
                loading={dismissAll.isPending}
                onClick={async () => {
                  const ok = await confirm({
                    title: t("review.confirmDismissAllTitle", { count: dups.length }),
                    body: t("review.confirmDismissAllBody"),
                    confirmLabel: t("review.dismissAll"),
                  });
                  if (ok) dismissAll.mutate();
                }}
              >
                {t("review.dismissAll")}
              </Button>
            )}
          </Group>
          {dups.length === 0 ? (
            <Text c="dimmed" size="sm">
              {t("review.duplicatesEmpty")}
            </Text>
          ) : (
            dups.map((p) => (
              <Card
                key={`${p.a.id}:${p.b.id}`}
                withBorder
                padding="sm"
                bg="var(--mantine-color-body)"
              >
                {comparison(p.a, p.b)}
                <Divider my="xs" />
                <Group justify="flex-end">
                  <Button
                    size="xs"
                    variant="subtle"
                    color="gray"
                    onClick={() => dismiss.mutate({ aId: p.a.id, bId: p.b.id })}
                    loading={dismiss.isPending}
                  >
                    {t("review.notDuplicate")}
                  </Button>
                </Group>
              </Card>
            ))
          )}
        </Stack>
      </Card>

      {editTx && (
        <TransactionForm
          opened={formOpen}
          onClose={() => {
            form.close();
            setEditTx(null);
          }}
          walletId={walletId}
          account={editTx.account}
          editing={editTx.tx}
          onSaved={refresh}
          templates={(templatesQuery.data ?? []).filter((tpl) => !tpl.isTransfer)}
          onTemplateSaved={() => void qc.invalidateQueries({ queryKey: ["templates", walletId] })}
        />
      )}
    </Stack>
  );
}
