import {
  Box,
  Button,
  Card,
  Group,
  Menu,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
  IconArrowBackUp,
  IconBuildingBank,
  IconCalendar,
  IconChevronDown,
  IconClock,
  IconGitMerge,
  IconMail,
  IconRestore,
  IconTrash,
} from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";

import {
  type Account,
  type ReversalPair,
  type ReviewTxn,
  type SnoozedRow,
  type UnconfirmedRow,
  bulkDeleteTransactions,
  mergeMailTransaction,
  snoozeReviewRows,
  unsnoozeReviewRows,
} from "../api/client";
import { amountColor } from "../amountTone";
import { toCivilDate } from "../civilDate";
import { useConfirm } from "../components/confirmContext";
import { useDateFormat } from "../dates";
import { formatMinor, type MoneyFormat } from "../money";
import { notifyError } from "../notifyError";
import { useShortDate } from "./schedules/labels";

const RULE = "1px solid var(--mantine-color-default-border)";
const DASHED = "1px dashed var(--mantine-color-default-border)";

/** Whole days from a civil date to today. */
function daysSince(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const now = new Date();
  return Math.round(
    (Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - Date.UTC(y, m - 1, d)) /
      86_400_000,
  );
}

/** The civil date n days from today, in the reader's calendar. */
function inDays(n: number): string {
  const now = new Date();
  return toCivilDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + n));
}

/**
 * "Snooze": the row leaves the list until a day, for everyone in the wallet
 * (#775). Tomorrow, in 3 days, in a week, or a day picked by hand.
 */
function SnoozeMenu({
  onSnooze,
  loading,
  rowKey,
}: {
  onSnooze: (until: string) => void;
  loading: boolean;
  rowKey: number;
}) {
  const { t } = useTranslation();
  const short = useShortDate();
  const [opened, setOpened] = useState(false);
  const [picking, setPicking] = useState(false);
  const [date, setDate] = useState("");
  const tomorrow = inDays(1);
  const pick = (until: string) => {
    setOpened(false);
    onSnooze(until);
  };
  const presets = [
    { n: 1, label: t("review.snooze.tomorrow") },
    { n: 3, label: t("review.snooze.days3") },
    { n: 7, label: t("review.snooze.week") },
  ];
  return (
    <Menu
      opened={opened}
      onChange={(o) => {
        setOpened(o);
        if (!o) {
          setPicking(false);
          setDate("");
        }
      }}
      position="bottom-end"
      width={288}
      withinPortal
    >
      <Menu.Target>
        <Button
          size="xs"
          variant="subtle"
          color="gray"
          leftSection={<IconClock size={14} />}
          rightSection={<IconChevronDown size={12} />}
          loading={loading}
          data-snooze-row={rowKey}
          style={{ flexShrink: 0 }}
        >
          {t("review.snooze.button")}
        </Button>
      </Menu.Target>
      <Menu.Dropdown>
        {picking ? (
          <Stack gap="xs" p={8}>
            <TextInput
              type="date"
              size="xs"
              label={t("review.snooze.date")}
              min={tomorrow}
              value={date}
              onChange={(e) => setDate(e.currentTarget.value)}
              data-autofocus
            />
            <Button size="xs" disabled={!date || date < tomorrow} onClick={() => pick(date)}>
              {t("review.snooze.button")}
            </Button>
            <Text size="xs" c="dimmed">
              {t("review.snooze.forWallet")}
            </Text>
          </Stack>
        ) : (
          <>
            <Menu.Label>{t("review.snooze.menuLabel")}</Menu.Label>
            {presets.map(({ n, label }) => (
              <Menu.Item
                key={n}
                onClick={() => pick(inDays(n))}
                rightSection={
                  <Text size="xs" c="dimmed">
                    {short(inDays(n))}
                  </Text>
                }
              >
                {label}
              </Menu.Item>
            ))}
            <Menu.Item
              closeMenuOnClick={false}
              leftSection={<IconCalendar size={15} />}
              onClick={() => setPicking(true)}
            >
              {t("review.snooze.pick")}
            </Menu.Item>
            <Menu.Divider />
            <Text size="xs" c="dimmed" px={12} pt={4} pb={6}>
              {t("review.snooze.forWallet")}
            </Text>
          </>
        )}
      </Menu.Dropdown>
    </Menu>
  );
}

/**
 * The rows read from bank mails that the bank has not booked after 5 days
 * (#660): each with the bank rows near it to merge with, or to delete; and a
 * refused card's payment and reversal, which cancel out, to delete together.
 * Either can be snoozed until a day (#775): the snoozed ones are folded at the
 * foot, each with its day and a way back now.
 */
export function ReviewUnconfirmed({
  walletId,
  unconfirmed,
  reversals,
  snoozed,
  accountById,
  fmtFor,
  categoryName,
  onChanged,
}: {
  walletId: number;
  unconfirmed: UnconfirmedRow[];
  reversals: ReversalPair[];
  snoozed: SnoozedRow[];
  accountById: Map<number, Account>;
  fmtFor: (acc?: Account) => MoneyFormat;
  categoryName: (id?: number | null) => string;
  onChanged: () => void;
}) {
  const { t, i18n } = useTranslation();
  const confirm = useConfirm();
  const fmtDate = useDateFormat();
  const phone = useMediaQuery("(max-width: 47.99em)") ?? false;
  const short = useShortDate();
  // The fold's return days carry the year when it is not this one.
  const withYear = useMemo(() => {
    const f = new Intl.DateTimeFormat(i18n.language, {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
    return (date: string) =>
      date.slice(0, 4) === String(new Date().getFullYear())
        ? short(date)
        : f.format(new Date(`${date}T00:00:00Z`));
  }, [i18n.language, short]);
  const allSnoozed = unconfirmed.length + reversals.length === 0 && snoozed.length > 0;
  // null: the reader has not touched the fold, so it follows the state.
  const [foldOpen, setFoldOpen] = useState<boolean | null>(null);
  const showSnoozed = foldOpen ?? allSnoozed;
  // After a snooze the row is gone: focus goes to the next row, or the fold.
  const refocus = useRef<{ gone: number; next: number | null } | null>(null);
  const rowIds = [...reversals.map((p) => p.payment.id), ...unconfirmed.map((u) => u.id)];
  const rowsSig = rowIds.join(",");
  useEffect(() => {
    const f = refocus.current;
    if (!f || rowIds.includes(f.gone)) return;
    refocus.current = null;
    const q = f.next === null ? "[data-snooze-fold]" : `[data-snooze-row="${f.next}"]`;
    document.querySelector<HTMLElement>(q)?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowsSig, snoozed.length]);

  const merge = useMutation({
    mutationFn: (v: { mailId: number; bankId: number }) =>
      mergeMailTransaction(walletId, v.mailId, v.bankId),
    onSuccess: () => {
      onChanged();
      notifications.show({ color: "green", message: t("review.merged"), autoClose: 1600 });
    },
    onError: notifyError,
  });
  const remove = useMutation({
    mutationFn: (ids: number[]) => bulkDeleteTransactions(walletId, ids),
    onSuccess: onChanged,
    onError: notifyError,
  });

  // The toast's undo calls the API itself: the card may be gone by then.
  const snooze = useMutation({
    mutationFn: (v: { ids: number[]; until: string }) => snoozeReviewRows(walletId, v.ids, v.until),
    // Settled, not only succeeded: one PUT of a pair may have gone through.
    onSettled: onChanged,
    onSuccess: (_, v) => {
      const id = `snooze-${v.ids.join("-")}`;
      notifications.show({
        id,
        autoClose: 7000,
        message: (
          <Group gap="sm" wrap="nowrap" data-testid="review-snoozed-toast">
            <Text size="sm" style={{ flex: 1, minWidth: 0 }}>
              {t("review.snooze.done", { date: short(v.until) })}
            </Text>
            <Button
              size="compact-sm"
              variant="subtle"
              color="gray"
              onClick={() => {
                notifications.hide(id);
                unsnoozeReviewRows(walletId, v.ids).then(onChanged, notifyError);
              }}
            >
              {t("review.snooze.undo")}
            </Button>
          </Group>
        ),
      });
    },
    onError: (e) => {
      refocus.current = null;
      notifyError(e);
    },
  });
  const unsnooze = useMutation({
    mutationFn: (ids: number[]) => unsnoozeReviewRows(walletId, ids),
    onSettled: onChanged,
    onError: notifyError,
  });
  const snoozeButton = (ids: number[]) => (
    <SnoozeMenu
      rowKey={ids[0]}
      loading={snooze.isPending && snooze.variables?.ids[0] === ids[0]}
      onSnooze={(until) => {
        const at = rowIds.indexOf(ids[0]);
        refocus.current = { gone: ids[0], next: rowIds[at + 1] ?? rowIds[at - 1] ?? null };
        snooze.mutate({ ids, until });
      }}
    />
  );

  const money = (tx: ReviewTxn) => formatMinor(tx.amount, fmtFor(accountById.get(tx.accountId)));

  const deleteButton = (ids: number[], label: string, title: string) => (
    <Button
      size="xs"
      variant="subtle"
      color="red"
      leftSection={<IconTrash size={14} />}
      loading={remove.isPending && remove.variables?.[0] === ids[0]}
      style={{ flexShrink: 0 }}
      onClick={async () => {
        const ok = await confirm({
          title,
          body: t("transactions.confirmDeleteBody"),
          confirmLabel: t("transactions.confirmDeleteAction"),
          danger: true,
        });
        if (ok) remove.mutate(ids);
      }}
    >
      {label}
    </Button>
  );

  // One line of a nested list: a bank row to merge with, or a side of a pair.
  const line = (tx: ReviewTxn, icon: ReactNode, action?: ReactNode, lead?: string) => (
    <Group
      key={tx.id}
      gap={phone ? "4px 12px" : "sm"}
      wrap={phone ? "wrap" : "nowrap"}
      py={6}
      style={{ borderTop: DASHED }}
    >
      {icon}
      <Text size="xs" ff="monospace" c={lead ? "dimmed" : undefined} style={{ flexShrink: 0 }}>
        {lead ?? fmtDate(tx.date)}
      </Text>
      <Text
        size="xs"
        truncate={!phone}
        style={
          phone
            ? { flexBasis: "100%", order: 5, paddingLeft: icon ? 26 : 0, overflowWrap: "anywhere" }
            : { flex: 1, minWidth: 0 }
        }
        data-cb-sensitive={!!tx.memo || undefined}
      >
        {tx.memo || t("review.noMemo")}
      </Text>
      <Text
        size="xs"
        ff="monospace"
        fw={600}
        c={amountColor(tx.amount)}
        style={{ flexShrink: 0, marginLeft: phone ? "auto" : undefined }}
        data-cb-sensitive
      >
        {money(tx)}
      </Text>
      {action}
    </Group>
  );

  const iconStyle = { flexShrink: 0, opacity: 0.6 };

  return (
    <Card withBorder data-testid="review-unconfirmed" data-tour="review-unconfirmed">
      <Stack gap="sm">
        <Stack gap={4}>
          {allSnoozed ? (
            <>
              <Text fw={600}>{t("review.unconfirmedTitle")}</Text>
              <Text size="sm" c="dimmed" maw={720}>
                {t("review.snooze.allSnoozed", {
                  count: snoozed.length,
                  date: withYear(snoozed.map((z) => z.until).sort()[0]),
                })}
              </Text>
            </>
          ) : (
            <>
              <Text fw={600}>
                {t("review.unconfirmed", { count: unconfirmed.length + reversals.length })}
              </Text>
              <Text size="sm" c="dimmed" maw={720}>
                <Trans i18nKey="review.unconfirmedHint" components={{ b: <b /> }} />
              </Text>
            </>
          )}
        </Stack>

        {reversals.map((p) => {
          const acc = accountById.get(p.payment.accountId);
          const removeBoth = deleteButton(
            [p.payment.id, p.reversal.id],
            t("review.deleteBoth"),
            t("review.confirmDeleteBothTitle"),
          );
          return (
            <Box
              key={`${p.payment.id}:${p.reversal.id}`}
              pt="sm"
              style={{ borderTop: RULE }}
              data-testid="review-reversal"
            >
              <Group justify="space-between" align="flex-start" wrap="nowrap" gap="md">
                <Box style={{ flex: 1, minWidth: 0 }}>
                  <Group gap={6} wrap="nowrap">
                    <IconArrowBackUp size={15} style={iconStyle} />
                    <Text size="sm" fw={600}>
                      {t("review.reversal")}
                    </Text>
                  </Group>
                  <Text size="xs" c="dimmed">
                    {t("review.reversalHint", { account: acc?.name ?? "" })}
                  </Text>
                </Box>
                {!phone && (
                  <Group gap={4} wrap="nowrap">
                    {snoozeButton([p.payment.id, p.reversal.id])}
                    {removeBoth}
                  </Group>
                )}
              </Group>
              <Stack gap={0} mt={8} ml={21}>
                {[p.payment, p.reversal].map((tx) =>
                  line(tx, <IconMail size={14} style={iconStyle} />),
                )}
              </Stack>
              {phone && (
                <Group gap="sm" mt={4}>
                  {snoozeButton([p.payment.id, p.reversal.id])}
                  {removeBoth}
                </Group>
              )}
            </Box>
          );
        })}

        {unconfirmed.map((u) => {
          const acc = accountById.get(u.accountId);
          const category = u.isSplit ? t("transactions.split") : categoryName(u.categoryId);
          const removeOne = deleteButton(
            [u.id],
            t("review.delete"),
            t("transactions.confirmDeleteTitle"),
          );
          const head = (
            <Box style={{ flex: 1, minWidth: 0 }}>
              <Group justify="space-between" wrap="nowrap" gap="sm">
                <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
                  <IconMail size={15} style={iconStyle} />
                  <Text size="sm" fw={600} truncate data-cb-sensitive={!!u.memo || undefined}>
                    {u.memo || t("review.noMemo")}
                  </Text>
                </Group>
                <Text
                  size="sm"
                  fw={600}
                  ff="monospace"
                  c={amountColor(u.amount)}
                  style={{ flexShrink: 0 }}
                  data-cb-sensitive
                >
                  {money(u)}
                </Text>
              </Group>
              <Text size="xs" c="dimmed">
                {[
                  fmtDate(u.date),
                  acc?.name,
                  t("review.mailAge", { count: daysSince(u.date) }),
                  category,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
            </Box>
          );
          return (
            <Box
              key={u.id}
              pt="sm"
              style={{ borderTop: RULE }}
              data-testid="review-unconfirmed-row"
            >
              {phone ? (
                head
              ) : (
                <Group justify="space-between" align="flex-start" wrap="nowrap" gap="md">
                  {head}
                  <Group gap={4} wrap="nowrap">
                    {snoozeButton([u.id])}
                    {removeOne}
                  </Group>
                </Group>
              )}
              {u.bankRows.length > 0 ? (
                <Stack gap={0} mt={8} ml={21}>
                  <Text size="xs" c="dimmed" mb={2}>
                    {t("review.bankRows")}
                  </Text>
                  {u.bankRows.map((b) =>
                    line(
                      b,
                      <IconBuildingBank size={14} style={iconStyle} />,
                      <Button
                        size="compact-xs"
                        variant="light"
                        leftSection={<IconGitMerge size={13} />}
                        style={{ flexShrink: 0 }}
                        loading={merge.isPending && merge.variables?.bankId === b.id}
                        onClick={() => merge.mutate({ mailId: u.id, bankId: b.id })}
                      >
                        {t("review.merge")}
                      </Button>,
                    ),
                  )}
                </Stack>
              ) : (
                <Text size="xs" c="dimmed" mt={6} ml={21}>
                  {t("review.noBankRows")}
                </Text>
              )}
              {phone && (
                <Group gap="sm" mt={4}>
                  {snoozeButton([u.id])}
                  {removeOne}
                </Group>
              )}
            </Box>
          );
        })}

        {snoozed.length > 0 && (
          <Box pt="sm" style={{ borderTop: RULE }} data-testid="review-snoozed">
            <UnstyledButton
              onClick={() => setFoldOpen(!showSnoozed)}
              data-snooze-fold
              aria-expanded={showSnoozed}
              style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }}
            >
              <IconClock size={15} style={iconStyle} />
              <Text size="sm" fw={600}>
                {t("review.snooze.list", { count: snoozed.length })}
              </Text>
              <IconChevronDown
                size={16}
                style={{
                  marginLeft: "auto",
                  opacity: 0.6,
                  transform: showSnoozed ? "rotate(180deg)" : undefined,
                }}
              />
            </UnstyledButton>
            {showSnoozed && (
              <Stack gap={0} mt={8} ml={21}>
                {snoozed.map((z) =>
                  line(
                    z.reversal
                      ? { ...z, memo: `${t("review.reversal")} · ${z.memo || t("review.noMemo")}` }
                      : z,
                    null,
                    <Button
                      size="compact-xs"
                      variant="light"
                      leftSection={<IconRestore size={13} />}
                      style={{ flexShrink: 0 }}
                      loading={unsnooze.isPending && unsnooze.variables?.[0] === z.id}
                      onClick={() => unsnooze.mutate(z.reversal ? [z.id, z.reversal.id] : [z.id])}
                    >
                      {t("review.snooze.now")}
                    </Button>,
                    t("review.snooze.back", { date: withYear(z.until) }),
                  ),
                )}
              </Stack>
            )}
          </Box>
        )}
      </Stack>
    </Card>
  );
}
