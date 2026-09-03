import {
  ActionIcon,
  Alert,
  Button,
  Group,
  Input,
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
import { IconDeviceFloppy, IconSparkles, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
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
  getAISettings,
  listCategories,
  listPayees,
  listTags,
  listVehicles,
  parseEntry,
  suggestAssignment,
  suggestCategory,
  updateTransaction,
} from "../api/client";
import { minorToInput } from "../money";
import { PAYMENT_MODES, STATUSES } from "../transactionEnums";
import { useAmountParser } from "../useAmountParser";
import { AttachmentsField } from "./AttachmentsField";

// How a save resolves: close the modal, keep the fields for a similar entry, or
// clear the fields for a fresh one. Editing always uses "close".
type SaveMode = "close" | "keep" | "new";

export function TransactionForm({
  opened,
  onClose,
  walletId,
  account,
  editing,
  duplicate,
  onSaved,
  templates,
  onTemplateSaved,
}: {
  opened: boolean;
  onClose: () => void;
  walletId: number;
  account: Account;
  editing: Transaction | null;
  /** Pre-fill a NEW transaction from this row (create, not update). */
  duplicate?: Transaction | null;
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

  // Opt-in AI category suggestion, shown only when the user has enabled and
  // keyed a provider. It fills the category from the current payee/memo/amount.
  const aiSettings = useQuery({
    queryKey: ["aiSettings"],
    queryFn: getAISettings,
    staleTime: 60_000,
  });
  const aiEnabled = !!(aiSettings.data?.enabled && aiSettings.data?.hasKey);
  const payeeName = useMemo(
    () => payeesQuery.data?.find((p) => String(p.id) === payeeId)?.name ?? "",
    [payeesQuery.data, payeeId],
  );
  const suggest = useMutation({
    mutationFn: () => suggestCategory(walletId, { payee: payeeName, memo, amount }),
    onSuccess: (res) => {
      if (res.category) setCategoryId(String(res.category.id));
      else notifications.show({ color: "gray", message: t("ai.noSuggestion") });
    },
    onError: (err: unknown) =>
      notifications.show({
        color: "red",
        message: err instanceof ApiError ? err.message : String(err),
      }),
  });

  // Natural-language quick entry: describe a transaction and let the model fill
  // the fields. Only unmatched names are left blank — never invented.
  const [quickText, setQuickText] = useState("");
  const parse = useMutation({
    mutationFn: () => parseEntry(walletId, quickText.trim()),
    onSuccess: (res) => {
      const e = res.entry;
      if (!e) {
        notifications.show({ color: "gray", message: t("ai.noParse") });
        return;
      }
      if (e.amount) setAmount(e.amount);
      setDirection(e.direction);
      if (e.date) setDate(e.date);
      if (e.memo) setMemo(e.memo);
      if (e.categoryId != null) setCategoryId(String(e.categoryId));
      if (e.payeeId != null) setPayeeId(String(e.payeeId));
      setQuickText("");
    },
    onError: (err: unknown) =>
      notifications.show({
        color: "red",
        message: err instanceof ApiError ? err.message : String(err),
      }),
  });

  // Save-mode support: modeRef carries the clicked button's intent into the
  // (async) mutation success; savingMode drives which button shows loading;
  // amountRef refocuses the amount for the next entry; savedMsg is announced.
  const modeRef = useRef<SaveMode>("close");
  const [savingMode, setSavingMode] = useState<SaveMode | null>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const [savedMsg, setSavedMsg] = useState("");
  // Snapshot of the form as opened, to detect unsaved edits (dirty) for the
  // discard guard on Cancel / ✕ / Escape.
  const initialRef = useRef("");
  const snapshot = () =>
    JSON.stringify({
      date,
      direction,
      amount,
      paymentMode,
      status,
      payeeId,
      categoryId,
      vehicleId,
      memo,
      info,
      tags,
      isSplit,
      splits,
    });
  const pulse = () => {
    document
      .querySelector<HTMLElement>(".txnFormContent")
      ?.animate(
        [
          { boxShadow: "0 8px 30px rgba(0,0,0,.3), 0 0 0 0 rgba(18,184,134,.7)" },
          { boxShadow: "0 8px 30px rgba(0,0,0,.3), 0 0 0 12px rgba(18,184,134,0)" },
        ],
        { duration: 750, easing: "ease-out" },
      );
  };

  useEffect(() => {
    if (!opened) return;
    // Edit an existing transaction, or pre-fill a new one from a duplicated row.
    const e = editing ?? duplicate ?? null;
    const isDup = !editing && duplicate != null;
    // Build the initial values once, so we can both seed the fields and remember
    // them for dirty detection. New transactions pre-fill the account's default
    // payment mode; editing keeps the stored one (a picked payee's default still
    // overrides). A duplicate starts uncleared.
    const init = {
      date: e?.date ?? new Date().toISOString().slice(0, 10),
      direction: ((e?.amount ?? -1) < 0 ? "expense" : "income") as "expense" | "income",
      amount: e ? minorToInput(Math.abs(e.amount), fd, dc) : "",
      paymentMode: String(e?.paymentMode ?? account.defaultPaymentMode),
      status: String(isDup ? 0 : (e?.status ?? 0)),
      payeeId: e?.payeeId ? String(e.payeeId) : null,
      categoryId: e?.categoryId ? String(e.categoryId) : null,
      vehicleId: e?.vehicleId ? String(e.vehicleId) : null,
      memo: e?.memo ?? "",
      info: e?.info ?? "",
      tags: e?.tags ?? [],
      isSplit: e?.isSplit ?? false,
      splits:
        e?.splits?.map((s) => ({
          categoryId: s.categoryId ? String(s.categoryId) : null,
          amount: minorToInput(Math.abs(s.amount), fd, dc),
        })) ?? [],
    };
    setDate(init.date);
    setDirection(init.direction);
    setAmount(init.amount);
    setPaymentMode(init.paymentMode);
    setStatus(init.status);
    setPayeeId(init.payeeId);
    setCategoryId(init.categoryId);
    setVehicleId(init.vehicleId);
    setMemo(init.memo);
    setInfo(init.info);
    setTags(init.tags);
    setIsSplit(init.isSplit);
    setSplits(init.splits);
    initialRef.current = JSON.stringify(init);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, editing?.id, duplicate?.id]);

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
      const mode = modeRef.current;
      if (mode === "close") {
        onClose();
        return;
      }
      // Keep the modal open for another entry: "new" clears the fields, "keep"
      // leaves them for a similar entry. Flash the border, toast, announce, refocus
      // — so the save clearly registered even though the modal stayed put.
      if (mode === "new") resetFields();
      pulse();
      notifications.show({ color: "green", message: t("transactions.saved"), autoClose: 1400 });
      setSavedMsg(t(mode === "new" ? "transactions.savedNew" : "transactions.savedKeepOpen"));
      amountRef.current?.focus();
      amountRef.current?.select();
    },
    onError: (err: unknown) =>
      notifications.show({
        color: "red",
        message: err instanceof ApiError ? err.message : String(err),
      }),
  });

  // Reset the form to the blank new-transaction defaults (used by "Save"), and
  // rebase the dirty snapshot so the just-cleared form isn't flagged as edited.
  const resetFields = () => {
    const init = {
      date: new Date().toISOString().slice(0, 10),
      direction: "expense" as "expense" | "income",
      amount: "",
      paymentMode: String(account.defaultPaymentMode),
      status: "0",
      payeeId: null as string | null,
      categoryId: null as string | null,
      vehicleId: null as string | null,
      memo: "",
      info: "",
      tags: [] as string[],
      isSplit: false,
      splits: [] as { categoryId: string | null; amount: string }[],
    };
    setDate(init.date);
    setDirection(init.direction);
    setAmount(init.amount);
    setPaymentMode(init.paymentMode);
    setStatus(init.status);
    setPayeeId(init.payeeId);
    setCategoryId(init.categoryId);
    setVehicleId(init.vehicleId);
    setMemo(init.memo);
    setInfo(init.info);
    setTags(init.tags);
    setIsSplit(init.isSplit);
    setSplits(init.splits);
    initialRef.current = JSON.stringify(init);
  };

  // Save, resolving the modal per mode (close / keep fields / clear fields).
  const submit = (mode: SaveMode) => {
    modeRef.current = mode;
    setSavingMode(mode);
    save.mutate();
  };

  // True once the form differs from how it opened — drives the red Cancel and
  // the discard confirmation.
  const dirty = opened && snapshot() !== initialRef.current;

  // Close, warning first if there are unsaved edits (Cancel / ✕ / Escape).
  const requestClose = () => {
    if (dirty && !window.confirm(t("transactions.discardConfirm"))) return;
    onClose();
  };

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
      onClose={requestClose}
      size="lg"
      classNames={{ content: "txnFormContent", inner: "txnFormInner" }}
      title={editing ? t("transactions.editTitle") : t("transactions.addTitle")}
    >
      <Stack>
        {/* Natural-language quick entry (only when AI is enabled). */}
        {aiEnabled && !editing && (
          <TextInput
            label={t("ai.quickEntry")}
            placeholder={t("ai.quickEntryPlaceholder")}
            value={quickText}
            onChange={(e) => setQuickText(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (quickText.trim()) parse.mutate();
              }
            }}
            rightSection={
              <ActionIcon
                variant="subtle"
                color="grape"
                aria-label={t("ai.quickEntryRun")}
                loading={parse.isPending}
                disabled={!quickText.trim()}
                onClick={() => parse.mutate()}
              >
                <IconSparkles size={16} />
              </ActionIcon>
            }
          />
        )}
        {/* Template picker + "Save as template" share the top row. */}
        {!editing && (
          <Group align="flex-end" gap="xs" wrap="nowrap">
            {templates.length > 0 && (
              <Select
                label={t("templates.apply")}
                placeholder={t("templates.applyPlaceholder")}
                data={templates.map((tpl) => ({ value: String(tpl.id), label: tpl.name }))}
                onChange={applyTemplate}
                searchable
                clearable
                style={{ flex: 1, minWidth: 0 }}
              />
            )}
            <Button
              variant="subtle"
              color="gray"
              leftSection={<IconDeviceFloppy size={16} />}
              loading={saveTemplate.isPending}
              disabled={totalMinor === 0 && !isSplit}
              ml={templates.length > 0 ? undefined : "auto"}
              onClick={() => {
                const name = window.prompt(t("templates.namePrompt"));
                if (name && name.trim()) saveTemplate.mutate(name.trim());
              }}
            >
              {t("templates.saveAs")}
            </Button>
          </Group>
        )}
        {duplicates.length > 0 && (
          <Alert color="yellow">
            {t("transactions.duplicateWarning", { count: duplicates.length })}
          </Alert>
        )}
        <Group grow align="flex-start">
          <TextInput
            type="date"
            label={t("transactions.date")}
            value={date}
            onChange={(e) => setDate(e.currentTarget.value)}
          />
          <Input.Wrapper label={t("transactions.type")}>
            <SegmentedControl
              fullWidth
              value={direction}
              onChange={(v) => setDirection(v as "expense" | "income")}
              data={[
                { value: "expense", label: t("transactions.expense") },
                { value: "income", label: t("transactions.income") },
              ]}
            />
          </Input.Wrapper>
        </Group>
        <Group grow>
          <TextInput
            ref={amountRef}
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
          <Group grow align="flex-start">
            <div>
              <Select
                label={t("transactions.category")}
                data={categoryOptions}
                value={categoryId}
                onChange={setCategoryId}
                clearable
                searchable
              />
              {aiEnabled && (
                <Button
                  variant="subtle"
                  size="compact-xs"
                  mt={4}
                  leftSection={<IconSparkles size={14} />}
                  loading={suggest.isPending}
                  disabled={!payeeName && !memo}
                  onClick={() => suggest.mutate()}
                >
                  {t("ai.suggestCategory")}
                </Button>
              )}
            </div>
            <TagsInput
              label={t("transactions.tags")}
              data={tagsQuery.data ?? []}
              value={tags}
              onChange={setTags}
            />
          </Group>
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
            <TagsInput
              label={t("transactions.tags")}
              data={tagsQuery.data ?? []}
              value={tags}
              onChange={setTags}
            />
          </Stack>
        )}
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
        <Group justify="flex-end" gap="xs">
          <Button
            variant={dirty ? "light" : "default"}
            color={dirty ? "red" : "gray"}
            onClick={requestClose}
          >
            {t("transactions.cancel")}
          </Button>
          {!editing && (
            <>
              <Button
                variant="light"
                onClick={() => submit("new")}
                loading={save.isPending && savingMode === "new"}
                disabled={!date || totalMinor === 0 || splitMismatch || save.isPending}
              >
                {t("transactions.save")}
              </Button>
              <Button
                variant="light"
                onClick={() => submit("keep")}
                loading={save.isPending && savingMode === "keep"}
                disabled={!date || totalMinor === 0 || splitMismatch || save.isPending}
              >
                {t("transactions.saveAndKeep")}
              </Button>
            </>
          )}
          <Button
            onClick={() => submit("close")}
            loading={save.isPending && savingMode === "close"}
            disabled={!date || totalMinor === 0 || splitMismatch || save.isPending}
          >
            {editing ? t("transactions.save") : t("transactions.saveClose")}
          </Button>
        </Group>
        <Text
          role="status"
          aria-live="polite"
          style={{
            position: "absolute",
            width: 1,
            height: 1,
            overflow: "hidden",
            clip: "rect(0 0 0 0)",
          }}
        >
          {savedMsg}
        </Text>
      </Stack>
    </Modal>
  );
}
