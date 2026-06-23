import {
  ActionIcon,
  Alert,
  Button,
  Group,
  Modal,
  SegmentedControl,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { IconPencil, IconPlus, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  ApiError,
  type Account,
  type Template,
  type TemplateInput,
  createTemplate,
  deleteTemplate,
  listAccounts,
  listCategories,
  listPayees,
  listTemplates,
  updateTemplate,
} from "../api/client";
import { formatMinor, type MoneyFormat } from "../money";
import { rowEditProps, stopRowEdit } from "../rowEdit";
import { useAmountParser } from "../useAmountParser";
import { useWallet } from "../wallet/WalletProvider";

const PAYMENT_MODES = Array.from({ length: 12 }, (_, i) => i);
const STATUSES = [0, 1, 2, 3, 4];

const accountFormat = (a?: Account): MoneyFormat => ({
  fracDigits: a?.currencyFracDigits ?? 2,
  decimalChar: a?.currencyDecimalChar ?? ".",
  groupChar: a?.currencyGroupChar ?? ",",
  symbol: a?.currencySymbol ?? "",
  symbolPrefix: a?.currencySymbolPrefix ?? false,
});

// TemplatesPage manages reusable transaction models: a template carries an
// account, amount, payee/category, memo and payment mode, and is offered when
// adding a transaction (and backs scheduled transactions).
export function TemplatesPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { currentWallet } = useWallet();
  const walletId = currentWallet?.id ?? 0;

  const templatesQuery = useQuery({
    queryKey: ["templates", walletId],
    queryFn: () => listTemplates(walletId),
    enabled: walletId > 0,
  });
  const accountsQuery = useQuery({
    queryKey: ["accounts", walletId],
    queryFn: () => listAccounts(walletId),
    enabled: walletId > 0,
  });
  const accounts = useMemo(() => accountsQuery.data ?? [], [accountsQuery.data]);
  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);

  const [formOpened, form] = useDisclosure(false);
  const [editing, setEditing] = useState<Template | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["templates", walletId] });
  const onError = (err: unknown) =>
    notifications.show({
      color: "red",
      message: err instanceof ApiError ? err.message : String(err),
    });
  const remove = useMutation({
    mutationFn: (id: number) => deleteTemplate(walletId, id),
    onSuccess: invalidate,
    onError,
  });

  const openCreate = () => {
    setEditing(null);
    form.open();
  };
  const openEdit = (tpl: Template) => {
    setEditing(tpl);
    form.open();
  };

  if (!currentWallet) return null;
  const templates = templatesQuery.data ?? [];

  return (
    <Stack maw={760}>
      <Group justify="space-between">
        <Title order={2}>{t("templates.title")}</Title>
        <Button leftSection={<IconPlus size={16} />} onClick={openCreate}>
          {t("templates.add")}
        </Button>
      </Group>

      {templates.length === 0 && <Text c="dimmed">{t("templates.empty")}</Text>}

      {templates.length > 0 && (
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t("templates.name")}</Table.Th>
              <Table.Th>{t("transactions.account")}</Table.Th>
              <Table.Th ta="right">{t("transactions.amount")}</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {templates.map((tpl) => {
              const acc = tpl.accountId != null ? accountById.get(tpl.accountId) : undefined;
              return (
                <Table.Tr key={tpl.id} {...rowEditProps(() => openEdit(tpl))}>
                  <Table.Td>{tpl.name}</Table.Td>
                  <Table.Td>{acc?.name ?? "—"}</Table.Td>
                  <Table.Td ta="right" c={tpl.amount < 0 ? "red" : "teal"}>
                    {formatMinor(tpl.amount, accountFormat(acc))}
                  </Table.Td>
                  <Table.Td ta="right" {...stopRowEdit}>
                    <Group gap={4} justify="flex-end" wrap="nowrap">
                      <ActionIcon
                        variant="subtle"
                        aria-label={t("templates.edit")}
                        onClick={() => openEdit(tpl)}
                      >
                        <IconPencil size={16} />
                      </ActionIcon>
                      <ActionIcon
                        variant="subtle"
                        color="red"
                        aria-label={t("templates.delete")}
                        onClick={() => {
                          if (window.confirm(t("templates.confirmDelete", { name: tpl.name })))
                            remove.mutate(tpl.id);
                        }}
                      >
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      )}

      <TemplateFormModal
        opened={formOpened}
        onClose={form.close}
        walletId={walletId}
        editing={editing}
        accounts={accounts}
        onSaved={() => {
          invalidate();
          form.close();
        }}
      />
    </Stack>
  );
}

function TemplateFormModal({
  opened,
  onClose,
  walletId,
  editing,
  accounts,
  onSaved,
}: {
  opened: boolean;
  onClose: () => void;
  walletId: number;
  editing: Template | null;
  accounts: Account[];
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const parseAmount = useAmountParser();
  const payeesQuery = useQuery({
    queryKey: ["payees", walletId],
    queryFn: () => listPayees(walletId),
  });
  const categoriesQuery = useQuery({
    queryKey: ["categories", walletId],
    queryFn: () => listCategories(walletId),
  });
  const payees = payeesQuery.data ?? [];
  const categories = useMemo(() => categoriesQuery.data ?? [], [categoriesQuery.data]);

  const [name, setName] = useState("");
  const [accountId, setAccountId] = useState<string | null>(null);
  const [direction, setDirection] = useState<"expense" | "income">("expense");
  const [amount, setAmount] = useState("");
  const [payeeId, setPayeeId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [memo, setMemo] = useState("");
  const [paymentMode, setPaymentMode] = useState("0");
  const [status, setStatus] = useState("0");

  // A split or transfer template carries structure this form does not edit; we
  // preserve those fields and only allow renaming / changing the memo.
  const complex = !!(editing?.isSplit || editing?.isTransfer);

  useEffect(() => {
    if (!opened) return;
    const acc =
      editing?.accountId != null
        ? accounts.find((a) => a.id === editing.accountId)
        : (accounts[0] ?? undefined);
    setName(editing?.name ?? "");
    setAccountId(acc ? String(acc.id) : null);
    setDirection((editing?.amount ?? 0) < 0 || !editing ? "expense" : "income");
    setAmount(
      editing && editing.amount !== 0
        ? formatMinor(Math.abs(editing.amount), {
            ...accountFormat(acc),
            groupChar: "",
            symbol: "",
          })
        : "",
    );
    setPayeeId(editing?.payeeId != null ? String(editing.payeeId) : null);
    setCategoryId(editing?.categoryId != null ? String(editing.categoryId) : null);
    setMemo(editing?.memo ?? "");
    setPaymentMode(String(editing?.paymentMode ?? 0));
    setStatus(String(editing?.status ?? 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, editing?.id]);

  const onPayee = (v: string | null) => {
    setPayeeId(v);
    const p = payees.find((x) => String(x.id) === v);
    if (p?.defaultCategoryId != null) setCategoryId(String(p.defaultCategoryId));
  };

  const categoryOptions = useMemo(
    () =>
      categories.map((c) => ({
        value: String(c.id),
        label: c.parentId
          ? `   ${categories.find((p) => p.id === c.parentId)?.name ?? ""} › ${c.name}`
          : c.name,
      })),
    [categories],
  );

  const save = useMutation({
    mutationFn: () => {
      let body: TemplateInput;
      if (complex && editing) {
        body = {
          name,
          accountId: editing.accountId,
          amount: editing.amount,
          paymentMode: editing.paymentMode,
          status: editing.status,
          info: editing.info,
          payeeId: editing.payeeId,
          categoryId: editing.categoryId,
          memo,
          tags: editing.tags,
          isTransfer: editing.isTransfer,
          toAccountId: editing.toAccountId,
          splits: editing.splits,
        };
      } else {
        const acc = accounts.find((a) => String(a.id) === accountId);
        const fd = acc?.currencyFracDigits ?? 2;
        const dc = acc?.currencyDecimalChar ?? ".";
        body = {
          name,
          accountId: accountId ? Number(accountId) : null,
          amount: (parseAmount(amount, fd, dc) ?? 0) * (direction === "expense" ? -1 : 1),
          paymentMode: Number(paymentMode),
          status: Number(status),
          payeeId: payeeId ? Number(payeeId) : null,
          categoryId: categoryId ? Number(categoryId) : null,
          memo,
        };
      }
      return editing ? updateTemplate(walletId, editing.id, body) : createTemplate(walletId, body);
    },
    onSuccess: onSaved,
    onError: (err: unknown) =>
      notifications.show({
        color: "red",
        message: err instanceof ApiError ? err.message : String(err),
      }),
  });

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={editing ? t("templates.edit") : t("templates.create")}
    >
      <Stack>
        <TextInput
          label={t("templates.name")}
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          required
          data-autofocus
        />
        {complex && (
          <Alert color="gray" variant="light">
            {t("templates.complexNote")}
          </Alert>
        )}
        {!complex && (
          <>
            <Select
              label={t("transactions.account")}
              data={accounts.map((a) => ({ value: String(a.id), label: a.name }))}
              value={accountId}
              onChange={setAccountId}
              searchable
            />
            <Group align="flex-end" gap="xs">
              <SegmentedControl
                value={direction}
                onChange={(v) => setDirection(v as "expense" | "income")}
                data={[
                  { value: "expense", label: "−" },
                  { value: "income", label: "+" },
                ]}
              />
              <TextInput
                label={t("transactions.amount")}
                value={amount}
                onChange={(e) => setAmount(e.currentTarget.value)}
                style={{ flex: 1 }}
              />
            </Group>
            <Select
              label={t("transactions.payee")}
              data={payees.map((p) => ({ value: String(p.id), label: p.name }))}
              value={payeeId}
              onChange={onPayee}
              clearable
              searchable
            />
            <Select
              label={t("transactions.category")}
              data={categoryOptions}
              value={categoryId}
              onChange={setCategoryId}
              clearable
              searchable
            />
            <Select
              label={t("transactions.paymentMode")}
              data={PAYMENT_MODES.map((m) => ({ value: String(m), label: t(`paymentModes.${m}`) }))}
              value={paymentMode}
              onChange={(v) => v && setPaymentMode(v)}
              allowDeselect={false}
            />
            <Select
              label={t("transactions.status")}
              data={STATUSES.map((s) => ({ value: String(s), label: t(`status.${s}`) }))}
              value={status}
              onChange={(v) => v && setStatus(v)}
              allowDeselect={false}
            />
          </>
        )}
        <TextInput
          label={t("transactions.memo")}
          value={memo}
          onChange={(e) => setMemo(e.currentTarget.value)}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t("transactions.cancel")}
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!name.trim()}>
            {t("transactions.save")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
