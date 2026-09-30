import { Anchor, Button, Group, Stack, Text, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconAlertCircle } from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import {
  ApiError,
  postScheduleNow,
  skipSchedule,
  type Account,
  type ScheduleOccurrence,
  type SchedulePostInput,
} from "../../api/client";
import { amountColor, attentionColor } from "../../amountTone";
import { SideSheet } from "../../components/SideSheet";
import { StatusPicker } from "../../components/StatusPicker";
import { ENTRY_SHEET } from "../../components/entrySheetTheme";
import { minorToInput } from "../../money";
import { useAmountParser } from "../../useAmountParser";
import { useShortDate } from "./labels";
import { OccurrenceIcon } from "./OccurrenceIcon";
import classes from "./schedules.module.css";

/** A posted scheduled transaction defaults to Cleared: it has happened. */
const DEFAULT_STATUS = "1";

/**
 * One occurrence still to register, in a sheet beside the calendar: what the
 * schedule says it will be, with the amount, date and status open to change —
 * a bill is rarely the same twice — and the months before it for comparison.
 */
export function OccurrenceSheet({
  walletId,
  occurrence,
  account,
  history,
  today,
  format,
  onClose,
  onDone,
  onEditSchedule,
}: {
  walletId: number;
  occurrence: ScheduleOccurrence | null;
  account?: Account;
  history: ScheduleOccurrence[];
  today: string;
  format: (amount: number, accountId?: number) => string;
  onClose: () => void;
  onDone: () => void;
  onEditSchedule: (o: ScheduleOccurrence) => void;
}) {
  const { t } = useTranslation();
  const short = useShortDate();
  const parseAmount = useAmountParser();
  const fd = account?.currencyFracDigits ?? 2;
  const dc = account?.currencyDecimalChar ?? ".";
  const o = occurrence;

  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [status, setStatus] = useState(DEFAULT_STATUS);
  // Seeded during render when a different occurrence opens, so the sheet never
  // shows a frame of the previous one.
  const key = o ? `${o.scheduleId}-${o.date}` : null;
  const [seededFor, setSeededFor] = useState<string | null>(null);
  if (key !== seededFor) {
    setSeededFor(key);
    if (o) {
      setAmount(minorToInput(Math.abs(o.amount), fd, dc));
      setDate(o.date);
      setStatus(DEFAULT_STATUS);
    }
  }

  const onError = (err: unknown) =>
    notifications.show({
      color: "red",
      message: err instanceof ApiError ? err.message : String(err),
    });
  const sign = (o?.amount ?? 0) < 0 ? -1 : 1;
  const parsed = parseAmount(amount, fd, dc);
  const register = useMutation({
    mutationFn: () => {
      const body: SchedulePostInput = {};
      const minor = parsed != null ? parsed * sign : null;
      if (o && minor != null && minor !== o.amount) body.amount = minor;
      if (o && date !== o.date) body.date = date;
      if (status !== DEFAULT_STATUS) body.status = Number(status);
      return postScheduleNow(walletId, o!.scheduleId!, Object.keys(body).length ? body : undefined);
    },
    onSuccess: () => {
      notifications.show({ message: t("schedules.registered", { name: o?.name }) });
      onDone();
      onClose();
    },
    onError,
  });
  const skip = useMutation({
    mutationFn: () => skipSchedule(walletId, o!.scheduleId!),
    onSuccess: () => {
      onDone();
      onClose();
    },
    onError,
  });

  const days = o ? Math.round((Date.parse(today) - Date.parse(o.date)) / 86_400_000) : 0;
  const when =
    o?.state === "overdue"
      ? t("schedules.sheet.overdue", { date: short(o.date), count: days })
      : o?.autoPost
        ? t("schedules.sheet.auto", { date: o ? short(o.date) : "" })
        : t("schedules.sheet.due", { date: o ? short(o.date) : "" });
  const canAct = !!o && o.next && o.scheduleId != null;
  const busy = register.isPending || skip.isPending;

  return (
    <SideSheet
      opened={!!o}
      onClose={onClose}
      testId="occurrence-sheet"
      title={o?.name}
      subtitle={
        <Group
          gap={5}
          wrap="nowrap"
          c={o?.state === "overdue" ? attentionColor : undefined}
          component="span"
        >
          {o?.state === "overdue" && <IconAlertCircle size={14} aria-hidden />}
          {when}
        </Group>
      }
      foot={
        canAct && (
          <>
            <Button
              variant="default"
              onClick={() => skip.mutate()}
              loading={skip.isPending}
              disabled={busy}
            >
              {t("schedules.skipThisOne")}
            </Button>
            <Button
              onClick={() => register.mutate()}
              loading={register.isPending}
              disabled={busy || !parsed || !date}
            >
              {t("schedules.register")}
            </Button>
          </>
        )
      }
    >
      {o && (
        <>
          <TextInput
            className="cb-amount"
            label={t("transactions.amount")}
            value={amount}
            onChange={(e) => setAmount(e.currentTarget.value)}
            disabled={o.isSplit}
            description={o.isSplit ? t("schedules.sheet.split") : t("schedules.sheet.amountHint")}
            inputWrapperOrder={["label", "input", "description", "error"]}
            inputMode="decimal"
            leftSection={
              <Text fz={24} fw={600} c={amountColor(sign)} aria-hidden>
                {sign < 0 ? "−" : "+"}
              </Text>
            }
            leftSectionWidth={ENTRY_SHEET.sign.section}
            rightSection={
              <Text size="xs" c="dimmed">
                {account?.currencyCode}
              </Text>
            }
            rightSectionWidth={48}
            styles={{ input: { color: amountColor(sign) } }}
          />
          <Group grow gap={ENTRY_SHEET.pairGap} align="flex-start">
            <TextInput
              type="date"
              label={t("transactions.date")}
              value={date}
              onChange={(e) => setDate(e.currentTarget.value)}
            />
            <TextInput label={t("transactions.account")} value={account?.name ?? ""} readOnly />
          </Group>
          <Stack gap={6}>
            <Text fz={12} fw={600} lh="14px">
              {t("transactions.status")}
            </Text>
            <StatusPicker value={status} onChange={setStatus} />
          </Stack>
          {!canAct && (
            <Text size="sm" c="dimmed">
              {t("schedules.sheet.notNext")}
            </Text>
          )}
          {history.length > 0 && (
            <Stack gap={4} pt={14} style={{ borderTop: "1px solid var(--cb-ledger-border)" }}>
              <Text fz={13} fw={600}>
                {t("schedules.sheet.earlier")}
              </Text>
              {history.map((h) => (
                <Group key={h.transactionId} gap={8} wrap="nowrap" c="dimmed" fz={13.5} py={4}>
                  <OccurrenceIcon o={h} />
                  <span>{short(h.date)}</span>
                  <span
                    className={classes.itemAmount}
                    style={{ marginLeft: "auto", fontSize: 13.5 }}
                  >
                    {format(h.amount, h.accountId)}
                  </span>
                </Group>
              ))}
            </Stack>
          )}
          {o.scheduleId != null && (
            <Anchor
              component="button"
              type="button"
              fz={13.5}
              ta="start"
              onClick={() => onEditSchedule(o)}
            >
              {t("schedules.editSchedule")}
            </Anchor>
          )}
        </>
      )}
    </SideSheet>
  );
}
