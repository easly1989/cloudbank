import { ActionIcon, Button, Menu, Select, Text, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconDots, IconMinus, IconPlus, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import {
  type Account,
  ApiError,
  createGoal,
  deleteGoalContribution,
  listGoalContributions,
  updateGoal,
} from "../../api/client";
import { useConfirm } from "../../components/confirmContext";
import { SideSheet } from "../../components/SideSheet";
import { ENTRY_SHEET } from "../../components/entrySheetTheme";
import { type MoneyFormat, minorToInput } from "../../money";
import { useAmountParser } from "../../useAmountParser";
import { useDayMonth } from "../categories/labels";
import { type GoalLine, monthIndex } from "./goalList";
import { type GoalActions, type Money, useMonthName } from "./goalWords";
import classes from "./goals.module.css";

/** A new goal's starting values, from one of the empty page's examples. */
export interface GoalPreset {
  name: string;
  targetAmount?: number;
  targetDate?: string;
}

const showError = (err: unknown) =>
  notifications.show({
    color: "red",
    message: err instanceof ApiError ? err.message : String(err),
  });

/**
 * A goal in the sheet beside the page (#572): its name, target and date, the
 * account it is kept in (for reference), a note, and the money put in and
 * taken out, each movement deletable after a confirmation. A closed goal's
 * money stays as it is until the goal is reopened.
 */
export function GoalSheet({
  opened,
  onClose,
  walletId,
  goal,
  preset,
  accounts,
  fmt,
  money,
  today,
  onSaved,
  actions,
}: {
  opened: boolean;
  onClose: () => void;
  walletId: number;
  /** The goal to edit; null for a new one. */
  goal: GoalLine | null;
  preset: GoalPreset | null;
  accounts: Account[];
  fmt: MoneyFormat;
  money: Money;
  today: string;
  onSaved: () => void;
  actions: GoalActions;
}) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const parseAmount = useAmountParser();
  const day = useDayMonth(today);
  const month = useMonthName();

  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [accountId, setAccountId] = useState<string | null>(null);
  const [note, setNote] = useState("");

  // Seeded on opening, during render, so the sheet never shows a frame of the
  // goal before; the key is null while closed, so reopening starts afresh.
  const openKey = opened ? `${goal?.id ?? "new"}:${preset?.name ?? ""}` : null;
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  if (openKey !== openedFor) {
    setOpenedFor(openKey);
    if (openKey !== null) {
      const amount = goal?.targetAmount ?? preset?.targetAmount;
      setName(goal?.name ?? preset?.name ?? "");
      setTarget(amount ? minorToInput(amount, fmt.fracDigits, fmt.decimalChar) : "");
      setTargetDate(goal?.targetDate ?? preset?.targetDate ?? "");
      setAccountId(goal?.accountId != null ? String(goal.accountId) : null);
      setNote(goal?.note ?? "");
    }
  }

  const targetMinor = parseAmount(target, fmt.fracDigits, fmt.decimalChar) ?? 0;

  const moves = useQuery({
    queryKey: ["goalContributions", walletId, goal?.id],
    queryFn: () => listGoalContributions(walletId, goal!.id),
    enabled: opened && goal != null,
  });

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
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
    onError: showError,
  });

  const removeMove = useMutation({
    mutationFn: (id: number) => deleteGoalContribution(walletId, goal!.id, id),
    onSuccess: onSaved,
    onError: showError,
  });
  const askRemoveMove = async (id: number, amount: number, date: string) => {
    const ok = await confirm({
      title: t("goals.confirmDeleteMoveTitle"),
      body: t("goals.confirmDeleteMoveBody", {
        amount: `${amount < 0 ? "−" : "+"}${money(Math.abs(amount))}`,
        date: day(date),
      }),
      confirmLabel: t("goals.confirmDeleteMove"),
      danger: true,
    });
    if (ok) removeMove.mutate(id);
  };

  const closed = goal?.closed ?? false;
  const subtitle = !goal
    ? undefined
    : goal.targetDate
      ? t("goals.sheet.subtitleBy", {
          saved: money(goal.saved),
          target: money(goal.targetAmount),
          month: month(monthIndex(goal.targetDate)),
        })
      : t("goals.sheet.subtitle", { saved: money(goal.saved), target: money(goal.targetAmount) });

  return (
    <SideSheet
      opened={opened}
      onClose={onClose}
      testId="goal-sheet"
      title={goal ? goal.name : t("goals.sheet.addTitle")}
      subtitle={subtitle}
      headerActions={
        goal && (
          <Menu position="bottom-end" withinPortal>
            <Menu.Target>
              <ActionIcon
                variant="default"
                size={ENTRY_SHEET.headerButton}
                aria-label={t("goals.actionsFor", { name: goal.name })}
              >
                <IconDots size={17} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              {closed ? (
                <Menu.Item onClick={() => actions.onReopen(goal)}>
                  {t("goals.menu.reopen")}
                </Menu.Item>
              ) : goal.reached ? (
                <Menu.Item onClick={() => actions.onClose(goal)}>{t("goals.menu.close")}</Menu.Item>
              ) : (
                <Menu.Item onClick={() => actions.onGiveUp(goal)}>
                  {t("goals.menu.giveUp")}
                </Menu.Item>
              )}
              <Menu.Divider />
              <Menu.Item color="red" onClick={() => actions.onDelete(goal)}>
                {t("goals.menu.delete")}
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        )
      }
      foot={
        <>
          <Button variant="default" onClick={onClose}>
            {t("goals.sheet.cancel")}
          </Button>
          <Button
            onClick={() => save.mutate()}
            loading={save.isPending}
            disabled={!name.trim() || targetMinor <= 0}
          >
            {t("goals.sheet.save")}
          </Button>
        </>
      }
    >
      <TextInput
        label={t("goals.sheet.name")}
        value={name}
        onChange={(e) => setName(e.currentTarget.value)}
        data-autofocus
      />
      <div className={classes.pair}>
        <TextInput
          label={t("goals.sheet.target")}
          value={target}
          onChange={(e) => setTarget(e.currentTarget.value)}
          inputMode="decimal"
          classNames={{ input: classes.mono }}
          rightSection={
            <Text size="sm" c="dimmed">
              {fmt.symbol}
            </Text>
          }
        />
        <TextInput
          type="date"
          label={t("goals.sheet.by")}
          value={targetDate}
          onChange={(e) => setTargetDate(e.currentTarget.value)}
        />
      </div>
      <div>
        <Select
          label={t("goals.sheet.keptIn")}
          placeholder={t("goals.sheet.noAccount")}
          data={accounts
            .filter((a) => !a.closed || String(a.id) === accountId)
            .map((a) => ({ value: String(a.id), label: a.name }))}
          value={accountId}
          onChange={setAccountId}
          clearable
          searchable
        />
        <Text className={classes.note} mt={6}>
          {t("goals.sheet.keptInNote")}
        </Text>
      </div>
      <TextInput
        label={t("goals.sheet.note")}
        value={note}
        onChange={(e) => setNote(e.currentTarget.value)}
      />

      {goal && (
        <>
          <div className={classes.movesHead}>
            {t("goals.sheet.moves")}
            {!closed && (
              <span className={classes.chips}>
                <Button
                  size="compact-sm"
                  variant="default"
                  className={classes.rowButton}
                  leftSection={<IconPlus size={14} />}
                  onClick={() => actions.onPutIn(goal)}
                >
                  {t("goals.money.putIn")}
                </Button>
                <Button
                  size="compact-sm"
                  variant="default"
                  className={classes.rowButton}
                  leftSection={<IconMinus size={14} />}
                  disabled={goal.saved <= 0}
                  onClick={() => actions.onTakeOut(goal)}
                >
                  {t("goals.money.takeOut")}
                </Button>
              </span>
            )}
          </div>
          {closed && (
            <span className={classes.note}>
              {t("goals.sheet.closedNote", { date: day(goal.closedOn!) })}
            </span>
          )}
          <div className={classes.moves} data-testid="goal-moves">
            {(moves.data ?? []).length === 0 ? (
              <span className={classes.note}>
                {moves.isSuccess ? t("goals.sheet.noMoves") : " "}
              </span>
            ) : (
              (moves.data ?? []).map((c) => (
                <div key={c.id} className={classes.move}>
                  <span className={classes.dim}>{day(c.date)}</span>
                  <span className={classes.dim}>{c.note}</span>
                  <span
                    className={classes.mono}
                    style={{ color: c.amount > 0 ? "var(--cb-positive)" : "var(--cb-negative)" }}
                  >
                    {c.amount < 0 ? "−" : "+"}
                    {money(Math.abs(c.amount))}
                  </span>
                  {closed ? (
                    <span />
                  ) : (
                    <ActionIcon
                      variant="subtle"
                      color="gray"
                      size={26}
                      aria-label={t("goals.sheet.deleteMove")}
                      onClick={() => void askRemoveMove(c.id, c.amount, c.date)}
                    >
                      <IconTrash size={15} />
                    </ActionIcon>
                  )}
                </div>
              ))
            )}
          </div>
        </>
      )}
    </SideSheet>
  );
}
