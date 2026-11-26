import {
  Badge,
  Box,
  Button,
  Center,
  Group,
  Loader,
  Modal,
  Radio,
  Select,
  Stack,
  Text,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { IconLock } from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  ApiError,
  type RegisterRow,
  findDuplicateTransactions,
  getTransaction,
  mergeRows,
} from "../api/client";
import { amountColor } from "../amountTone";
import { useDateFormat } from "../dates";
import { formatMinor, type MoneyFormat } from "../money";
import { notifyError } from "../notifyError";
import { CategoryCell, LeadCell, ROW_HEIGHT, ROW_HEIGHT_WITH_SUB } from "./RegisterTable";
import { BAND_INSET, ROW_COLUMNS, ROW_GAP, ROW_TYPE, STATUS_COLORS } from "./registerTheme";
import {
  MERGE_FIELDS,
  bankFirst,
  defaultPicks,
  mergeBlock,
  mergedRow,
  sameField,
  takeFromOther,
  type MergeField,
  type MergeRow,
  type Picks,
  type Side,
} from "./mergeRows";

// Why the server refused a merge, by its code: the rows changed meanwhile.
const MERGE_REFUSED: Record<string, string> = {
  different_accounts: "merge.why.accounts",
  not_mergeable: "merge.why.kind",
  not_found: "merge.gone",
};

// Inside the dialog: the modal's radius less its padding is below zero, so the
// smallest radius the theme has.
const INNER_RADIUS = "var(--mantine-radius-sm)";
// The columns a register row shows by default, less the running balance the
// merged row does not have yet.
const PREVIEW_COLUMNS = ["date", "payee", "category", "status", "amount"]
  .map((c) => ROW_COLUMNS[c])
  .join(" ");

/** One tab stop per radiogroup: the checked card, else the first. */
const rovingTab = (checked: boolean, anyChecked: boolean, first: boolean) =>
  checked || (!anyChecked && first) ? 0 : -1;

/** An unchecked indicator's ring in the dimmed colour, 3:1 on light and dark. */
const ringStyle = (checked: boolean) =>
  checked ? undefined : { borderColor: "var(--mantine-color-dimmed)" };

const FIELD_LABEL: Record<MergeField, string> = {
  date: "transactions.date",
  payee: "transactions.payee",
  category: "transactions.category",
  memo: "transactions.memo",
  tags: "transactions.tags",
  status: "transactions.status",
  amount: "transactions.amount",
};

/**
 * Merges two register rows into one, field by field (#786). Given two rows it
 * opens on the choices; given one ("Merge with…") it first asks for the other.
 */
export function MergeRowsModal({
  walletId,
  rows,
  ledger,
  fmt,
  accountName,
  onClose,
  onMerged,
}: {
  walletId: number;
  /** One or two register rows. */
  rows: RegisterRow[];
  /** The account's register, where the other row is picked from. */
  ledger: RegisterRow[];
  fmt: MoneyFormat;
  accountName: string;
  onClose: () => void;
  /** The merge's undo token, the row that stayed and a line naming it. */
  onMerged: (token: string, keptId: number, kept: string) => void;
}) {
  const { t } = useTranslation();
  const phone = useMediaQuery("(max-width: 47.99em)") ?? false;
  const [partner, setPartner] = useState<RegisterRow | null>(null);
  const pair = rows.length === 2 ? rows : partner ? [rows[0], partner] : null;
  return (
    <Modal
      opened
      onClose={onClose}
      size={760}
      fullScreen={phone}
      title={pair ? t("merge.title") : t("merge.with")}
    >
      {pair ? (
        <MergeChoices
          walletId={walletId}
          rows={pair as [RegisterRow, RegisterRow]}
          fmt={fmt}
          accountName={accountName}
          phone={phone}
          onClose={onClose}
          onMerged={onMerged}
        />
      ) : (
        <PickOther
          walletId={walletId}
          row={rows[0]}
          ledger={ledger}
          fmt={fmt}
          phone={phone}
          onClose={onClose}
          onPick={setPartner}
        />
      )}
    </Modal>
  );
}

const PAD = "var(--mb-padding, var(--mantine-spacing-md))";

/** The dialog's buttons; on a phone they stay at the foot of the screen. */
function Foot({ phone, children }: { phone: boolean; children: ReactNode }) {
  return (
    <Group
      justify="flex-end"
      gap={12}
      mt={24}
      style={
        phone
          ? {
              position: "sticky",
              bottom: 0,
              margin: `24px calc(-1 * ${PAD}) calc(-1 * ${PAD})`,
              padding: `12px ${PAD}`,
              background: "var(--mantine-color-body)",
              borderTop: "1px solid var(--mantine-color-default-border)",
            }
          : undefined
      }
    >
      {children}
    </Group>
  );
}

/** "Merge with…": the rows likely to be the same movement, or any other. */
function PickOther({
  walletId,
  row,
  ledger,
  fmt,
  phone,
  onClose,
  onPick,
}: {
  walletId: number;
  row: RegisterRow;
  ledger: RegisterRow[];
  fmt: MoneyFormat;
  phone: boolean;
  onClose: () => void;
  onPick: (r: RegisterRow) => void;
}) {
  const { t } = useTranslation();
  const fmtDate = useDateFormat();
  const [chosen, setChosen] = useState<string | null>(null);
  const mergeable = useMemo(
    () => ledger.filter((r) => r.id !== row.id && mergeBlock([row, r]) === null),
    [ledger, row],
  );
  const byId = useMemo(() => new Map(mergeable.map((r) => [r.id, r])), [mergeable]);
  // The duplicate finder's: same account and amount, within three days.
  const likely = useQuery({
    queryKey: ["duplicates", walletId, row.accountId, row.date, row.amount],
    queryFn: () => findDuplicateTransactions(walletId, row.accountId, row.date, row.amount),
  });
  const candidates = (likely.data ?? []).flatMap((d) => byId.get(d.id) ?? []);
  const describe = (r: RegisterRow) =>
    `${fmtDate(r.date)} · ${r.payeeName || r.memo || "—"} · ${formatMinor(r.amount, fmt)}`;
  const options = useMemo(
    () => [...mergeable].reverse().map((r) => ({ value: String(r.id), label: describe(r) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mergeable],
  );
  const picked = chosen ? byId.get(Number(chosen)) : undefined;

  return (
    <Stack gap={12}>
      <Text fz={14} c="dimmed">
        {describe(row)}
      </Text>
      <Text fz={13} fw={500}>
        {t("merge.pickLikely")}
      </Text>
      {likely.isLoading ? (
        <Loader size="sm" />
      ) : candidates.length === 0 ? (
        <Text fz={14} c="dimmed">
          {t("merge.pickNone")}
        </Text>
      ) : (
        <Stack gap={8} role="radiogroup" aria-label={t("merge.pickLikely")}>
          {candidates.map((r, i) => {
            const checked = chosen === String(r.id);
            const anyChecked = candidates.some((c) => chosen === String(c.id));
            return (
              <Radio.Card
                key={r.id}
                name="merge-partner"
                checked={checked}
                tabIndex={rovingTab(checked, anyChecked, i === 0)}
                onClick={() => setChosen(String(r.id))}
                p="8px 12px"
                radius={INNER_RADIUS}
                bg={checked ? "var(--mantine-primary-color-light)" : undefined}
              >
                <Group gap={8} wrap="nowrap" align="center">
                  <Radio.Indicator size="xs" style={ringStyle(checked)} />
                  <Text fz={14}>{describe(r)}</Text>
                </Group>
              </Radio.Card>
            );
          })}
        </Stack>
      )}
      <Select
        label={t("merge.pickOther")}
        placeholder={t("merge.pickOtherPlaceholder")}
        data={options}
        value={chosen}
        onChange={setChosen}
        searchable
        clearable
        limit={100}
        comboboxProps={{ withinPortal: true }}
      />
      <Foot phone={phone}>
        <Button variant="default" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button disabled={!picked} onClick={() => picked && onPick(picked)}>
          {t("merge.next")}
        </Button>
      </Foot>
    </Stack>
  );
}

/** The two rows side by side, a choice per field, and the row they make. */
function MergeChoices({
  walletId,
  rows,
  fmt,
  accountName,
  phone,
  onClose,
  onMerged,
}: {
  walletId: number;
  rows: [RegisterRow, RegisterRow];
  fmt: MoneyFormat;
  accountName: string;
  phone: boolean;
  onClose: () => void;
  /** The merge's undo token, the row that stayed and a line naming it. */
  onMerged: (token: string, keptId: number, kept: string) => void;
}) {
  const { t } = useTranslation();
  const fmtDate = useDateFormat();
  const qc = useQueryClient();
  // The register leaves out tags and the import ref: each row is read whole,
  // keeping the register's names for its payee and category.
  const whole = useQuery({
    queryKey: ["merge-rows", walletId, rows[0].id, rows[1].id],
    queryFn: async () => {
      const [a, b] = await Promise.all(rows.map((r) => getTransaction(walletId, r.id)));
      const named = (full: typeof a, r: RegisterRow): MergeRow => ({
        ...full,
        payeeName: r.payeeName,
        categoryName: r.categoryName,
      });
      return bankFirst(named(a, rows[0]), named(b, rows[1]));
    },
    gcTime: 0,
  });
  const [chosen, setChosen] = useState<Partial<Picks>>({});
  const pair = whole.data;
  const picks: Picks | null = pair ? { ...defaultPicks(pair), ...chosen } : null;

  const merge = useMutation({
    mutationFn: () => mergeRows(walletId, pair![0].id, pair![1].id, takeFromOther(pair!, picks!)),
    onSuccess: (res) => {
      const kept = mergedRow(pair!, picks!);
      onMerged(
        res.token,
        kept.id,
        `${fmtDate(kept.date)} · ${kept.payeeName || kept.memo || "—"} · ${formatMinor(kept.amount, fmt)}`,
      );
    },
    onError: (err) => {
      const why = err instanceof ApiError ? MERGE_REFUSED[err.code ?? ""] : undefined;
      if (why) notifications.show({ color: "red", message: t(why) });
      else notifyError(err);
      // Something changed under the dialog: show the rows as they are now.
      void qc.invalidateQueries({ queryKey: ["register", walletId] });
      void whole.refetch();
    },
  });

  // A figure never breaks before its currency sign.
  function unbroken(figure: string) {
    return figure.replace(/ /g, "\u00a0");
  }

  if (whole.isError) {
    return (
      <Stack align="center" gap="sm" py="lg">
        <Text fz={14}>{t("merge.loadFailed")}</Text>
        <Button variant="default" onClick={() => void whole.refetch()}>
          {t("merge.retry")}
        </Button>
      </Stack>
    );
  }
  if (!pair || !picks) {
    return (
      <Center h={160}>
        <Loader size="sm" />
      </Center>
    );
  }

  const text = (r: MergeRow, f: MergeField): string => {
    switch (f) {
      case "date":
        return fmtDate(r.date);
      case "payee":
        return r.payeeName || "—";
      case "category":
        return r.categoryName || t("filters.uncategorised");
      case "memo":
        return r.memo.trim() || "—";
      case "tags":
        return r.tags.length > 0 ? r.tags.join(", ") : "—";
      case "status":
        return t(`status.${r.status}`);
      case "amount":
        return unbroken(formatMinor(r.amount, fmt));
    }
  };
  const origin = (r: MergeRow) =>
    !r.importRef ? "hand" : r.importRef.startsWith("mail:") ? "mail" : "bank";
  const result = mergedRow(pair, picks);
  const amountsDiffer = pair[0].amount !== pair[1].amount;

  // The amounts, each figure whole and in the attention colour, inside the
  // one sentence that names them.
  const amountsLine = () => {
    const [before, mid, after] = t("merge.amountsDiffer", { a: "%%A%%", b: "%%B%%" }).split(
      /%%[AB]%%/,
    );
    const figure = (minor: number) => (
      <Text span inherit c="var(--cb-attention)" fw={500} style={{ whiteSpace: "nowrap" }}>
        {unbroken(formatMinor(minor, fmt))}
      </Text>
    );
    return (
      <Text fz={13} c="dimmed" mt={12} data-testid="merge-amounts-differ" data-cb-sensitive>
        {before}
        {figure(pair[0].amount)}
        {mid}
        {figure(pair[1].amount)}
        {after}
      </Text>
    );
  };
  const uncategorised = !result.categoryName;

  return (
    <Stack gap={0}>
      <Text fz={14} c="dimmed" mb={16}>
        {t("merge.lead", { account: accountName })}
      </Text>
      <Box
        style={{
          display: "grid",
          gridTemplateColumns: phone
            ? "minmax(0, 1fr) minmax(0, 1fr)"
            : "112px minmax(0, 1fr) minmax(0, 1fr)",
          gap: "8px 12px",
        }}
      >
        {!phone && <div />}
        {pair.map((r, i) => (
          <Box key={r.id}>
            <Text fz={13} fw={500}>
              {i + 1} · {t(`merge.origin.${origin(r)}`)}
            </Text>
            <Text fz={12} c="dimmed">
              {t("merge.added", { date: fmtDate(r.createdAt) })}
            </Text>
          </Box>
        ))}
        {MERGE_FIELDS.map((f) => {
          const same = sameField(pair, f);
          const label = t(FIELD_LABEL[f]);
          const value = (r: MergeRow, dim = false) => (
            <Text
              fz={14}
              lh={1.35}
              c={dim ? "dimmed" : f === "amount" ? amountColor(r.amount) : undefined}
              style={{ overflowWrap: "anywhere" }}
              data-cb-sensitive={f === "amount" || undefined}
            >
              {text(r, f)}
            </Text>
          );
          return (
            <Fragment key={f}>
              <Text
                fz={13}
                c="dimmed"
                style={{
                  alignSelf: "center",
                  ...(phone ? { gridColumn: "1 / -1", marginTop: 8 } : {}),
                }}
              >
                {label}
              </Text>
              {same ? (
                // The same in both rows: nothing to choose.
                <Group gap={8} px={12} py={8} style={{ gridColumn: "span 2" }}>
                  {value(pair[0], true)}
                  <Text fz={13} c="dimmed">
                    · {t("merge.same")}
                  </Text>
                </Group>
              ) : (
                <Box
                  role="radiogroup"
                  aria-label={label}
                  style={{
                    gridColumn: "span 2",
                    display: "grid",
                    gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
                    gap: 12,
                  }}
                >
                  {pair.map((r, i) => {
                    const checked = picks[f] === i;
                    return (
                      <Radio.Card
                        key={r.id}
                        name={`merge-${f}`}
                        value={String(i)}
                        checked={checked}
                        tabIndex={rovingTab(checked, true, i === 0)}
                        aria-label={`${i + 1} · ${label}: ${text(r, f)}`}
                        onClick={() => setChosen((c) => ({ ...c, [f]: i as Side }))}
                        p="8px 12px"
                        radius={INNER_RADIUS}
                        bg={checked ? "var(--mantine-primary-color-light)" : undefined}
                      >
                        <Group gap={8} wrap="nowrap" align="center">
                          <Radio.Indicator size="xs" style={ringStyle(checked)} />
                          {/* On a phone the column heads scroll away: the card
                              says which row it is. */}
                          {phone && (
                            <Text fz={12} c="dimmed" aria-hidden>
                              {i + 1}
                            </Text>
                          )}
                          {value(r)}
                        </Group>
                      </Radio.Card>
                    );
                  })}
                </Box>
              )}
            </Fragment>
          );
        })}
      </Box>
      {amountsDiffer && amountsLine()}

      <Box
        mt={16}
        pt={12}
        style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}
        data-testid="merge-result"
      >
        <Text fz={12} fw={500} c="dimmed" mb={8}>
          {t("merge.result")}
        </Text>
        {/* The row as the register will draw it: its columns, type and height. */}
        <Box
          style={{
            overflowX: "auto",
            background: "var(--cb-ledger-surface)",
            border: "1px solid var(--cb-ledger-border)",
            borderRadius: INNER_RADIUS,
          }}
        >
          <Box
            style={{
              display: "grid",
              gridTemplateColumns: PREVIEW_COLUMNS,
              gap: ROW_GAP,
              alignItems: "center",
              padding: `0 ${BAND_INSET}px`,
              height: result.memo || uncategorised ? ROW_HEIGHT_WITH_SUB : ROW_HEIGHT,
              minWidth: "max-content",
            }}
          >
            <Text fz={ROW_TYPE.date.fz} style={{ whiteSpace: "nowrap" }}>
              {fmtDate(result.date)}
            </Text>
            <LeadCell
              lead={result.payeeName}
              sub={
                // As the register's: the memo, else that it needs a category.
                result.memo
                  ? { text: result.memo }
                  : uncategorised
                    ? { text: t("register.needsCategory"), attention: true }
                    : undefined
              }
            />
            <CategoryCell
              name={result.categoryName ?? t("filters.uncategorised")}
              uncategorised={uncategorised}
            />
            <Group gap={4} wrap="nowrap">
              <Badge variant="light" tt="none" color={STATUS_COLORS[result.status] ?? "gray"}>
                {t(`status.${result.status}`)}
              </Badge>
              {result.status === 2 && <IconLock size={12} opacity={0.5} />}
            </Group>
            <Text
              size="sm"
              ta="right"
              c={amountColor(result.amount)}
              data-cb-sensitive
              style={{ whiteSpace: "nowrap" }}
            >
              {formatMinor(result.amount, fmt)}
            </Text>
          </Box>
        </Box>
        {origin(pair[0]) === "bank" && (
          <Text fz={12} c="dimmed" mt={8}>
            {t("merge.keepsRef")}
          </Text>
        )}
      </Box>

      <Foot phone={phone}>
        <Button variant="default" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button loading={merge.isPending} onClick={() => merge.mutate()}>
          {t("merge.action")}
        </Button>
      </Foot>
    </Stack>
  );
}
