import { Button, Group, Modal, Select, Stack, Text, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconDeviceFloppy } from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { errorColor } from "../amountTone";

import {
  ApiError,
  type Account,
  type Template,
  type TransferInput,
  createTemplate,
  createTransfer,
  getTransfer,
  updateTransfer,
} from "../api/client";
import { minorToInput } from "../money";
import { STATUSES } from "../transactionEnums";
import { useAmountParser } from "../useAmountParser";
import { todayCivil } from "../civilDate";

export function TransferForm({
  opened,
  onClose,
  walletId,
  accounts,
  editingId,
  onSaved,
  templates,
  onTemplateSaved,
}: {
  opened: boolean;
  onClose: () => void;
  walletId: number;
  accounts: Account[];
  editingId: number | null;
  onSaved: () => void;
  templates: Template[];
  onTemplateSaved: () => void;
}) {
  const { t } = useTranslation();
  const parseAmount = useAmountParser();

  const transferQuery = useQuery({
    queryKey: ["transfer", walletId, editingId],
    queryFn: () => getTransfer(walletId, editingId as number),
    enabled: opened && editingId != null,
  });
  const loaded = transferQuery.data;

  const [fromId, setFromId] = useState<string | null>(null);
  const [toId, setToId] = useState<string | null>(null);
  const [date, setDate] = useState("");
  const [fromAmount, setFromAmount] = useState("");
  const [toAmount, setToAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [status, setStatus] = useState("0");

  // Seed the fields when the drawer opens, during render rather than in an
  // effect: an effect runs after the drawer is on screen, so the reader gets one
  // frame of the previous transfer.
  //
  // Editing waits for the transfer itself, which arrives after the drawer does —
  // hence the null key while it is still in flight, and again while closed,
  // which is what makes reopening the same transfer re-seed it.
  const seedKey = !opened ? null : editingId == null ? "new" : loaded ? `edit:${loaded.id}` : null;
  const [seededFor, setSeededFor] = useState<string | null>(null);
  if (seedKey !== seededFor) {
    setSeededFor(seedKey);
    if (seedKey !== null && loaded && editingId != null) {
      const from = accounts.find((a) => a.id === loaded.fromAccountId);
      const to = accounts.find((a) => a.id === loaded.toAccountId);
      setFromId(String(loaded.fromAccountId));
      setToId(String(loaded.toAccountId));
      setDate(loaded.date);
      setFromAmount(
        from
          ? minorToInput(loaded.fromAmount, from.currencyFracDigits, from.currencyDecimalChar)
          : "",
      );
      setToAmount(
        to ? minorToInput(loaded.toAmount, to.currencyFracDigits, to.currencyDecimalChar) : "",
      );
      setMemo(loaded.memo);
      setStatus(String(loaded.status));
    } else if (seedKey === "new") {
      setFromId(accounts[0] ? String(accounts[0].id) : null);
      setToId(accounts[1] ? String(accounts[1].id) : null);
      setDate(todayCivil());
      setFromAmount("");
      setToAmount("");
      setMemo("");
      setStatus("0");
    }
  }

  const fromAccount = accounts.find((a) => String(a.id) === fromId);
  const toAccount = accounts.find((a) => String(a.id) === toId);
  const crossCurrency =
    !!fromAccount && !!toAccount && fromAccount.currencyId !== toAccount.currencyId;
  const fromMinor = fromAccount
    ? (parseAmount(fromAmount, fromAccount.currencyFracDigits, fromAccount.currencyDecimalChar) ??
      0)
    : 0;
  const toMinor = toAccount
    ? (parseAmount(toAmount, toAccount.currencyFracDigits, toAccount.currencyDecimalChar) ?? 0)
    : 0;

  const save = useMutation({
    mutationFn: () => {
      const body: TransferInput = {
        fromAccountId: Number(fromId),
        toAccountId: Number(toId),
        date,
        fromAmount: fromMinor,
        toAmount: crossCurrency ? toMinor : undefined,
        memo,
        status: Number(status),
      };
      return editingId != null
        ? updateTransfer(walletId, editingId, body)
        : createTransfer(walletId, body);
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

  // Apply a transfer template: pre-fill from/to accounts, amount and memo.
  const applyTemplate = (id: string | null) => {
    const tpl = templates.find((x) => String(x.id) === id);
    if (!tpl || tpl.accountId == null || tpl.toAccountId == null) return;
    const from = accounts.find((a) => a.id === tpl.accountId);
    const to = accounts.find((a) => a.id === tpl.toAccountId);
    setFromId(String(tpl.accountId));
    setToId(String(tpl.toAccountId));
    setMemo(tpl.memo);
    setStatus(String(tpl.status));
    const mag = Math.abs(tpl.amount);
    if (from) setFromAmount(minorToInput(mag, from.currencyFracDigits, from.currencyDecimalChar));
    if (to) setToAmount(minorToInput(mag, to.currencyFracDigits, to.currencyDecimalChar));
  };

  const saveTemplate = useMutation({
    mutationFn: (name: string) =>
      createTemplate(walletId, {
        name,
        isTransfer: true,
        accountId: fromId ? Number(fromId) : null,
        toAccountId: toId ? Number(toId) : null,
        amount: -fromMinor,
        memo,
        status: Number(status),
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

  const accountOptions = accounts.map((a) => ({ value: String(a.id), label: a.name }));
  const invalid =
    !date ||
    !fromId ||
    !toId ||
    fromId === toId ||
    fromMinor <= 0 ||
    (crossCurrency && toMinor <= 0);

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      size="lg"
      title={editingId != null ? t("transfers.editTitle") : t("transfers.addTitle")}
    >
      <Stack>
        {editingId == null && templates.length > 0 && (
          <Select
            label={t("templates.apply")}
            placeholder={t("templates.applyPlaceholder")}
            data={templates.map((tpl) => ({ value: String(tpl.id), label: tpl.name }))}
            onChange={applyTemplate}
            searchable
            clearable
          />
        )}
        <Group grow>
          <Select
            label={t("transfers.from")}
            data={accountOptions}
            value={fromId}
            onChange={setFromId}
            disabled={editingId != null}
            allowDeselect={false}
            searchable
          />
          <Select
            label={t("transfers.to")}
            data={accountOptions}
            value={toId}
            onChange={setToId}
            disabled={editingId != null}
            allowDeselect={false}
            searchable
          />
        </Group>
        {fromId != null && fromId === toId && (
          <Text size="sm" c={errorColor}>
            {t("transfers.sameAccount")}
          </Text>
        )}
        <Group grow>
          <TextInput
            type="date"
            label={t("transactions.date")}
            value={date}
            onChange={(e) => setDate(e.currentTarget.value)}
          />
          <TextInput
            label={crossCurrency ? t("transfers.fromAmount") : t("transactions.amount")}
            value={fromAmount}
            onChange={(e) => setFromAmount(e.currentTarget.value)}
            rightSection={<Text size="xs">{fromAccount?.currencyCode}</Text>}
          />
        </Group>
        {crossCurrency && (
          <TextInput
            label={t("transfers.toAmount")}
            value={toAmount}
            onChange={(e) => setToAmount(e.currentTarget.value)}
            rightSection={<Text size="xs">{toAccount?.currencyCode}</Text>}
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
            label={t("transactions.memo")}
            value={memo}
            onChange={(e) => setMemo(e.currentTarget.value)}
          />
        </Group>
        <Group justify="space-between">
          <Button
            variant="subtle"
            color="gray"
            leftSection={<IconDeviceFloppy size={16} />}
            loading={saveTemplate.isPending}
            disabled={!fromId || !toId || fromId === toId || fromMinor <= 0}
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
            <Button onClick={() => save.mutate()} loading={save.isPending} disabled={invalid}>
              {t("transactions.save")}
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}
