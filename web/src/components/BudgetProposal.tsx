import { Button, Group, Stack, Table, Text } from "@mantine/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";

import {
  actOnAIProposal,
  aiProposalsKey,
  setAIProposalFeedback,
  type AIProposal,
  type AIProposalRow,
} from "../api/ai";
import { formatMinor } from "../money";
import { notifyError } from "../notifyError";
import { sensitive } from "../privacy";
import { paragraphs, splitAmounts } from "../pages/insightsText";
import { AiBox, type Feedback } from "./AiBox";
import { applyPath, useBudgetProposal } from "./budgetProposalData";

// The AI's budget proposal (#698): CloudBank's amounts, a row per category
// with its own Apply, the model's two or three sentences above them. Apply
// never saves: it opens the budget form filled in. The short form, for the
// overview, leaves the rows to Budget.

/** A whole amount without its zeros: "60 €" rather than "60,00 €". */
function round(v: number, cur: AIProposal["basis"]["currency"]) {
  const s = formatMinor(v, cur);
  const zeros = cur.fracDigits > 0 ? cur.decimalChar + "0".repeat(cur.fracDigits) : "";
  return zeros && v % 10 ** cur.fracDigits === 0 ? s.replace(zeros, "") : s;
}

function Money({ children, dim }: { children: string; dim?: boolean }) {
  return (
    <Text
      span
      ff="monospace"
      fz="inherit"
      c={dim ? "dimmed" : undefined}
      style={{ whiteSpace: "nowrap" }}
      {...sensitive}
    >
      {children}
    </Text>
  );
}

const pathOf = (name: string) => name.replace(/:/g, " › ");

export function BudgetProposal({
  walletId,
  proposal: p,
  short,
  onApply,
}: {
  walletId: number;
  proposal: AIProposal;
  /** The overview's form: no rows, a link to Budget. */
  short?: boolean;
  /** Opens the budget form; without it Apply goes to Budget. */
  onApply?: (p: AIProposal, r: AIProposalRow) => void;
}) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const cur = p.basis.currency;
  const months = p.basis.months.length;
  const key = aiProposalsKey(walletId);

  const act = useMutation({
    mutationFn: (action: "later" | "ignore") => actOnAIProposal(walletId, p.id, action),
    onSuccess: () => void qc.invalidateQueries({ queryKey: key }),
    onError: notifyError,
  });
  const feedback = useMutation({
    mutationFn: (value: Feedback) => setAIProposalFeedback(walletId, p.id, value),
    onMutate: (value) =>
      qc.setQueryData<{ proposals: AIProposal[] }>(key, (c) =>
        c
          ? { proposals: c.proposals.map((x) => (x.id === p.id ? { ...x, feedback: value } : x)) }
          : c,
      ),
    onError: (err) => {
      notifyError(err);
      void qc.invalidateQueries({ queryKey: key });
    },
  });

  const made = new Intl.DateTimeFormat(i18n.language, { day: "numeric", month: "long" }).format(
    new Date(p.createdAt),
  );
  const monthHead = (m: string) =>
    new Intl.DateTimeFormat(i18n.language, { month: "short", timeZone: "UTC" }).format(
      new Date(`${m}-01T00:00:00Z`),
    );

  const rows = (
    <Stack gap={0} mt={10}>
      {p.basis.rows.map((r) => (
        <Group
          key={r.categoryId}
          justify="space-between"
          gap="xs"
          py={8}
          style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}
        >
          <Stack gap={0} style={{ minWidth: 0, flex: "1 1 200px" }}>
            <Text fz={14} fw={600}>
              {pathOf(r.name)}
            </Text>
            <Text fz="xs" c="dimmed">
              {t(`proposal.reason.${r.reason}`, { hits: r.hits, months })}
            </Text>
          </Stack>
          <Group gap="md" wrap="nowrap">
            <Text fz={14}>
              {r.budget === 0 ? (
                <Text span c="dimmed" fz="inherit">
                  {t("proposal.none")}
                </Text>
              ) : (
                <s>
                  <Money dim>{round(r.budget, cur)}</Money>
                </s>
              )}{" "}
              <Text span c="dimmed" fz="inherit" aria-hidden>
                →
              </Text>{" "}
              <Money>{round(r.proposed, cur)}</Money>
            </Text>
            <Button
              size="xs"
              variant="light"
              aria-label={t("proposal.applyLabel", {
                amount: round(r.proposed, cur),
                name: pathOf(r.name),
              })}
              onClick={() => (onApply ? onApply(p, r) : navigate(applyPath(p, r)))}
            >
              {t("proposal.apply")}
            </Button>
          </Group>
        </Group>
      ))}
    </Stack>
  );

  const why = (
    <Table.ScrollContainer minWidth={520}>
      <Table verticalSpacing={4} fz="xs">
        <Table.Thead>
          <Table.Tr>
            <Table.Th />
            {p.basis.months.map((m) => (
              <Table.Th key={m} ta="right">
                {monthHead(m)}
              </Table.Th>
            ))}
            <Table.Th ta="right">{t("proposal.why.median")}</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {p.basis.rows.map((r) => (
            <Table.Tr key={r.categoryId}>
              <Table.Td>{pathOf(r.name)}</Table.Td>
              {r.months.map((v, i) => (
                <Table.Td key={i} ta="right">
                  <Money>{formatMinor(v, cur)}</Money>
                </Table.Td>
              ))}
              <Table.Td ta="right">
                <Money>{formatMinor(r.median, cur)}</Money>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Text fz="xs" c="dimmed" mt={6}>
        {t("proposal.why.note", { model: p.model })}
      </Text>
    </Table.ScrollContainer>
  );

  return (
    <AiBox
      label={t("proposal.label")}
      basis={t("proposal.basis", { months, date: made })}
      title={t("proposal.title", { count: p.basis.rows.length })}
      why={short ? undefined : why}
      feedback={p.feedback}
      onFeedback={(v) => feedback.mutate(v)}
      actions={
        <>
          {short && (
            <Button size="xs" variant="light" component={Link} to="/budget">
              {t("proposal.seeInBudget")}
            </Button>
          )}
          <Button
            size="xs"
            variant="subtle"
            color="gray"
            loading={act.isPending && act.variables === "later"}
            onClick={() => act.mutate("later")}
          >
            {t("proposal.later")}
          </Button>
          <Button
            size="xs"
            variant="subtle"
            color="gray"
            loading={act.isPending && act.variables === "ignore"}
            onClick={() => act.mutate("ignore")}
          >
            {t("proposal.ignore")}
          </Button>
        </>
      }
    >
      {paragraphs(p.body).map((para, i) => (
        <Text key={i} fz="inherit" lh="inherit" mb={4}>
          {splitAmounts(para).map((part, j) => (j % 2 ? <Money key={j}>{part}</Money> : part))}
        </Text>
      ))}
      {!short && rows}
    </AiBox>
  );
}

/** Mounts the proposal waiting on a wallet, if any. */
export function BudgetProposalBox(props: {
  walletId: number;
  short?: boolean;
  onApply?: (p: AIProposal, r: AIProposalRow) => void;
}) {
  const p = useBudgetProposal(props.walletId);
  return p ? <BudgetProposal {...props} proposal={p} /> : null;
}
