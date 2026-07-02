import {
  ActionIcon,
  Alert,
  Button,
  Group,
  Modal,
  NumberFormatter,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  TagsInput,
  Text,
  TextInput,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconDeviceFloppy, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  ApiError,
  type Account,
  type Split,
  type Template,
  type Transaction,
  type TransactionInput,
  createTemplate,
  createTransaction,
  findDuplicateTransactions,
  listCategories,
  listPayees,
  listTags,
  listVehicles,
  suggestAssignment,
  updateTransaction,
} from "../api/client";
import { minorToInput } from "../money";
import { PAYMENT_MODES, STATUSES } from "../transactionEnums";
import { useAmountParser } from "../useAmountParser";
import { AttachmentsField } from "./AttachmentsField";

export function TransactionForm({
  opened,
  onClose,
  walletId,
  account,
  editing,
  onSaved,
  templates,
  onTemplateSaved,
}: {
  opened: boolean;
  onClose: () => void;
  walletId: number;
  account: Account;
  editing: Transaction | null;
  onSaved: () => void;
  templates: Template[];
  onTemplateSaved: () => void;
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
  const tagsQuery = useQuery({ queryKey: ["tags", walletId], queryFn: () => listTags(walletId) });
  const vehiclesQuery = useQuery({
    queryKey: ["vehicles", walletId],
    queryFn: () => listVehicles(walletId),
  });

  const dc = account.currencyDecimalChar;
  const fd = account.currencyFracDigits;

  const [date, setDate] = useState("");
  const [direction, setDirection] = useState<"expense" | "income">("expense");
  const [amount, setAmount] = useState("");
  const [paymentMode, setPaymentMode] = useState("0");
  const [status, setStatus] = useState("0");
  const [payeeId, setPayeeId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [memo, setMemo] = useState("");
  const [info, setInfo] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [isSplit, setIsSplit] = useState(false);
  const [splits, setSplits] = useState<{ categoryId: string | null; amount: string }[]>([]);

  useEffect(() => {
    if (!opened) return;
    const e = editing;
    setDate(e?.date ?? new Date().toISOString().slice(0, 10));
    setDirection((e?.amount ?? -1) < 0 ? "expense" : "income");
    setAmount(e ? minorToInput(Math.abs(e.amount), fd, dc) : "");
    setPaymentMode(String(e?.paymentMode ?? 0));
    setStatus(String(e?.status ?? 0));
    setPayeeId(e?.payeeId ? String(e.payeeId) : null);
    setCategoryId(e?.categoryId ? String(e.categoryId) : null);
    setVehicleId(e?.vehicleId ? String(e.vehicleId) : null);
    setMemo(e?.memo ?? "");
    setInfo(e?.info ?? "");
    setTags(e?.tags ?? []);
    setIsSplit(e?.isSplit ?? false);
    setSplits(
      e?.splits?.map((s) => ({
        categoryId: s.categoryId ? String(s.categoryId) : null,
        amount: minorToInput(Math.abs(s.amount), fd, dc),
      })) ?? [],
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, editing?.id]);

  const sign = direction === "expense" ? -1 : 1;
  const totalMinor = (parseAmount(amount, fd, dc) ?? 0) * sign;
  const splitSumMinor = splits.reduce(
    (sum, s) => sum + (parseAmount(s.amount, fd, dc) ?? 0) * sign,
    0,
  );
  const splitMismatch = isSplit && splits.length > 0 && splitSumMinor !== totalMinor;

  // Duplicate warning.
  const dupQuery = useQuery({
    queryKey: ["dup", walletId, account.id, date, totalMinor],
    queryFn: () => findDuplicateTransactions(walletId, account.id, date, totalMinor),
    enabled: opened && !editing && !!date && totalMinor !== 0,
  });
  const duplicates = (dupQuery.data ?? []).filter((d) => d.id !== editing?.id);

  const save = useMutation({
    mutationFn: () => {
      const body: TransactionInput = {
        accountId: account.id,
        date,
        amount: totalMinor,
        paymentMode: Number(paymentMode),
        status: Number(status),
        info,
        memo,
        payeeId: payeeId ? Number(payeeId) : null,
        categoryId: isSplit ? null : categoryId ? Number(categoryId) : null,
        vehicleId: vehicleId ? Number(vehicleId) : null,
        tags,
        splits: isSplit
          ? splits.map<Split>((s) => ({
              categoryId: s.categoryId ? Number(s.categoryId) : null,
              amount: (parseAmount(s.amount, fd, dc) ?? 0) * sign,
            }))
          : [],
      };
      return editing
        ? updateTransaction(walletId, editing.id, body)
        : createTransaction(walletId, body);
    },
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: (err: unknown) =>
      notifications.show({
        color: "red",
        message: err instanceof ApiError ? err.message : String(err),
      }),
  });

  // Apply a template into the form (user reviews, then saves).
  const applyTemplate = (id: string | null) => {
    const tpl = templates.find((x) => String(x.id) === id);
    if (!tpl) return;
    setDirection(tpl.amount < 0 ? "expense" : "income");
    setAmount(tpl.amount !== 0 ? minorToInput(Math.abs(tpl.amount), fd, dc) : "");
    setPaymentMode(String(tpl.paymentMode));
    setStatus(String(tpl.status));
    setPayeeId(tpl.payeeId ? String(tpl.payeeId) : null);
    setCategoryId(tpl.categoryId ? String(tpl.categoryId) : null);
    setMemo(tpl.memo);
    setInfo(tpl.info);
    setTags(tpl.tags);
    setIsSplit(tpl.isSplit);
    setSplits(
      tpl.splits?.map((s) => ({
        categoryId: s.categoryId ? String(s.categoryId) : null,
        amount: minorToInput(Math.abs(s.amount), fd, dc),
      })) ?? [],
    );
  };

  const saveTemplate = useMutation({
    mutationFn: (name: string) =>
      createTemplate(walletId, {
        name,
        accountId: account.id,
        amount: totalMinor,
        paymentMode: Number(paymentMode),
        status: Number(status),
        info,
        memo,
        payeeId: payeeId ? Number(payeeId) : null,
        categoryId: isSplit ? null : categoryId ? Number(categoryId) : null,
        tags,
        splits: isSplit
          ? splits.map<Split>((s) => ({
              categoryId: s.categoryId ? Number(s.categoryId) : null,
              amount: (parseAmount(s.amount, fd, dc) ?? 0) * sign,
            }))
          : [],
      }),
    onSuccess: () => {
      onTemplateSaved();
      notifications.show({ color: "green", message: t("templates.saved") });
    },
    onError: (err: unknown) =>
      notifications.show({
        color: "red",
        message: err instanceof ApiError ? err.message : String(err),
      }),
  });

  const payeeOptions = (payeesQuery.data ?? []).map((p) => ({
    value: String(p.id),
    label: p.name,
  }));
  const categoryOptions = useMemo(
    () =>
      (categoriesQuery.data ?? []).map((c) => ({
        value: String(c.id),
        label: c.parentId
          ? `   ${(categoriesQuery.data ?? []).find((p) => p.id === c.parentId)?.name ?? ""} › ${c.name}`
          : c.name,
      })),
    [categoriesQuery.data],
  );
  const vehicleOptions = (vehiclesQuery.data ?? []).map((v) => ({
    value: String(v.id),
    label: v.name,
  }));

  // Apply-on-manual: when adding a transaction, the first matching rule fills
  // any empty payee/category/payment-mode fields (the user can still override).
  const runSuggest = async () => {
    if (editing) return;
    const name = (payeesQuery.data ?? []).find((p) => String(p.id) === payeeId)?.name ?? "";
    if (!memo.trim() && !name) return;
    try {
      const res = await suggestAssignment(walletId, memo, name, account?.id ?? 0);
      if (!res.matched) return;
      if (!payeeId && res.payeeId != null) setPayeeId(String(res.payeeId));
      if (!isSplit && !categoryId && res.categoryId != null) setCategoryId(String(res.categoryId));
      if (paymentMode === "0" && res.paymentMode != null) setPaymentMode(String(res.paymentMode));
      if (!info && res.info != null) setInfo(res.info);
    } catch {
      // suggestion is best-effort; ignore failures
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      size="lg"
      title={editing ? t("transactions.editTitle") : t("transactions.addTitle")}
    >
      <Stack>
        {!editing && templates.length > 0 && (
          <Select
            label={t("templates.apply")}
            placeholder={t("templates.applyPlaceholder")}
            data={templates.map((tpl) => ({ value: String(tpl.id), label: tpl.name }))}
            onChange={applyTemplate}
            searchable
            clearable
          />
        )}
        {duplicates.length > 0 && (
          <Alert color="yellow">
            {t("transactions.duplicateWarning", { count: duplicates.length })}
          </Alert>
        )}
        <Group grow>
          <TextInput
            type="date"
            label={t("transactions.date")}
            value={date}
            onChange={(e) => setDate(e.currentTarget.value)}
          />
          <SegmentedControl
            value={direction}
            onChange={(v) => setDirection(v as "expense" | "income")}
            data={[
              { value: "expense", label: t("transactions.expense") },
              { value: "income", label: t("transactions.income") },
            ]}
          />
        </Group>
        <Group grow>
          <TextInput
            label={t("transactions.amount")}
            value={amount}
            onChange={(e) => setAmount(e.currentTarget.value)}
            rightSection={<Text size="xs">{account.currencyCode}</Text>}
          />
          <Select
            label={t("transactions.paymentMode")}
            data={PAYMENT_MODES.map((m) => ({ value: String(m), label: t(`paymentModes.${m}`) }))}
            value={paymentMode}
            onChange={(v) => v && setPaymentMode(v)}
            allowDeselect={false}
          />
        </Group>
        <Select
          label={t("transactions.payee")}
          data={payeeOptions}
          value={payeeId}
          onChange={setPayeeId}
          clearable
          searchable
        />
        <Switch
          label={t("transactions.splitToggle")}
          checked={isSplit}
          onChange={(e) => setIsSplit(e.currentTarget.checked)}
        />
        {!isSplit ? (
          <Select
            label={t("transactions.category")}
            data={categoryOptions}
            value={categoryId}
            onChange={setCategoryId}
            clearable
            searchable
          />
        ) : (
          <Stack gap="xs">
            {splits.map((s, i) => (
              <Group key={i} grow>
                <Select
                  placeholder={t("transactions.category")}
                  data={categoryOptions}
                  value={s.categoryId}
                  onChange={(v) =>
                    setSplits((arr) => arr.map((x, j) => (j === i ? { ...x, categoryId: v } : x)))
                  }
                  searchable
                />
                <TextInput
                  placeholder={t("transactions.amount")}
                  value={s.amount}
                  onChange={(e) =>
                    setSplits((arr) =>
                      arr.map((x, j) => (j === i ? { ...x, amount: e.currentTarget.value } : x)),
                    )
                  }
                />
                <ActionIcon
                  variant="subtle"
                  color="red"
                  onClick={() => setSplits((arr) => arr.filter((_, j) => j !== i))}
                >
                  <IconTrash size={16} />
                </ActionIcon>
              </Group>
            ))}
            <Group justify="space-between">
              <Button
                size="xs"
                variant="default"
                onClick={() => setSplits((arr) => [...arr, { categoryId: null, amount: "" }])}
              >
                {t("transactions.addSplit")}
              </Button>
              {splitMismatch && (
                <Text size="sm" c="red">
                  {t("transactions.splitMismatch")} (
                  <NumberFormatter
                    value={splitSumMinor / Math.pow(10, fd)}
                    decimalScale={fd}
                  /> / <NumberFormatter value={totalMinor / Math.pow(10, fd)} decimalScale={fd} />)
                </Text>
              )}
            </Group>
          </Stack>
        )}
        <TagsInput
          label={t("transactions.tags")}
          data={tagsQuery.data ?? []}
          value={tags}
          onChange={setTags}
        />
        {vehicleOptions.length > 0 && (
          <Select
            label={t("transactions.vehicle")}
            data={vehicleOptions}
            value={vehicleId}
            onChange={setVehicleId}
            clearable
            searchable
          />
        )}
        <Group grow>
          <Select
            label={t("transactions.status")}
            data={STATUSES.map((st) => ({ value: String(st), label: t(`status.${st}`) }))}
            value={status}
            onChange={(v) => v && setStatus(v)}
            allowDeselect={false}
          />
          <TextInput
            label={t("transactions.info")}
            value={info}
            onChange={(e) => setInfo(e.currentTarget.value)}
          />
        </Group>
        <TextInput
          label={t("transactions.memo")}
          value={memo}
          onChange={(e) => setMemo(e.currentTarget.value)}
          onBlur={() => void runSuggest()}
        />
        {editing && <AttachmentsField walletId={walletId} transactionId={editing.id} />}
        <Group justify="space-between">
          <Button
            variant="subtle"
            color="gray"
            leftSection={<IconDeviceFloppy size={16} />}
            loading={saveTemplate.isPending}
            disabled={totalMinor === 0 && !isSplit}
            onClick={() => {
              const name = window.prompt(t("templates.namePrompt"));
              if (name && name.trim()) saveTemplate.mutate(name.trim());
            }}
          >
            {t("templates.saveAs")}
          </Button>
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              {t("transactions.cancel")}
            </Button>
            <Button
              onClick={() => save.mutate()}
              loading={save.isPending}
              disabled={!date || totalMinor === 0 || splitMismatch}
            >
              {t("transactions.save")}
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}
