import {
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
import { IconAlertTriangle } from "@tabler/icons-react";
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
  /** The merge's undo token, and the row that stayed. */
  onMerged: (token: string, keptId: number) => void;
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
      styles={{ title: { fontSize: 18, fontWeight: 600 } }}
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
      gap="sm"
      mt={18}
      style={
        phone
          ? {
              position: "sticky",
              bottom: 0,
              margin: `18px calc(-1 * ${PAD}) calc(-1 * ${PAD})`,
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
    <Stack gap="sm">
      <Text fz={14} c="dimmed">
        {describe(row)}
      </Text>
      <Text fz={13} fw={600}>
        {t("merge.pickLikely")}
      </Text>
      {likely.isLoading ? (
        <Loader size="sm" />
      ) : candidates.length === 0 ? (
        <Text fz={14} c="dimmed">
          {t("merge.pickNone")}
        </Text>
      ) : (
        <Stack gap={6}>
          {candidates.map((r) => (
            <Radio.Card
              key={r.id}
              name="merge-partner"
              checked={chosen === String(r.id)}
              onClick={() => setChosen(String(r.id))}
              p="8px 10px"
              radius="md"
              bg={chosen === String(r.id) ? "var(--mantine-primary-color-light)" : undefined}
            >
              <Group gap={8} wrap="nowrap" align="flex-start">
                <Radio.Indicator size="xs" mt={3} />
                <Text fz={14}>{describe(r)}</Text>
              </Group>
            </Radio.Card>
          ))}
        </Stack>
      )}
      <Select
        label={t("merge.pickOther")}
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
  /** The merge's undo token, and the row that stayed. */
  onMerged: (token: string, keptId: number) => void;
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
    onSuccess: (res) => onMerged(res.token, pair![0].id),
    onError: (err) => {
      const why = err instanceof ApiError ? MERGE_REFUSED[err.code ?? ""] : undefined;
      if (why) notifications.show({ color: "red", message: t(why) });
      else notifyError(err);
      // Something changed under the dialog: show the rows as they are now.
      void qc.invalidateQueries({ queryKey: ["register", walletId] });
      void whole.refetch();
    },
  });

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
        return formatMinor(r.amount, fmt);
    }
  };
  const origin = (r: MergeRow) =>
    !r.importRef ? "hand" : r.importRef.startsWith("mail:") ? "mail" : "bank";
  const result = mergedRow(pair, picks);
  const amountsDiffer = pair[0].amount !== pair[1].amount;

  return (
    <Stack gap={0}>
      <Text fz={14} c="dimmed">
        {t("merge.lead", { account: accountName })}
      </Text>
      <Text fz={13} c="dimmed" mb={16}>
        {t("merge.rule")}
      </Text>
      {amountsDiffer && (
        // A strip, not an alert box: amber from the attention tokens.
        <Group
          gap={10}
          wrap="nowrap"
          align="flex-start"
          mb={14}
          p="10px 12px"
          role="status"
          data-testid="merge-amounts-differ"
          style={{
            background: "var(--cb-attention-bg)",
            border: "1px solid var(--cb-attention-border)",
            borderRadius: "var(--mantine-radius-md)",
          }}
        >
          <IconAlertTriangle size={18} color="var(--cb-attention)" style={{ flexShrink: 0 }} />
          <Text fz={14}>
            <Text span fw={700} inherit c="var(--cb-attention)">
              {t("merge.amountsDiffer")}
            </Text>{" "}
            {t("merge.amountsDifferBody", {
              a: formatMinor(pair[0].amount, fmt),
              b: formatMinor(pair[1].amount, fmt),
            })}
          </Text>
        </Group>
      )}
      <Box
        style={{
          display: "grid",
          gridTemplateColumns: phone
            ? "minmax(0, 1fr) minmax(0, 1fr)"
            : "110px minmax(0, 1fr) minmax(0, 1fr)",
          gap: "6px 10px",
        }}
      >
        {!phone && <div />}
        {pair.map((r, i) => (
          <Box key={r.id} pb={2} px={2}>
            <Text fz={13} fw={600}>
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
          const mono = f === "date" || f === "amount";
          const value = (r: MergeRow, dim = false) => (
            <Text
              fz={14}
              lh={1.35}
              ff={mono ? "monospace" : undefined}
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
                  ...(phone ? { gridColumn: "1 / -1", marginTop: 6 } : {}),
                }}
              >
                {label}
              </Text>
              {same ? (
                // The same in both rows: nothing to choose.
                <Group gap={6} px={10} py={8} style={{ gridColumn: "span 2" }}>
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
                    gap: 10,
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
                        aria-label={`${i + 1} · ${label}: ${text(r, f)}`}
                        onClick={() => setChosen((c) => ({ ...c, [f]: i as Side }))}
                        p="8px 10px"
                        radius="md"
                        bg={checked ? "var(--mantine-primary-color-light)" : undefined}
                      >
                        <Group gap={8} wrap="nowrap" align="flex-start">
                          <Radio.Indicator size="xs" mt={3} />
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

      <Box
        mt={16}
        pt={12}
        style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}
        data-testid="merge-result"
      >
        <Text fz={12} fw={600} c="dimmed">
          {t("merge.result")}
        </Text>
        <Box
          mt={6}
          p="10px 12px"
          style={{
            display: "grid",
            gridTemplateColumns: phone ? "minmax(0, 1fr) auto" : "96px minmax(0, 1fr) 140px 100px",
            gap: 12,
            alignItems: "start",
            border: "1px solid var(--mantine-color-default-border)",
            borderRadius: "var(--mantine-radius-md)",
            background: "var(--cb-band-divider)",
          }}
        >
          <Text fz={14} ff="monospace">
            {fmtDate(result.date)}
          </Text>
          <Box style={phone ? { gridColumn: "1 / -1", gridRow: 2 } : undefined}>
            <Text fz={14}>{result.payeeName || "—"}</Text>
            <Text fz={12} c="dimmed" style={{ overflowWrap: "anywhere" }}>
              {result.memo}
            </Text>
          </Box>
          <Box style={phone ? { gridColumn: "1 / -1", gridRow: 3 } : undefined}>
            <Text fz={14}>{result.categoryName || t("filters.uncategorised")}</Text>
            <Text fz={12} c="dimmed">
              {t(`status.${result.status}`)}
              {result.tags.length > 0 && ` · ${result.tags.join(", ")}`}
            </Text>
          </Box>
          <Text
            fz={14}
            ff="monospace"
            ta="right"
            c={amountColor(result.amount)}
            data-cb-sensitive
            style={phone ? { gridColumn: 2, gridRow: 1 } : undefined}
          >
            {formatMinor(result.amount, fmt)}
          </Text>
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
