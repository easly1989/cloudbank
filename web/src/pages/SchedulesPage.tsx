import {
  ActionIcon,
  Badge,
  Button,
  Divider,
  Group,
  Modal,
  NumberInput,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
  IconPencil,
  IconPlayerPlay,
  IconPlayerSkipForward,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  ApiError,
  type Account,
  type Schedule,
  type ScheduleInput,
  type ScheduleUnit,
  type Template,
  type TemplateInput,
  createSchedule,
  createTemplate,
  deleteSchedule,
  listAccounts,
  listCategories,
  listPayees,
  listSchedules,
  listTemplates,
  postScheduleNow,
  skipSchedule,
  updateSchedule,
  updateTemplate,
} from "../api/client";
import { useDateFormat } from "../dates";
import { formatMinor, type MoneyFormat } from "../money";
import { rowEditProps, stopRowEdit } from "../rowEdit";
import { PAYMENT_MODES } from "../transactionEnums";
import { useAmountParser } from "../useAmountParser";
import { useWallet } from "../wallet/WalletProvider";

const UNITS: ScheduleUnit[] = ["day", "week", "month", "year"];
const WEEKEND_MODES = [0, 1, 2, 3];

// Currency formatting for an account (falls back to plain 2-decimal numbers when
// the account/currency isn't known).
const accountFormat = (a?: Account): MoneyFormat => ({
  fracDigits: a?.currencyFracDigits ?? 2,
  decimalChar: a?.currencyDecimalChar ?? ".",
  groupChar: a?.currencyGroupChar ?? ",",
  symbol: a?.currencySymbol ?? "",
  symbolPrefix: a?.currencySymbolPrefix ?? false,
});

export function SchedulesPage() {
  const { t } = useTranslation();
  const fmtDate = useDateFormat();
  const qc = useQueryClient();
  const { currentWallet } = useWallet();
  const walletId = currentWallet?.id ?? 0;

  const query = useQuery({
    queryKey: ["schedules", walletId],
    queryFn: () => listSchedules(walletId),
    enabled: walletId > 0,
  });
  const schedules = query.data ?? [];

  // Templates and accounts let us format each schedule's amount in its account's
  // currency (schedule → template.accountId → account).
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
  const templateById = useMemo(
    () => new Map((templatesQuery.data ?? []).map((tpl) => [tpl.id, tpl])),
    [templatesQuery.data],
  );
  const accountById = useMemo(
    () => new Map((accountsQuery.data ?? []).map((a) => [a.id, a])),
    [accountsQuery.data],
  );
  const accountFor = (s: Schedule): Account | undefined => {
    const accId = templateById.get(s.templateId)?.accountId;
    return accId != null ? accountById.get(accId) : undefined;
  };

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["schedules", walletId] });
    void qc.invalidateQueries({ queryKey: ["dashboard", walletId] });
    void qc.invalidateQueries({ queryKey: ["register", walletId] });
  };
  const onError = (err: unknown) =>
    notifications.show({
      color: "red",
      message: err instanceof ApiError ? err.message : String(err),
    });

  const [opened, form] = useDisclosure(false);
  const [editing, setEditing] = useState<Schedule | null>(null);

  const post = useMutation({
    mutationFn: (id: number) => postScheduleNow(walletId, id),
    onSuccess: invalidate,
    onError,
  });
  const skip = useMutation({
    mutationFn: (id: number) => skipSchedule(walletId, id),
    onSuccess: invalidate,
    onError,
  });
  const remove = useMutation({
    mutationFn: (id: number) => deleteSchedule(walletId, id),
    onSuccess: invalidate,
    onError,
  });

  if (!currentWallet) return null;

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>{t("schedules.title")}</Title>
        <Button
          leftSection={<IconPlus size={16} />}
          onClick={() => {
            setEditing(null);
            form.open();
          }}
        >
          {t("schedules.add")}
        </Button>
      </Group>

      {schedules.length === 0 && <Text c="dimmed">{t("schedules.empty")}</Text>}

      {schedules.length > 0 && (
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t("schedules.template")}</Table.Th>
              <Table.Th ta="right">{t("transactions.amount")}</Table.Th>
              <Table.Th>{t("schedules.cadenceLabel")}</Table.Th>
              <Table.Th>{t("schedules.nextDue")}</Table.Th>
              <Table.Th>{t("schedules.remaining")}</Table.Th>
              <Table.Th>{t("schedules.mode")}</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {schedules.map((s) => (
              <Table.Tr
                key={s.id}
                {...rowEditProps(() => {
                  setEditing(s);
                  form.open();
                })}
              >
                <Table.Td>{s.templateName}</Table.Td>
                <Table.Td ta="right" c={s.templateAmount < 0 ? "red" : "teal"}>
                  {formatMinor(s.templateAmount, accountFormat(accountFor(s)))}
                </Table.Td>
                <Table.Td>
                  {t("schedules.cadence", { n: s.everyN, unit: t(`schedules.units.${s.unit}`) })}
                </Table.Td>
                <Table.Td>{fmtDate(s.nextDue)}</Table.Td>
                <Table.Td>{s.remaining ?? "∞"}</Table.Td>
                <Table.Td>
                  <Badge variant="light" color={s.autoPost ? "teal" : "gray"}>
                    {s.autoPost ? t("schedules.autoLabel") : t("schedules.remindLabel")}
                  </Badge>
                </Table.Td>
                <Table.Td ta="right" {...stopRowEdit}>
                  <Group gap={4} justify="flex-end" wrap="nowrap">
                    <ActionIcon
                      variant="subtle"
                      color="teal"
                      aria-label={t("schedules.postNow")}
                      onClick={() => post.mutate(s.id)}
                    >
                      <IconPlayerPlay size={16} />
                    </ActionIcon>
                    <ActionIcon
                      variant="subtle"
                      color="gray"
                      aria-label={t("schedules.skip")}
                      onClick={() => skip.mutate(s.id)}
                    >
                      <IconPlayerSkipForward size={16} />
                    </ActionIcon>
                    <ActionIcon
                      variant="subtle"
                      aria-label={t("schedules.edit")}
                      onClick={() => {
                        setEditing(s);
                        form.open();
                      }}
                    >
                      <IconPencil size={16} />
                    </ActionIcon>
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      aria-label={t("schedules.delete")}
                      onClick={() => {
                        if (window.confirm(t("schedules.confirmDelete"))) remove.mutate(s.id);
                      }}
                    >
                      <IconTrash size={16} />
                    </ActionIcon>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      <ScheduleForm
        opened={opened}
        onClose={form.close}
        walletId={walletId}
        editing={editing}
        onSaved={invalidate}
      />
    </Stack>
  );
}

function ScheduleForm({
  opened,
  onClose,
  walletId,
  editing,
  onSaved,
}: {
  opened: boolean;
  onClose: () => void;
  walletId: number;
  editing: Schedule | null;
  onSaved: () => void;
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

  // Transaction details (the recurring transaction itself; backed by a template).
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

  // Cadence.
  const [unit, setUnit] = useState<ScheduleUnit>("month");
  const [everyN, setEveryN] = useState<number | string>(1);
  const [nextDue, setNextDue] = useState("");
  const [weekendMode, setWeekendMode] = useState("0");
  const [limited, setLimited] = useState(false);
  const [remaining, setRemaining] = useState<number | string>(12);
  const [postAdvance, setPostAdvance] = useState<number | string>(0);
  const [autoPost, setAutoPost] = useState(true);

  const account = accounts.find((a) => String(a.id) === accountId);
  const fd = account?.currencyFracDigits ?? 2;
  const dc = account?.currencyDecimalChar ?? ".";

  // Fill the transaction fields from a template (its values are loaded into the
  // editable form; a fresh dedicated template is then created/updated on save).
  const fillFromTemplate = (tpl: Template) => {
    setAccountId(tpl.accountId != null ? String(tpl.accountId) : null);
    setDirection(tpl.amount < 0 ? "expense" : "income");
    const tfd = accounts.find((a) => a.id === tpl.accountId)?.currencyFracDigits ?? 2;
    const tdc = accounts.find((a) => a.id === tpl.accountId)?.currencyDecimalChar ?? ".";
    setAmount(
      tpl.amount === 0
        ? ""
        : (Math.abs(tpl.amount) / Math.pow(10, tfd)).toFixed(tfd).replace(".", tdc),
    );
    setPayeeId(tpl.payeeId != null ? String(tpl.payeeId) : null);
    setCategoryId(tpl.categoryId != null ? String(tpl.categoryId) : null);
    setMemo(tpl.memo);
    setPaymentMode(String(tpl.paymentMode));
    setIsTransfer(tpl.isTransfer);
    setToAccountId(tpl.toAccountId ?? null);
  };

  useEffect(() => {
    if (!opened) return;
    const e = editing;
    setUnit(e?.unit ?? "month");
    setEveryN(e?.everyN ?? 1);
    setNextDue(e?.nextDue ?? new Date().toISOString().slice(0, 10));
    setWeekendMode(String(e?.weekendMode ?? 0));
    setLimited(e?.remaining != null);
    setRemaining(e?.remaining ?? 12);
    setPostAdvance(e?.postAdvance ?? 0);
    setAutoPost(e?.autoPost ?? true);
    if (!e) {
      // New schedule: blank transaction fields (account defaults to the first).
      setAccountId(accounts[0] ? String(accounts[0].id) : null);
      setDirection("expense");
      setAmount("");
      setPayeeId(null);
      setCategoryId(null);
      setMemo("");
      setPaymentMode("0");
      setIsTransfer(false);
      setToAccountId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, editing]);

  // Default the account to the first one once the accounts list has loaded (the
  // query may resolve after the modal opened).
  useEffect(() => {
    if (opened && !editing && !accountId && accounts.length > 0) {
      setAccountId(String(accounts[0].id));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, editing, accountsQuery.data]);

  // When editing, prefill the transaction fields from the schedule's own
  // template once the templates list has loaded.
  useEffect(() => {
    if (!opened || !editing) return;
    const tpl = templates.find((tp) => tp.id === editing.templateId);
    if (tpl) fillFromTemplate(tpl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, editing, templatesQuery.data, accountsQuery.data]);

  const onPayee = (v: string | null) => {
    setPayeeId(v);
    const p = payees.find((x) => String(x.id) === v);
    if (p?.defaultCategoryId != null) setCategoryId(String(p.defaultCategoryId));
  };

  const buildTemplate = (): TemplateInput => {
    const minor = (parseAmount(amount, fd, dc) ?? 0) * (direction === "expense" ? -1 : 1);
    const payeeName = payees.find((x) => String(x.id) === payeeId)?.name;
    const name = (memo || payeeName || t("schedules.untitled")).slice(0, 64);
    return {
      name,
      accountId: accountId ? Number(accountId) : null,
      amount: minor,
      paymentMode: Number(paymentMode),
      payeeId: payeeId ? Number(payeeId) : null,
      categoryId: categoryId ? Number(categoryId) : null,
      memo,
      isTransfer,
      toAccountId,
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
  const canSave = !!accountId && (parseAmount(amount, fd, dc) ?? 0) > 0 && !!nextDue;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={editing ? t("schedules.editTitle") : t("schedules.addTitle")}
    >
      <Stack>
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

        <Divider label={t("schedules.transactionDetails")} labelPosition="left" />
        {isTransfer && (
          <Text size="xs" c="dimmed">
            {t("schedules.transferNote")}
          </Text>
        )}
        <Select
          label={t("transactions.account")}
          data={accounts.map((a) => ({ value: String(a.id), label: a.name }))}
          value={accountId}
          onChange={setAccountId}
          disabled={isTransfer}
          allowDeselect={false}
          searchable
        />
        <Group grow>
          <Group gap="xs" align="flex-end" wrap="nowrap">
            <SegmentedControl
              value={direction}
              onChange={(v) => setDirection(v as "expense" | "income")}
              data={[
                { value: "expense", label: "−" },
                { value: "income", label: "+" },
              ]}
              mt="lg"
            />
            <TextInput
              label={t("transactions.amount")}
              value={amount}
              onChange={(e) => setAmount(e.currentTarget.value)}
              style={{ flex: 1 }}
            />
          </Group>
          <Select
            label={t("transactions.paymentMode")}
            data={PAYMENT_MODES.map((m) => ({ value: String(m), label: t(`paymentModes.${m}`) }))}
            value={paymentMode}
            onChange={(v) => v && setPaymentMode(v)}
            allowDeselect={false}
            disabled={isTransfer}
          />
        </Group>
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
          value={categoryId}
          onChange={setCategoryId}
          disabled={isTransfer}
          searchable
          clearable
        />
        <TextInput
          label={t("transactions.memo")}
          value={memo}
          onChange={(e) => setMemo(e.currentTarget.value)}
        />

        <Divider label={t("schedules.cadenceLabel")} labelPosition="left" />
        <Group grow>
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
        <Switch
          label={t("schedules.autoPost")}
          checked={autoPost}
          onChange={(e) => setAutoPost(e.currentTarget.checked)}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t("schedules.cancel")}
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!canSave}>
            {t("schedules.save")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
