import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Divider,
  Group,
  SimpleGrid,
  Stack,
  Select,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useDisclosure } from "@mantine/hooks";
import { IconGitMerge, IconPencil, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  ApiError,
  type Account,
  type ReviewTxn,
  type Transaction,
  bulkEditTransactions,
  deleteTransaction,
  dismissDuplicatePair,
  getTransaction,
  getTransactionReview,
  listAccounts,
  listCategories,
  listTemplates,
  mergeTransactions,
} from "../api/client";
import { TransactionForm } from "../components/TransactionForm";
import { useDateFormat } from "../dates";
import { formatMinor, type MoneyFormat } from "../money";
import { useWallet } from "../wallet/WalletProvider";

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

  const dupCell = (tx: ReviewTxn, other: ReviewTxn) => {
    const acc = accountById.get(tx.accountId);
    return (
      <Card withBorder padding="sm">
        <Stack gap={4}>
          <Group justify="space-between" wrap="nowrap">
            <Text fw={600} size="sm">
              {fmtDate(tx.date)}
            </Text>
            <Text fw={600} size="sm" c={tx.amount < 0 ? "red" : "teal"}>
              {formatMinor(tx.amount, fmtFor(acc))}
            </Text>
          </Group>
          <Text size="xs" c="dimmed" truncate>
            {tx.memo || t("review.noMemo")}
            {acc ? ` · ${acc.name}` : ""}
          </Text>
          {tx.importRef ? (
            <Badge size="xs" variant="light" color="blue">
              {t("review.fromBank")}
            </Badge>
          ) : (
            <Badge size="xs" variant="light" color="gray">
              {t("review.manual")}
            </Badge>
          )}
          <Group gap={4} mt={4} wrap="nowrap">
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
                onClick={() => {
                  if (window.confirm(t("transactions.confirmDelete"))) remove.mutate(tx.id);
                }}
              >
                <IconTrash size={15} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Stack>
      </Card>
    );
  };

  return (
    <Stack>
      <div>
        <Title order={2}>{t("review.title")}</Title>
        <Text c="dimmed" size="sm">
          {t("review.hint")}
        </Text>
      </div>

      {review.isError && <Text c="red">{t("review.error")}</Text>}

      <Card withBorder>
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

      <Card withBorder>
        <Stack gap="sm">
          <Text fw={600}>{t("review.duplicates", { count: dups.length })}</Text>
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
                <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                  {dupCell(p.a, p.b)}
                  {dupCell(p.b, p.a)}
                </SimpleGrid>
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
