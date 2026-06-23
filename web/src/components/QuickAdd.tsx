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
  type Account,
} from "../api/client";
import { parseMinor } from "../money";

const STATUSES = [0, 1, 2, 3, 4];

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
  const payeesQuery = useQuery({
    queryKey: ["payees", walletId],
    queryFn: () => listPayees(walletId),
  });
  const categoriesQuery = useQuery({
    queryKey: ["categories", walletId],
    queryFn: () => listCategories(walletId),
  });
  const tagsQuery = useQuery({ queryKey: ["tags", walletId], queryFn: () => listTags(walletId) });
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
        amount: (parseMinor(amount, fd, dc) ?? 0) * (direction === "expense" ? -1 : 1),
        paymentMode: p?.defaultPaymentMode ?? 0,
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
  const canAdd = !!date && (parseMinor(amount, fd, dc) ?? 0) > 0;

  return (
    <Card withBorder padding="xs">
      <Group gap="xs" align="flex-end" wrap="wrap">
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
          style={{ flex: "1 1 150px", minWidth: 120 }}
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
