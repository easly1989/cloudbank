import { Button, Card, Group, SegmentedControl, Select, TagsInput, TextInput } from "@mantine/core";
import { IconPlus } from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  createTransaction,
  listCategories,
  listPayees,
  listTags,
  listTemplates,
  type Account,
} from "../api/client";
import { formatMinor } from "../money";
import { STATUSES } from "../transactionEnums";
import { useAmountParser } from "../useAmountParser";
import classes from "./QuickAdd.module.css";

// QuickAdd is a one-line transaction entry: pick a payee (its default category
// and payment mode are applied automatically), type an amount, and add without
// leaving the page. Used by the register (Transactions) and the dashboard.
export function QuickAdd({
  walletId,
  account,
  onAdded,
  onError,
}: {
  walletId: number;
  account: Account;
  onAdded: () => void;
  onError: (err: unknown) => void;
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
  const templatesQuery = useQuery({
    queryKey: ["templates", walletId],
    queryFn: () => listTemplates(walletId),
  });
  const templates = useMemo(
    () => (templatesQuery.data ?? []).filter((x) => !x.isTransfer),
    [templatesQuery.data],
  );
  const fd = account.currencyFracDigits;
  const dc = account.currencyDecimalChar;

  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [payeeId, setPayeeId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [direction, setDirection] = useState<"expense" | "income">("expense");
  const [memo, setMemo] = useState("");
  const [status, setStatus] = useState("0");
  const [tags, setTags] = useState<string[]>([]);
  const [templatePick, setTemplatePick] = useState<string | null>(null);

  // Pre-fill the row from a saved template (the bound account is kept; the
  // template's transaction details are applied).
  const applyTemplate = (v: string | null) => {
    setTemplatePick(v);
    const m = templates.find((x) => String(x.id) === v);
    if (!m) return;
    setDirection(m.amount < 0 ? "expense" : "income");
    setAmount(
      m.amount === 0
        ? ""
        : formatMinor(Math.abs(m.amount), {
            fracDigits: fd,
            decimalChar: dc,
            groupChar: "",
            symbol: "",
            symbolPrefix: false,
          }),
    );
    setPayeeId(m.payeeId != null ? String(m.payeeId) : null);
    setCategoryId(m.categoryId != null ? String(m.categoryId) : null);
    setMemo(m.memo);
    setStatus(String(m.status));
    setTags(m.tags ?? []);
  };

  const onPayee = (v: string | null) => {
    setPayeeId(v);
    const p = (payeesQuery.data ?? []).find((x) => String(x.id) === v);
    if (p?.defaultCategoryId != null) setCategoryId(String(p.defaultCategoryId));
  };

  const add = useMutation({
    mutationFn: () => {
      const p = (payeesQuery.data ?? []).find((x) => String(x.id) === payeeId);
      return createTransaction(walletId, {
        accountId: account.id,
        date,
        amount: (parseAmount(amount, fd, dc) ?? 0) * (direction === "expense" ? -1 : 1),
        // A chosen payee's own default wins; otherwise the account's default.
        paymentMode: p?.defaultPaymentMode ?? account.defaultPaymentMode,
        status: Number(status),
        payeeId: payeeId ? Number(payeeId) : null,
        categoryId: categoryId ? Number(categoryId) : null,
        memo,
        tags,
      });
    },
    onSuccess: () => {
      setAmount("");
      setPayeeId(null);
      setCategoryId(null);
      setMemo("");
      setStatus("0");
      setTags([]);
      setTemplatePick(null);
      onAdded();
    },
    onError,
  });

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
  const canAdd = !!date && (parseAmount(amount, fd, dc) ?? 0) > 0;

  return (
    <Card withBorder padding="xs">
      <Group gap="xs" align="flex-end" wrap="wrap">
        {templates.length > 0 && (
          <Select
            placeholder={t("templates.apply")}
            aria-label={t("templates.apply")}
            data={templates.map((x) => ({ value: String(x.id), label: x.name }))}
            value={templatePick}
            onChange={applyTemplate}
            clearable
            searchable
            w={160}
          />
        )}
        <TextInput
          type="date"
          aria-label={t("transactions.date")}
          value={date}
          onChange={(e) => setDate(e.currentTarget.value)}
          w={150}
        />
        <Select
          placeholder={t("transactions.payee")}
          data={(payeesQuery.data ?? []).map((p) => ({ value: String(p.id), label: p.name }))}
          value={payeeId}
          onChange={onPayee}
          clearable
          searchable
          style={{ flex: "1 1 120px", minWidth: 100 }}
        />
        <Select
          placeholder={t("transactions.category")}
          data={categoryOptions}
          value={categoryId}
          onChange={setCategoryId}
          clearable
          searchable
          style={{ flex: "1 1 120px", minWidth: 100 }}
        />
        <TextInput
          placeholder={t("transactions.memo")}
          aria-label={t("transactions.memo")}
          value={memo}
          onChange={(e) => setMemo(e.currentTarget.value)}
          style={{ flex: "1 1 140px", minWidth: 110 }}
        />
        <TagsInput
          placeholder={t("transactions.tags")}
          aria-label={t("transactions.tags")}
          data={tagsQuery.data ?? []}
          value={tags}
          onChange={setTags}
          clearable
          w={170}
          // Fixed width (no flex grow/shrink) and min-width:0 so the field can
          // never widen to fit the pills — adding a tag must not reflow the row.
          // The pills scroll horizontally inside it (see the CSS module).
          style={{ flex: "0 0 170px", minWidth: 0 }}
          styles={{ input: { minWidth: 0 } }}
          classNames={{ pillsList: classes.scrollPills }}
        />
        <Select
          aria-label={t("transactions.status")}
          data={STATUSES.map((s) => ({ value: String(s), label: t(`status.${s}`) }))}
          value={status}
          onChange={(v) => v && setStatus(v)}
          allowDeselect={false}
          w={140}
        />
        <SegmentedControl
          value={direction}
          onChange={(v) => setDirection(v as "expense" | "income")}
          data={[
            { value: "expense", label: "−" },
            { value: "income", label: "+" },
          ]}
        />
        <TextInput
          placeholder={t("transactions.amount")}
          aria-label={t("transactions.amount")}
          value={amount}
          onChange={(e) => setAmount(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canAdd) add.mutate();
          }}
          w={130}
        />
        <Button
          leftSection={<IconPlus size={16} />}
          onClick={() => add.mutate()}
          loading={add.isPending}
          disabled={!canAdd}
        >
          {t("register.quickAdd")}
        </Button>
      </Group>
    </Card>
  );
}
