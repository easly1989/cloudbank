import { Button, Checkbox, SegmentedControl, Text, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconCheck, IconMinus, IconPlus } from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { ApiError, addGoalContribution, closeGoal } from "../../api/client";
import { SideSheet } from "../../components/SideSheet";
import { type MoneyFormat, minorToInput } from "../../money";
import { useAmountParser } from "../../useAmountParser";
import { type GoalLine, monthIndex } from "./goalList";
import { type Money, useMonthName } from "./goalWords";
import classes from "./goals.module.css";

export type Direction = "in" | "out";

/**
 * Money into or out of a goal, in the sheet beside the page (#572). Putting
 * in starts from this month's share; when the amount reaches the target, the
 * goal can be closed with it, ticked by default.
 */
export function MoneySheet({
  opened,
  onClose,
  walletId,
  goal,
  direction: initial,
  fmt,
  money,
  today,
  onSaved,
}: {
  opened: boolean;
  onClose: () => void;
  walletId: number;
  goal: GoalLine | null;
  direction: Direction;
  fmt: MoneyFormat;
  money: Money;
  today: string;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const parseAmount = useAmountParser();
  const month = useMonthName();
  const input = (minor: number) => minorToInput(minor, fmt.fracDigits, fmt.decimalChar);

  const [direction, setDirection] = useState<Direction>(initial);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const [closeIt, setCloseIt] = useState(true);

  // Seeded on opening, during render, so a second opening starts afresh.
  const openKey = opened && goal ? `${goal.id}:${initial}` : null;
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  if (openKey !== openedFor) {
    setOpenedFor(openKey);
    if (openKey !== null && goal) {
      setDirection(initial);
      setAmount(initial === "in" && goal.need ? input(goal.need) : "");
      setDate(today);
      setNote("");
      setCloseIt(true);
    }
  }

  const magnitude = parseAmount(amount, fmt.fracDigits, fmt.decimalChar) ?? 0;
  const saved = goal?.saved ?? 0;
  const target = goal?.targetAmount ?? 0;
  const after = saved + (direction === "in" ? magnitude : -magnitude);
  const reaches = !!goal && direction === "in" && !goal.reached && magnitude > 0 && after >= target;
  const closing = reaches && closeIt;
  const tooMuch = direction === "out" && magnitude > saved;

  const save = useMutation({
    mutationFn: async () => {
      await addGoalContribution(walletId, goal!.id, {
        date,
        amount: direction === "in" ? magnitude : -magnitude,
        note: note.trim(),
      });
      if (closing) await closeGoal(walletId, goal!.id, today);
    },
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: (err: unknown) => {
      // The money may have gone in before the close failed.
      onSaved();
      notifications.show({
        color: "red",
        message: err instanceof ApiError ? err.message : String(err),
      });
    },
  });

  if (!goal) return null;

  const subtitle = goal.reached
    ? t("goals.money.subtitleReached", { saved: money(saved), target: money(target) })
    : goal.need != null && goal.targetDate && !goal.pastDate
      ? t("goals.money.subtitleShare", {
          saved: money(saved),
          target: money(target),
          need: money(goal.need),
          month: month(monthIndex(goal.targetDate)),
        })
      : t("goals.money.subtitle", {
          saved: money(saved),
          target: money(target),
          left: money(goal.left),
        });

  return (
    <SideSheet
      opened={opened}
      onClose={onClose}
      testId="goal-money-sheet"
      title={
        direction === "in"
          ? t("goals.money.titleIn", { name: goal.name })
          : t("goals.money.titleOut", { name: goal.name })
      }
      subtitle={subtitle}
      foot={
        <>
          <Button variant="default" onClick={onClose}>
            {t("goals.money.cancel")}
          </Button>
          <Button
            onClick={() => save.mutate()}
            loading={save.isPending}
            disabled={magnitude <= 0 || !date || tooMuch}
          >
            {closing
              ? t("goals.money.putInAndClose")
              : direction === "in"
                ? t("goals.money.putIn")
                : t("goals.money.takeOut")}
          </Button>
        </>
      }
    >
      <SegmentedControl
        fullWidth
        aria-label={t("goals.money.direction")}
        value={direction}
        onChange={(v) => setDirection(v as Direction)}
        data={[
          {
            value: "in",
            label: (
              <span className={classes.fold} style={{ fontWeight: "inherit" }}>
                <IconPlus size={14} /> {t("goals.money.putIn")}
              </span>
            ),
          },
          {
            value: "out",
            label: (
              <span className={classes.fold} style={{ fontWeight: "inherit" }}>
                <IconMinus size={14} /> {t("goals.money.takeOut")}
              </span>
            ),
          },
        ]}
      />
      <TextInput
        label={t("goals.money.amount")}
        value={amount}
        onChange={(e) => setAmount(e.currentTarget.value)}
        inputMode="decimal"
        size="md"
        classNames={{ input: classes.mono }}
        rightSection={
          <Text size="sm" c="dimmed">
            {fmt.symbol}
          </Text>
        }
        data-autofocus
        onKeyDown={(e) => {
          if (e.key === "Enter" && magnitude > 0 && !tooMuch) save.mutate();
        }}
      />
      {direction === "in" && goal.need != null && goal.need > 0 && (
        <Button
          variant="default"
          size="compact-sm"
          className={classes.share}
          onClick={() => setAmount(input(goal.need!))}
        >
          {t("goals.money.share", { amount: money(goal.need) })}
        </Button>
      )}
      <div className={classes.pair}>
        <TextInput
          type="date"
          label={t("goals.money.date")}
          value={date}
          onChange={(e) => setDate(e.currentTarget.value)}
        />
        <TextInput
          label={t("goals.money.note")}
          value={note}
          onChange={(e) => setNote(e.currentTarget.value)}
        />
      </div>
      {reaches ? (
        <>
          <span className={classes.note} data-ok>
            <IconCheck size={14} />
            {t("goals.money.reaches", { target: money(target) })}
          </span>
          <Checkbox
            label={t("goals.money.closeOnceIn")}
            checked={closeIt}
            onChange={(e) => setCloseIt(e.currentTarget.checked)}
          />
          <span className={classes.note}>{t("goals.money.closeOnceInNote")}</span>
        </>
      ) : (
        magnitude > 0 &&
        !tooMuch && (
          <span className={classes.note}>
            {after >= target
              ? t("goals.money.afterReached", { saved: money(after), target: money(target) })
              : t("goals.money.after", {
                  saved: money(after),
                  target: money(target),
                  left: money(target - after),
                })}
          </span>
        )
      )}
    </SideSheet>
  );
}
