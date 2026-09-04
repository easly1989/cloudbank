import { Button, Group, Modal, NumberInput, Select, Stack, Switch, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { ApiError, createSchedule, createTemplate, listAccounts } from "../api/client";

// nextDueForDayOfMonth returns the next occurrence (today or later) of a given
// day-of-month, clamped to the month's length, as YYYY-MM-DD.
function nextDueForDayOfMonth(dom: number): string {
  const now = new Date();
  const at = (year: number, month: number) => {
    const lastDay = new Date(year, month + 1, 0).getDate();
    return new Date(year, month, Math.min(dom, lastDay));
  };
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let d = at(now.getFullYear(), now.getMonth());
  if (d < today) d = at(now.getFullYear(), now.getMonth() + 1);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// BillQuickAddModal is the fast "add a bill" form on the Bills page: name, amount,
// account and day-of-month create a monthly scheduled outflow (in the wallet's
// bills category when one is configured), optionally auto-posting.
export function BillQuickAddModal({
  opened,
  onClose,
  walletId,
  billsCategoryId,
  onAdded,
}: {
  opened: boolean;
  onClose: () => void;
  walletId: number;
  billsCategoryId?: number | null;
  onAdded: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const accountsQuery = useQuery({
    queryKey: ["accounts", walletId],
    queryFn: () => listAccounts(walletId),
    enabled: walletId > 0 && opened,
  });
  const accounts = useMemo(
    () => (accountsQuery.data ?? []).filter((a) => !a.closed),
    [accountsQuery.data],
  );

  const [name, setName] = useState("");
  const [amount, setAmount] = useState<number | string>("");
  const [accountId, setAccountId] = useState<string | null>(null);
  const [dayOfMonth, setDayOfMonth] = useState<number | string>(1);
  const [autoPost, setAutoPost] = useState(false);

  const account = accounts.find((a) => String(a.id) === accountId);
  const amountNum = typeof amount === "number" ? amount : parseFloat(amount);
  const domNum = typeof dayOfMonth === "number" ? dayOfMonth : parseInt(dayOfMonth, 10);
  const valid =
    name.trim() !== "" && account != null && amountNum > 0 && domNum >= 1 && domNum <= 31;

  const reset = () => {
    setName("");
    setAmount("");
    setAccountId(null);
    setDayOfMonth(1);
    setAutoPost(false);
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!account) throw new Error("no account");
      const minor = Math.round(amountNum * 10 ** account.currencyFracDigits);
      const tpl = await createTemplate(walletId, {
        name: name.trim(),
        accountId: account.id,
        amount: -minor, // a bill is an outflow
        categoryId: billsCategoryId ?? undefined,
        paymentMode: account.defaultPaymentMode || undefined,
      });
      await createSchedule(walletId, {
        templateId: tpl.id,
        unit: "month",
        everyN: 1,
        nextDue: nextDueForDayOfMonth(domNum),
        autoPost,
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["bills", walletId] });
      void qc.invalidateQueries({ queryKey: ["schedules", walletId] });
      void qc.invalidateQueries({ queryKey: ["templates", walletId] });
      notifications.show({ color: "green", message: t("bills.added"), autoClose: 1600 });
      reset();
      onAdded();
      onClose();
    },
    onError: (err: unknown) =>
      notifications.show({
        color: "red",
        message: err instanceof ApiError ? err.message : String(err),
      }),
  });

  return (
    <Modal opened={opened} onClose={onClose} title={t("bills.addTitle")} centered>
      <Stack>
        <TextInput
          label={t("bills.form.name")}
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          required
          data-autofocus
        />
        <NumberInput
          label={t("bills.form.amount")}
          description={t("bills.form.amountHint")}
          value={amount}
          onChange={setAmount}
          min={0}
          decimalScale={account?.currencyFracDigits ?? 2}
          thousandSeparator=" "
          required
        />
        <Select
          label={t("bills.form.account")}
          data={accounts.map((a) => ({ value: String(a.id), label: a.name }))}
          value={accountId}
          onChange={setAccountId}
          searchable
          required
        />
        <NumberInput
          label={t("bills.form.dayOfMonth")}
          description={t("bills.form.dayOfMonthHint")}
          value={dayOfMonth}
          onChange={setDayOfMonth}
          min={1}
          max={31}
          clampBehavior="strict"
          allowDecimal={false}
          required
        />
        <Switch
          label={t("bills.form.autoPost")}
          description={t("bills.form.autoPostHint")}
          checked={autoPost}
          onChange={(e) => setAutoPost(e.currentTarget.checked)}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t("bills.cancel")}
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!valid}>
            {t("bills.form.submit")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
