import {
  ActionIcon,
  Alert,
  Button,
  Group,
  Menu,
  SegmentedControl,
  Select,
  TagsInput,
  Text,
  TextInput,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconDots } from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  ApiError,
  createTemplate,
  updateTemplate,
  type Account,
  type Category,
  type Payee,
  type Template,
  type TemplateInput,
} from "../../api/client";
import { SideSheet } from "../../components/SideSheet";
import { ENTRY_SHEET } from "../../components/entrySheetTheme";
import { minorToInput } from "../../money";
import { PAYMENT_MODES, STATUSES } from "../../transactionEnums";
import { useAmountParser } from "../../useAmountParser";
import { categoryLabel } from "../payees/payeeList";
import classes from "./templates.module.css";

/**
 * A template kept for quick entry, in the sheet beside the page (#560): new,
 * or opened from the list. Every field it fills in, in the entry sheet's order
 * — tags and info too, which the old form dropped on save. A split or a
 * transfer only has its name and memo changed here. Delete waits in the
 * header's menu.
 */
export function TemplateSheet({
  opened,
  onClose,
  walletId,
  editing,
  used,
  accounts,
  payees,
  categories,
  tags: knownTags,
  onSaved,
  onDelete,
}: {
  opened: boolean;
  onClose: () => void;
  walletId: number;
  editing: Template | null;
  /** How often it was used, in words; empty for a new one. */
  used: string;
  accounts: Account[];
  payees: Payee[];
  categories: Category[];
  /** The wallet's tag names, offered as they are typed. */
  tags: string[];
  onSaved: () => void;
  onDelete: (tpl: Template) => void;
}) {
  const { t } = useTranslation();
  const parseAmount = useAmountParser();

  const [name, setName] = useState("");
  const [accountId, setAccountId] = useState<string | null>(null);
  const [direction, setDirection] = useState<"expense" | "income">("expense");
  const [amount, setAmount] = useState("");
  const [payeeId, setPayeeId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [paymentMode, setPaymentMode] = useState("0");
  const [status, setStatus] = useState("0");
  const [memo, setMemo] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [info, setInfo] = useState("");

  // Seeded on opening, during render, so the sheet never shows a frame of the
  // template before; the key is null while closed, so reopening starts afresh.
  const openKey = opened ? String(editing?.id ?? "new") : null;
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  if (openKey !== openedFor) {
    setOpenedFor(openKey);
    if (openKey !== null) {
      const e = editing;
      const acc = e ? accounts.find((a) => a.id === e.accountId) : accounts[0];
      setName(e?.name ?? "");
      setAccountId(acc ? String(acc.id) : null);
      setDirection(e && e.amount > 0 ? "income" : "expense");
      setAmount(
        e && e.amount !== 0
          ? minorToInput(
              Math.abs(e.amount),
              acc?.currencyFracDigits ?? 2,
              acc?.currencyDecimalChar ?? ".",
            )
          : "",
      );
      setPayeeId(e?.payeeId != null ? String(e.payeeId) : null);
      setCategoryId(e?.categoryId != null ? String(e.categoryId) : null);
      setPaymentMode(String(e?.paymentMode ?? 0));
      setStatus(String(e?.status ?? 0));
      setMemo(e?.memo ?? "");
      setTags(e?.tags ?? []);
      setInfo(e?.info ?? "");
    }
  }

  // A split or a transfer carries more than these fields say: only its name
  // and memo change here, everything else is sent back as it is.
  const complex = !!(editing?.isSplit || editing?.isTransfer);
  const account = accounts.find((a) => String(a.id) === accountId);
  const fd = account?.currencyFracDigits ?? 2;
  const dc = account?.currencyDecimalChar ?? ".";

  const onPayee = (v: string | null) => {
    setPayeeId(v);
    const p = payees.find((x) => String(x.id) === v);
    if (p?.defaultCategoryId != null) setCategoryId(String(p.defaultCategoryId));
  };

  const save = useMutation({
    mutationFn: () => {
      // A save replaces the whole template, so every field is sent.
      const body: TemplateInput =
        complex && editing
          ? {
              name: name.trim(),
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
            }
          : {
              name: name.trim(),
              accountId: accountId ? Number(accountId) : null,
              amount: (parseAmount(amount, fd, dc) ?? 0) * (direction === "expense" ? -1 : 1),
              paymentMode: Number(paymentMode),
              status: Number(status),
              payeeId: payeeId ? Number(payeeId) : null,
              categoryId: categoryId ? Number(categoryId) : null,
              memo,
              tags,
              info,
            };
      return editing ? updateTemplate(walletId, editing.id, body) : createTemplate(walletId, body);
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

  const categoryOptions = useMemo(
    () => categories.map((c) => ({ value: String(c.id), label: categoryLabel(c, categories) })),
    [categories],
  );

  return (
    <SideSheet
      opened={opened}
      onClose={onClose}
      testId="template-sheet"
      title={editing ? editing.name : t("templates.create")}
      subtitle={editing ? used : undefined}
      headerActions={
        editing && (
          <Menu position="bottom-end" withinPortal>
            <Menu.Target>
              <ActionIcon
                variant="default"
                size={ENTRY_SHEET.headerButton}
                aria-label={t("templates.actionsFor", { name: editing.name })}
              >
                <IconDots size={17} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item color="red" onClick={() => onDelete(editing)}>
                {t("templates.delete")}
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        )
      }
      foot={
        <>
          <Button variant="default" onClick={onClose}>
            {t("transactions.cancel")}
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!name.trim()}>
            {t("transactions.save")}
          </Button>
        </>
      }
    >
      <TextInput
        label={t("templates.name")}
        required
        value={name}
        onChange={(e) => setName(e.currentTarget.value)}
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
            allowDeselect={false}
            searchable
          />
          <div className={classes.amountRow}>
            <SegmentedControl
              value={direction}
              onChange={(v) => setDirection(v as "expense" | "income")}
              aria-label={t("templates.direction")}
              classNames={{ root: classes.seg, label: classes.segLabel }}
              data={[
                { value: "expense", label: t("templates.out") },
                { value: "income", label: t("templates.in") },
              ]}
            />
            <TextInput
              label={t("transactions.amount")}
              value={amount}
              onChange={(e) => setAmount(e.currentTarget.value)}
              inputMode="decimal"
              rightSection={
                <Text size="xs" c="dimmed">
                  {account?.currencySymbol}
                </Text>
              }
              styles={{ input: { fontFamily: "var(--mantine-font-family-monospace)" } }}
            />
          </div>
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
          <Group grow gap={ENTRY_SHEET.pairGap} align="flex-start" wrap="nowrap">
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
          </Group>
        </>
      )}
      <TextInput
        label={t("transactions.memo")}
        value={memo}
        onChange={(e) => setMemo(e.currentTarget.value)}
      />
      {!complex && (
        <>
          <TagsInput
            label={t("transactions.tags")}
            placeholder={tags.length === 0 ? t("templates.addTag") : undefined}
            data={knownTags}
            value={tags}
            onChange={setTags}
          />
          <TextInput
            label={t("transactions.info")}
            value={info}
            onChange={(e) => setInfo(e.currentTarget.value)}
          />
        </>
      )}
      <span className={classes.note}>
        {editing ? t("templates.changeNote") : t("templates.newNote")}
      </span>
    </SideSheet>
  );
}
