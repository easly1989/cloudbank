import {
  ActionIcon,
  Button,
  Collapse,
  Group,
  NumberInput,
  Select,
  Switch,
  Text,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconChevronDown, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  ApiError,
  createSchedule,
  createTemplate,
  listAccounts,
  listCategories,
  listPayees,
  listTemplates,
  updateSchedule,
  updateTemplate,
  type Schedule,
  type ScheduleInput,
  type ScheduleUnit,
  type Split,
  type Template,
  type TemplateInput,
} from "../../api/client";
import { amountColor } from "../../amountTone";
import { todayCivil } from "../../civilDate";
import { SideSheet } from "../../components/SideSheet";
import { ENTRY_SHEET } from "../../components/entrySheetTheme";
import { minorToInput } from "../../money";
import { PAYMENT_MODES } from "../../transactionEnums";
import { useAmountParser } from "../../useAmountParser";

const UNITS: ScheduleUnit[] = ["day", "week", "month", "year"];
const WEEKEND_MODES = [0, 1, 2, 3];

/**
 * A schedule in the sheet beside the page (#546): new, or opened from the list
 * or the calendar. What a schedule needs is in view — its name, the amount, the
 * account, how often and from when, and whether it registers itself — and the
 * rest waits under More details. It took over from the Bills page's quick
 * "Add bill" form, which asked for the same first five things.
 */
export function ScheduleSheet({
  opened,
  onClose,
  walletId,
  editing,
  onSaved,
  onDelete,
}: {
  opened: boolean;
  onClose: () => void;
  walletId: number;
  editing: Schedule | null;
  onSaved: () => void;
  onDelete: (s: Schedule) => void;
}) {
  const { t } = useTranslation();
  const parseAmount = useAmountParser();
  const templatesQuery = useQuery({
    queryKey: ["templates", walletId],
    queryFn: () => listTemplates(walletId),
    enabled: opened,
  });
  const accountsQuery = useQuery({
    queryKey: ["accounts", walletId],
    queryFn: () => listAccounts(walletId),
    enabled: opened,
  });
  const payeesQuery = useQuery({
    queryKey: ["payees", walletId],
    queryFn: () => listPayees(walletId),
    enabled: opened,
  });
  const categoriesQuery = useQuery({
    queryKey: ["categories", walletId],
    queryFn: () => listCategories(walletId),
    enabled: opened,
  });
  const templates = templatesQuery.data ?? [];
  const accounts = accountsQuery.data ?? [];
  const payees = payeesQuery.data ?? [];
  const categories = useMemo(() => categoriesQuery.data ?? [], [categoriesQuery.data]);

  // The transaction it registers (kept in a template of its own).
  const [name, setName] = useState("");
  const [accountId, setAccountId] = useState<string | null>(null);
  const [direction, setDirection] = useState<"expense" | "income">("expense");
  const [amount, setAmount] = useState("");
  const [payeeId, setPayeeId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [memo, setMemo] = useState("");
  const [paymentMode, setPaymentMode] = useState("0");
  // A transfer template (e.g. imported) can only have its amount/memo edited here.
  const [isTransfer, setIsTransfer] = useState(false);
  const [toAccountId, setToAccountId] = useState<number | null>(null);
  // A split template keeps its lines (#562): they are not edited here, so the
  // amount and the category are locked and the lines go back as they are.
  const [splits, setSplits] = useState<Split[]>([]);
  const isSplit = splits.length > 0;

  // Cadence.
  const [unit, setUnit] = useState<ScheduleUnit>("month");
  const [everyN, setEveryN] = useState<number | string>(1);
  const [nextDue, setNextDue] = useState("");
  const [weekendMode, setWeekendMode] = useState("0");
  const [limited, setLimited] = useState(false);
  const [remaining, setRemaining] = useState<number | string>(12);
  const [postAdvance, setPostAdvance] = useState<number | string>(0);
  const [autoPost, setAutoPost] = useState(true);
  const [more, setMore] = useState(false);

  const account = accounts.find((a) => String(a.id) === accountId);
  const fd = account?.currencyFracDigits ?? 2;
  const dc = account?.currencyDecimalChar ?? ".";

  const fillFromTemplate = (tpl: Template) => {
    const acc = accounts.find((a) => a.id === tpl.accountId);
    setName(tpl.name);
    setAccountId(tpl.accountId != null ? String(tpl.accountId) : null);
    setDirection(tpl.amount < 0 ? "expense" : "income");
    setAmount(
      tpl.amount === 0
        ? ""
        : minorToInput(
            Math.abs(tpl.amount),
            acc?.currencyFracDigits ?? 2,
            acc?.currencyDecimalChar ?? ".",
          ),
    );
    setPayeeId(tpl.payeeId != null ? String(tpl.payeeId) : null);
    setCategoryId(tpl.categoryId != null ? String(tpl.categoryId) : null);
    setMemo(tpl.memo);
    setPaymentMode(String(tpl.paymentMode));
    setIsTransfer(tpl.isTransfer);
    setToAccountId(tpl.toAccountId ?? null);
    setSplits(tpl.isSplit ? (tpl.splits ?? []) : []);
  };

  // Three things seed this sheet, and they do not all arrive at once: the
  // schedule itself is there the moment it opens, while the accounts list and
  // the schedule's own template come from queries that may resolve afterwards.
  // Each gets its own key, and each adopts during render rather than in an
  // effect — an effect runs after the sheet is on screen, so the reader gets a
  // frame of the previous schedule before the right one replaces it.
  //
  // The key is null while closed, which is what makes reopening the same
  // schedule seed it again instead of keeping whatever was typed last time.

  // 1. Opening: the recurrence fields, plus blank transaction fields for a new
  //    schedule.
  const openKey = opened ? (editing ? `edit:${editing.id}` : "new") : null;
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  if (openKey !== openedFor) {
    setOpenedFor(openKey);
    if (openKey !== null) {
      const e = editing;
      setUnit(e?.unit ?? "month");
      setEveryN(e?.everyN ?? 1);
      setNextDue(e?.nextDue ?? todayCivil());
      setWeekendMode(String(e?.weekendMode ?? 0));
      setLimited(e?.remaining != null);
      setRemaining(e?.remaining ?? 12);
      setPostAdvance(e?.postAdvance ?? 0);
      setAutoPost(e?.autoPost ?? true);
      setMore(false);
      if (!e) {
        setName("");
        setAccountId(accounts[0] ? String(accounts[0].id) : null);
        setDirection("expense");
        setAmount("");
        setPayeeId(null);
        setCategoryId(null);
        setMemo("");
        setPaymentMode("0");
        setIsTransfer(false);
        setToAccountId(null);
        setSplits([]);
      }
    }
  }

  // 2. The accounts list landing after the sheet opened: a new schedule needs a
  //    default account, and only if the reader has not already chosen one.
  const firstAccountKey = opened && !editing && accounts.length > 0 ? accounts[0].id : null;
  const [defaultedFrom, setDefaultedFrom] = useState<number | null>(null);
  if (firstAccountKey !== defaultedFrom) {
    setDefaultedFrom(firstAccountKey);
    if (firstAccountKey !== null && !accountId) setAccountId(String(firstAccountKey));
  }

  // 3. The schedule's own template landing after the sheet opened: it carries
  //    the transaction fields, which the schedule row does not.
  const editingTemplate =
    opened && editing ? (templates.find((tp) => tp.id === editing.templateId) ?? null) : null;
  const templateKey = editingTemplate ? `${editing?.id}:${editingTemplate.id}` : null;
  const [filledFrom, setFilledFrom] = useState<string | null>(null);
  if (templateKey !== filledFrom) {
    setFilledFrom(templateKey);
    if (editingTemplate) fillFromTemplate(editingTemplate);
  }

  const onPayee = (v: string | null) => {
    setPayeeId(v);
    const p = payees.find((x) => String(x.id) === v);
    if (p?.defaultCategoryId != null) setCategoryId(String(p.defaultCategoryId));
  };

  const buildTemplate = (): TemplateInput => {
    const minor = (parseAmount(amount, fd, dc) ?? 0) * (direction === "expense" ? -1 : 1);
    const payeeName = payees.find((x) => String(x.id) === payeeId)?.name;
    return {
      name: (name.trim() || memo || payeeName || t("schedules.untitled")).slice(0, 64),
      accountId: accountId ? Number(accountId) : null,
      amount: minor,
      paymentMode: Number(paymentMode),
      payeeId: payeeId ? Number(payeeId) : null,
      categoryId: isSplit ? null : categoryId ? Number(categoryId) : null,
      memo,
      isTransfer,
      toAccountId,
      splits: isSplit ? splits : undefined,
      // Not edited here, and a save replaces the whole template: sent as they
      // are, or they would be wiped (#560).
      status: editingTemplate?.status,
      info: editingTemplate?.info,
      tags: editingTemplate?.tags,
    };
  };

  const save = useMutation({
    mutationFn: async () => {
      const tplInput = buildTemplate();
      const tpl =
        editing != null
          ? await updateTemplate(walletId, editing.templateId, tplInput)
          : await createTemplate(walletId, tplInput);
      const body: ScheduleInput = {
        templateId: tpl.id,
        unit,
        everyN: Number(everyN) || 1,
        nextDue,
        weekendMode: Number(weekendMode),
        remaining: limited ? Number(remaining) : null,
        postAdvance: Number(postAdvance) || 0,
        autoPost,
      };
      return editing ? updateSchedule(walletId, editing.id, body) : createSchedule(walletId, body);
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
    () =>
      categories.map((c) => ({
        value: String(c.id),
        label: c.parentId
          ? `   ${categories.find((p) => p.id === c.parentId)?.name ?? ""} › ${c.name}`
          : c.name,
      })),
    [categories],
  );
  const splitNames = splits
    .map((sp) => categories.find((c) => c.id === sp.categoryId)?.name)
    .filter(Boolean)
    .join(", ");
  const canSave = !!accountId && (parseAmount(amount, fd, dc) ?? 0) > 0 && !!nextDue;
  const sign = direction === "expense" ? -1 : 1;

  return (
    <SideSheet
      opened={opened}
      onClose={onClose}
      testId="schedule-sheet"
      title={editing ? t("schedules.editTitle") : t("schedules.addTitle")}
      headerActions={
        editing && (
          <ActionIcon
            variant="subtle"
            color="red"
            size={ENTRY_SHEET.headerButton}
            aria-label={t("schedules.delete")}
            onClick={() => onDelete(editing)}
          >
            <IconTrash size={17} />
          </ActionIcon>
        )
      }
      foot={
        <>
          <Button variant="default" onClick={onClose}>
            {t("schedules.cancel")}
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!canSave}>
            {t("schedules.save")}
          </Button>
        </>
      }
    >
      {isTransfer && (
        <Text size="xs" c="dimmed">
          {t("schedules.transferNote")}
        </Text>
      )}
      {isSplit && (
        <Text size="xs" c="dimmed" data-testid="schedule-split-note">
          {t("schedules.splitNote", { count: splits.length })}
        </Text>
      )}
      <TextInput
        label={t("schedules.form.name")}
        placeholder={t("schedules.form.namePlaceholder")}
        value={name}
        onChange={(e) => setName(e.currentTarget.value)}
        data-autofocus
      />
      <TextInput
        className="cb-amount"
        label={t("transactions.amount")}
        value={amount}
        onChange={(e) => setAmount(e.currentTarget.value)}
        inputMode="decimal"
        disabled={isSplit}
        leftSection={
          <UnstyledButton
            className="cb-amount-sign"
            c={amountColor(sign)}
            disabled={isTransfer || isSplit}
            aria-label={t(
              direction === "expense" ? "schedules.form.isExpense" : "schedules.form.isIncome",
            )}
            onClick={() => setDirection((d) => (d === "expense" ? "income" : "expense"))}
          >
            {sign < 0 ? "−" : "+"}
          </UnstyledButton>
        }
        leftSectionWidth={ENTRY_SHEET.sign.section}
        leftSectionPointerEvents="all"
        rightSection={
          <Text size="xs" c="dimmed">
            {account?.currencyCode}
          </Text>
        }
        rightSectionWidth={48}
        styles={{ input: { color: amountColor(sign) } }}
      />
      <Select
        label={t("transactions.account")}
        data={accounts.map((a) => ({ value: String(a.id), label: a.name }))}
        value={accountId}
        onChange={setAccountId}
        disabled={isTransfer}
        allowDeselect={false}
        searchable
      />
      <Group grow gap={ENTRY_SHEET.pairGap} align="flex-start">
        <NumberInput label={t("schedules.everyN")} min={1} value={everyN} onChange={setEveryN} />
        <Select
          label={t("schedules.unit")}
          data={UNITS.map((u) => ({ value: u, label: t(`schedules.units.${u}`) }))}
          value={unit}
          onChange={(v) => v && setUnit(v as ScheduleUnit)}
          allowDeselect={false}
        />
      </Group>
      <TextInput
        type="date"
        label={t("schedules.nextDue")}
        value={nextDue}
        onChange={(e) => setNextDue(e.currentTarget.value)}
      />
      <Switch
        label={t("schedules.autoPost")}
        description={t("schedules.form.autoPostHint")}
        checked={autoPost}
        onChange={(e) => setAutoPost(e.currentTarget.checked)}
      />

      <UnstyledButton
        onClick={() => setMore((v) => !v)}
        aria-expanded={more}
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
        fw={600}
        fz={14}
        py={6}
      >
        {t("transactions.moreDetails")}
        <IconChevronDown
          size={16}
          style={{ transform: more ? "rotate(180deg)" : undefined, transition: "transform 150ms" }}
        />
      </UnstyledButton>
      <Collapse expanded={more}>
        <div style={{ display: "flex", flexDirection: "column", gap: ENTRY_SHEET.gap }}>
          {!editing && templates.length > 0 && (
            <Select
              label={t("schedules.fromTemplate")}
              placeholder={t("schedules.fromTemplatePlaceholder")}
              data={templates.map((tpl) => ({ value: String(tpl.id), label: tpl.name }))}
              value={null}
              onChange={(v) => {
                const tpl = templates.find((tp) => String(tp.id) === v);
                if (tpl) fillFromTemplate(tpl);
              }}
              searchable
              clearable
            />
          )}
          <Select
            label={t("transactions.payee")}
            data={payees.map((p) => ({ value: String(p.id), label: p.name }))}
            value={payeeId}
            onChange={onPayee}
            disabled={isTransfer}
            searchable
            clearable
          />
          <Select
            label={t("transactions.category")}
            data={categoryOptions}
            value={isSplit ? null : categoryId}
            onChange={setCategoryId}
            placeholder={
              isSplit ? t("schedules.splitCategories", { names: splitNames }) : undefined
            }
            disabled={isTransfer || isSplit}
            searchable
            clearable
          />
          <TextInput
            label={t("transactions.memo")}
            value={memo}
            onChange={(e) => setMemo(e.currentTarget.value)}
          />
          <Select
            label={t("transactions.paymentMode")}
            data={PAYMENT_MODES.map((m) => ({ value: String(m), label: t(`paymentModes.${m}`) }))}
            value={paymentMode}
            onChange={(v) => v && setPaymentMode(v)}
            allowDeselect={false}
            disabled={isTransfer}
          />
          <Select
            label={t("schedules.weekendMode")}
            data={WEEKEND_MODES.map((m) => ({
              value: String(m),
              label: t(`schedules.weekend.${m}`),
            }))}
            value={weekendMode}
            onChange={(v) => v && setWeekendMode(v)}
            allowDeselect={false}
          />
          <NumberInput
            label={t("schedules.postAdvance")}
            min={0}
            value={postAdvance}
            onChange={setPostAdvance}
          />
          <Switch
            label={t("schedules.limit")}
            checked={limited}
            onChange={(e) => setLimited(e.currentTarget.checked)}
          />
          {limited && (
            <NumberInput
              label={t("schedules.remaining")}
              min={1}
              value={remaining}
              onChange={setRemaining}
            />
          )}
        </div>
      </Collapse>
    </SideSheet>
  );
}
