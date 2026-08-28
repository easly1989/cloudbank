import {
  ActionIcon,
  Button,
  Card,
  Collapse,
  Group,
  Modal,
  Progress,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Textarea,
  Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
  IconChevronDown,
  IconMinus,
  IconPencil,
  IconPigMoney,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  ApiError,
  type Currency,
  type Goal,
  addGoalContribution,
  createGoal,
  deleteGoal,
  deleteGoalContribution,
  listAccounts,
  listCurrencies,
  listGoalContributions,
  listGoals,
  updateGoal,
} from "../api/client";
import { useDateFormat } from "../dates";
import { type MoneyFormat, formatMinor, minorToInput } from "../money";
import { useAmountParser } from "../useAmountParser";
import { useWallet } from "../wallet/WalletProvider";

const baseFmt = (currencies: Currency[]): MoneyFormat => {
  const base = currencies.find((c) => c.isBase);
  return base
    ? {
        fracDigits: base.fracDigits,
        decimalChar: base.decimalChar,
        groupChar: base.groupChar,
        symbol: base.symbol,
        symbolPrefix: base.symbolPrefix,
      }
    : { fracDigits: 2, decimalChar: ".", groupChar: ",", symbol: "", symbolPrefix: false };
};

function onError(err: unknown) {
  notifications.show({
    color: "red",
    message: err instanceof ApiError ? err.message : String(err),
  });
}

export function GoalsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { currentWallet } = useWallet();
  const walletId = currentWallet?.id ?? 0;
  const [editing, setEditing] = useState<Goal | null>(null);
  const [opened, modal] = useDisclosure(false);

  const currenciesQuery = useQuery({
    queryKey: ["currencies", walletId],
    queryFn: () => listCurrencies(walletId),
    enabled: walletId > 0,
  });
  const fmt = useMemo(() => baseFmt(currenciesQuery.data ?? []), [currenciesQuery.data]);

  const goalsQuery = useQuery({
    queryKey: ["goals", walletId],
    queryFn: () => listGoals(walletId),
    enabled: walletId > 0,
  });
  const goals = goalsQuery.data ?? [];
  const invalidate = () => void qc.invalidateQueries({ queryKey: ["goals", walletId] });

  const openCreate = () => {
    setEditing(null);
    modal.open();
  };
  const openEdit = (g: Goal) => {
    setEditing(g);
    modal.open();
  };

  if (!currentWallet) return null;

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>{t("goals.title")}</Title>
        <Button leftSection={<IconPlus size={16} />} onClick={openCreate}>
          {t("goals.add")}
        </Button>
      </Group>
      <Text size="sm" c="dimmed">
        {t("goals.hint")}
      </Text>
      {goals.length === 0 ? (
        <Text c="dimmed">{t("goals.empty")}</Text>
      ) : (
        <SimpleGrid cols={{ base: 1, md: 2 }}>
          {goals.map((g) => (
            <GoalCard
              key={g.id}
              goal={g}
              walletId={walletId}
              fmt={fmt}
              onEdit={() => openEdit(g)}
              onChanged={invalidate}
            />
          ))}
        </SimpleGrid>
      )}
      <GoalModal
        opened={opened}
        onClose={modal.close}
        walletId={walletId}
        goal={editing}
        fmt={fmt}
        onSaved={invalidate}
      />
    </Stack>
  );
}

function GoalCard({
  goal,
  walletId,
  fmt,
  onEdit,
  onChanged,
}: {
  goal: Goal;
  walletId: number;
  fmt: MoneyFormat;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [historyOpen, history] = useDisclosure(false);
  const [contribOpened, contribModal] = useDisclosure(false);
  const [withdraw, setWithdraw] = useState(false);

  const pct = goal.targetAmount > 0 ? Math.min(100, (goal.saved / goal.targetAmount) * 100) : 0;
  const reached = goal.saved >= goal.targetAmount && goal.targetAmount > 0;
  const remaining = Math.max(0, goal.targetAmount - goal.saved);

  const contributionsQuery = useQuery({
    queryKey: ["goalContributions", walletId, goal.id],
    queryFn: () => listGoalContributions(walletId, goal.id),
    enabled: historyOpen && walletId > 0,
  });

  const afterContribChange = () => {
    onChanged();
    void qc.invalidateQueries({ queryKey: ["goalContributions", walletId, goal.id] });
  };

  const remove = useMutation({
    mutationFn: () => deleteGoal(walletId, goal.id),
    onSuccess: onChanged,
    onError,
  });
  const removeContribution = useMutation({
    mutationFn: (id: number) => deleteGoalContribution(walletId, goal.id, id),
    onSuccess: afterContribChange,
    onError,
  });

  const openContribution = (isWithdraw: boolean) => {
    setWithdraw(isWithdraw);
    contribModal.open();
  };

  return (
    <Card withBorder padding="md">
      <Stack gap="xs">
        <Group justify="space-between" wrap="nowrap" align="flex-start">
          <Group gap="xs" wrap="nowrap">
            <IconPigMoney size={20} style={{ flexShrink: 0, opacity: 0.7 }} />
            <div>
              <Text fw={600}>{goal.name}</Text>
              {goal.targetDate && (
                <Text size="xs" c="dimmed">
                  {t("goals.by")} <GoalDate iso={goal.targetDate} />
                </Text>
              )}
            </div>
          </Group>
          <Group gap={2} wrap="nowrap">
            <ActionIcon variant="subtle" aria-label={t("goals.edit")} onClick={onEdit}>
              <IconPencil size={16} />
            </ActionIcon>
            <ActionIcon
              variant="subtle"
              color="red"
              aria-label={t("goals.delete")}
              onClick={() => {
                if (window.confirm(t("goals.confirmDelete", { name: goal.name }))) remove.mutate();
              }}
            >
              <IconTrash size={16} />
            </ActionIcon>
          </Group>
        </Group>

        <Progress value={pct} color={reached ? "teal" : undefined} size="lg" radius="sm" />
        <Group justify="space-between" gap="xs">
          <Text size="sm" fw={500}>
            {formatMinor(goal.saved, fmt)}{" "}
            <Text span size="sm" c="dimmed">
              / {formatMinor(goal.targetAmount, fmt)}
            </Text>
          </Text>
          <Text size="sm" c={reached ? "teal" : "dimmed"}>
            {reached
              ? t("goals.reached")
              : t("goals.remaining", { amount: formatMinor(remaining, fmt) })}
          </Text>
        </Group>

        <Group gap="xs">
          <Button
            size="xs"
            variant="light"
            leftSection={<IconPlus size={14} />}
            onClick={() => openContribution(false)}
          >
            {t("goals.addMoney")}
          </Button>
          <Button
            size="xs"
            variant="default"
            leftSection={<IconMinus size={14} />}
            disabled={goal.saved <= 0}
            onClick={() => openContribution(true)}
          >
            {t("goals.withdraw")}
          </Button>
          <Button
            size="xs"
            variant="subtle"
            color="gray"
            ml="auto"
            rightSection={
              <IconChevronDown
                size={14}
                style={{
                  transform: historyOpen ? "rotate(180deg)" : "none",
                  transition: "transform 150ms",
                }}
              />
            }
            onClick={history.toggle}
          >
            {t("goals.history")}
          </Button>
        </Group>

        <Collapse expanded={historyOpen}>
          <Stack gap={4} pt="xs">
            {(contributionsQuery.data ?? []).length === 0 ? (
              <Text size="xs" c="dimmed">
                {t("goals.noContributions")}
              </Text>
            ) : (
              (contributionsQuery.data ?? []).map((c) => (
                <Group key={c.id} justify="space-between" gap="xs" wrap="nowrap">
                  <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
                    <Text size="xs" c="dimmed">
                      <GoalDate iso={c.date} />
                    </Text>
                    {c.note && (
                      <Text size="xs" truncate>
                        {c.note}
                      </Text>
                    )}
                  </Group>
                  <Group gap={4} wrap="nowrap">
                    <Text size="xs" fw={500} c={c.amount < 0 ? "red" : "teal"}>
                      {c.amount < 0 ? "−" : "+"}
                      {formatMinor(Math.abs(c.amount), fmt)}
                    </Text>
                    <ActionIcon
                      size="xs"
                      variant="subtle"
                      color="red"
                      aria-label={t("goals.deleteContribution")}
                      onClick={() => removeContribution.mutate(c.id)}
                    >
                      <IconTrash size={13} />
                    </ActionIcon>
                  </Group>
                </Group>
              ))
            )}
          </Stack>
        </Collapse>
      </Stack>

      <ContributionModal
        opened={contribOpened}
        onClose={contribModal.close}
        walletId={walletId}
        goalId={goal.id}
        withdraw={withdraw}
        fmt={fmt}
        onSaved={afterContribChange}
      />
    </Card>
  );
}

function GoalDate({ iso }: { iso: string }) {
  const fmt = useDateFormat();
  return <>{fmt(iso)}</>;
}

function GoalModal({
  opened,
  onClose,
  walletId,
  goal,
  fmt,
  onSaved,
}: {
  opened: boolean;
  onClose: () => void;
  walletId: number;
  goal: Goal | null;
  fmt: MoneyFormat;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const parseAmount = useAmountParser();
  const accountsQuery = useQuery({
    queryKey: ["accounts", walletId],
    queryFn: () => listAccounts(walletId),
    enabled: walletId > 0 && opened,
  });

  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [accountId, setAccountId] = useState<string | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!opened) return;
    setName(goal?.name ?? "");
    setTarget(goal ? minorToInput(goal.targetAmount, fmt.fracDigits, fmt.decimalChar) : "");
    setTargetDate(goal?.targetDate ?? "");
    setAccountId(goal?.accountId != null ? String(goal.accountId) : null);
    setNote(goal?.note ?? "");
  }, [opened, goal, fmt.fracDigits, fmt.decimalChar]);

  const targetMinor = parseAmount(target, fmt.fracDigits, fmt.decimalChar) ?? 0;

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name,
        targetAmount: targetMinor,
        targetDate: targetDate || null,
        accountId: accountId ? Number(accountId) : null,
        note,
      };
      return goal ? updateGoal(walletId, goal.id, body) : createGoal(walletId, body);
    },
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError,
  });

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={goal ? t("goals.editTitle") : t("goals.addTitle")}
    >
      <Stack>
        <TextInput
          label={t("goals.name")}
          required
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
        />
        <Group grow align="flex-start">
          <TextInput
            label={t("goals.target")}
            value={target}
            onChange={(e) => setTarget(e.currentTarget.value)}
            rightSection={<Text size="xs">{fmt.symbol || ""}</Text>}
          />
          <TextInput
            type="date"
            label={t("goals.targetDate")}
            value={targetDate}
            onChange={(e) => setTargetDate(e.currentTarget.value)}
          />
        </Group>
        <Select
          label={t("goals.account")}
          description={t("goals.accountHint")}
          data={(accountsQuery.data ?? []).map((a) => ({ value: String(a.id), label: a.name }))}
          value={accountId}
          onChange={setAccountId}
          clearable
          searchable
        />
        <Textarea
          label={t("goals.note")}
          value={note}
          onChange={(e) => setNote(e.currentTarget.value)}
          autosize
          minRows={2}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t("goals.cancel")}
          </Button>
          <Button
            onClick={() => save.mutate()}
            loading={save.isPending}
            disabled={!name.trim() || targetMinor <= 0}
          >
            {t("goals.save")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function ContributionModal({
  opened,
  onClose,
  walletId,
  goalId,
  withdraw,
  fmt,
  onSaved,
}: {
  opened: boolean;
  onClose: () => void;
  walletId: number;
  goalId: number;
  withdraw: boolean;
  fmt: MoneyFormat;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const parseAmount = useAmountParser();
  const [direction, setDirection] = useState<"add" | "withdraw">("add");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!opened) return;
    setDirection(withdraw ? "withdraw" : "add");
    setAmount("");
    setDate(new Date().toISOString().slice(0, 10));
    setNote("");
  }, [opened, withdraw]);

  const magnitude = parseAmount(amount, fmt.fracDigits, fmt.decimalChar) ?? 0;

  const save = useMutation({
    mutationFn: () =>
      addGoalContribution(walletId, goalId, {
        date,
        amount: magnitude * (direction === "withdraw" ? -1 : 1),
        note,
      }),
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError,
  });

  return (
    <Modal opened={opened} onClose={onClose} title={t("goals.contributionTitle")} size="sm">
      <Stack>
        <SegmentedControl
          fullWidth
          value={direction}
          onChange={(v) => setDirection(v as "add" | "withdraw")}
          data={[
            { value: "add", label: t("goals.addMoney") },
            { value: "withdraw", label: t("goals.withdraw") },
          ]}
        />
        <Group grow align="flex-start">
          <TextInput
            label={t("goals.amount")}
            value={amount}
            onChange={(e) => setAmount(e.currentTarget.value)}
            rightSection={<Text size="xs">{fmt.symbol || ""}</Text>}
            data-autofocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && magnitude > 0) save.mutate();
            }}
          />
          <TextInput
            type="date"
            label={t("goals.date")}
            value={date}
            onChange={(e) => setDate(e.currentTarget.value)}
          />
        </Group>
        <TextInput
          label={t("goals.note")}
          value={note}
          onChange={(e) => setNote(e.currentTarget.value)}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t("goals.cancel")}
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={magnitude <= 0}>
            {t("goals.save")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
