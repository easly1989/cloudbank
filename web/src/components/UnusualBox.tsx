import { Button, Group, Stack, Table, Text } from "@mantine/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";

import {
  aiUnusualKey,
  setAIUnusualFeedback,
  setAIUnusualFine,
  type AIUnusual,
  type AIUnusualRow,
} from "../api/ai";
import { dismissDuplicatePair } from "../api/client";
import { formatMinor } from "../money";
import { notifyError } from "../notifyError";
import { useDayMonth } from "../pages/categories/labels";
import { paragraphs, splitAmounts } from "../pages/insightsText";
import { useToday } from "../useToday";
import { AiBox } from "./AiBox";
import { Money } from "./ProposalBox";
import { pairAnchor, useUnusual } from "./unusualData";

// The AI's unusual transactions (#700): the expenses CloudBank flagged, each
// with its own way to the register and "It's fine"; a double charge leads to
// its pair among Review's possible duplicates instead. The short form, for
// the overview, leaves the rows to Review.

export function UnusualBox({
  walletId,
  unusual,
  short,
}: {
  walletId: number;
  unusual: AIUnusual;
  /** The overview's form: no rows, a link to Review. */
  short?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const day = useDayMonth(useToday());
  const rows = unusual.rows;
  const key = aiUnusualKey(walletId);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: key });
    void qc.invalidateQueries({ queryKey: ["review", walletId] });
  };

  const fine = useMutation({
    mutationFn: (r: AIUnusualRow) =>
      r.kind === "double"
        ? dismissDuplicatePair(walletId, r.otherId ?? 0, r.transactionId)
        : setAIUnusualFine(walletId, r.id),
    onSuccess: refresh,
    onError: notifyError,
  });
  const feedback = useMutation({
    mutationFn: (v: -1 | 0 | 1) => setAIUnusualFeedback(walletId, v),
    onMutate: (v) => qc.setQueryData<AIUnusual>(key, (c) => (c ? { ...c, feedback: v } : c)),
    onError: (err) => {
      notifyError(err);
      void qc.invalidateQueries({ queryKey: key });
    },
  });

  const amount = (r: AIUnusualRow) => formatMinor(r.amount, r.currency);
  const reason = (r: AIUnusualRow) => {
    switch (r.kind) {
      case "scale":
        return t("unusual.reason.scale", {
          times: Math.round(r.amount / Math.max(1, r.usual)),
          usual: formatMinor(r.usual, r.currency),
          payments: r.payments,
        });
      case "new":
        return t("unusual.reason.new");
      default:
        return t("unusual.reason.double", { first: day(r.otherDate ?? ""), second: day(r.date) });
    }
  };
  // The pair is on the same page, among the possible duplicates.
  const toPair = (r: AIUnusualRow) =>
    document
      .getElementById(pairAnchor(r.otherId ?? 0, r.transactionId))
      ?.scrollIntoView({ behavior: "smooth", block: "center" });

  const made = unusual.createdAt
    ? new Intl.DateTimeFormat(i18n.language, { day: "numeric", month: "long" }).format(
        new Date(unusual.createdAt),
      )
    : "";

  const why = (
    <Table.ScrollContainer minWidth={520}>
      <Table verticalSpacing={4} fz="xs">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t("unusual.why.transaction")}</Table.Th>
            <Table.Th ta="right">{t("unusual.why.amount")}</Table.Th>
            <Table.Th ta="right">{t("unusual.why.usual")}</Table.Th>
            <Table.Th ta="right">{t("unusual.why.payments")}</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((r) => (
            <Table.Tr key={r.id}>
              <Table.Td>
                {r.payee},{" "}
                {r.kind === "double" ? `${day(r.otherDate ?? "")}, ${day(r.date)}` : day(r.date)}
              </Table.Td>
              <Table.Td ta="right">
                <Money>{amount(r)}</Money>
              </Table.Td>
              <Table.Td ta="right">
                {r.kind === "new" ? (
                  "—"
                ) : (
                  <Money>{formatMinor(r.kind === "scale" ? r.usual : r.amount, r.currency)}</Money>
                )}
              </Table.Td>
              <Table.Td ta="right">{r.kind === "scale" ? r.payments : "—"}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Text fz="xs" c="dimmed" mt={6}>
        {t("unusual.why.note", { model: unusual.model || "—" })}
      </Text>
    </Table.ScrollContainer>
  );

  return (
    <AiBox
      label={t("proposal.label")}
      basis={made ? t("unusual.basis", { date: made }) : t("unusual.basisNoDate")}
      title={t("unusual.title", { count: rows.length })}
      why={short ? undefined : why}
      feedback={unusual.body ? unusual.feedback : undefined}
      onFeedback={unusual.body ? (v) => feedback.mutate(v) : undefined}
      actions={
        short && (
          <Button size="xs" variant="light" component={Link} to="/review?from=dashboard">
            {t("unusual.seeInReview")}
          </Button>
        )
      }
    >
      {paragraphs(unusual.body).map((para, i) => (
        <Text key={i} fz="inherit" lh="inherit" mb={4}>
          {splitAmounts(para).map((part, j) => (j % 2 ? <Money key={j}>{part}</Money> : part))}
        </Text>
      ))}
      {!short && (
        <Stack gap={0} mt={10}>
          {rows.map((r) => {
            const double = r.kind === "double";
            return (
              <Group
                key={r.id}
                justify="space-between"
                gap="xs"
                py={8}
                style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}
              >
                <Stack gap={0} style={{ minWidth: 0, flex: "1 1 220px" }}>
                  <Text fz={14} fw={600}>
                    {r.payee}
                  </Text>
                  <Text fz="xs" c="dimmed">
                    {reason(r)}
                  </Text>
                </Stack>
                <Group gap="md" wrap="nowrap">
                  <Stack gap={0} align="flex-end">
                    <Text fz={14}>
                      <Money>{amount(r)}</Money>
                    </Text>
                    <Text fz="xs" c="dimmed">
                      {day(r.date)}
                    </Text>
                  </Stack>
                  <Button
                    size="xs"
                    variant="light"
                    aria-label={
                      double
                        ? t("unusual.pairLabel", { payee: r.payee })
                        : t("unusual.openLabel", { payee: r.payee, amount: amount(r) })
                    }
                    onClick={() =>
                      double
                        ? toPair(r)
                        : navigate(`/transactions?account=${r.accountId}&txn=${r.transactionId}`)
                    }
                  >
                    {double ? t("unusual.pair") : t("unusual.open")}
                  </Button>
                  <Button
                    size="xs"
                    variant="subtle"
                    color="gray"
                    aria-label={
                      double
                        ? t("unusual.notDuplicateLabel", { payee: r.payee })
                        : t("unusual.fineLabel", { payee: r.payee, amount: amount(r) })
                    }
                    loading={fine.isPending && fine.variables?.id === r.id}
                    onClick={() => fine.mutate(r)}
                  >
                    {double ? t("review.notDuplicate") : t("unusual.fine")}
                  </Button>
                </Group>
              </Group>
            );
          })}
        </Stack>
      )}
    </AiBox>
  );
}

/** Mounts the unusual transactions waiting on a wallet, if any. */
export function UnusualBoxFor(props: { walletId: number; short?: boolean; accountId?: number }) {
  const u = useUnusual(props.walletId);
  if (!u) return null;
  const rows = props.accountId ? u.rows.filter((r) => r.accountId === props.accountId) : u.rows;
  return rows.length > 0 ? <UnusualBox {...props} unusual={{ ...u, rows }} /> : null;
}
