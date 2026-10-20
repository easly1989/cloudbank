import { Button, Group, Stack, Text } from "@mantine/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { actOnAIProposal, aiProposalsKey, setAIProposalFeedback, type AIProposal } from "../api/ai";
import { notifyError } from "../notifyError";
import { sensitive } from "../privacy";
import { paragraphs, splitAmounts } from "../pages/insightsText";
import { AiBox, type Feedback } from "./AiBox";

// What every AI proposal (#698, #699) has round its rows: the model's two or
// three sentences, Later, Ignore and the thumbs.

export function Money({ children, dim }: { children: string; dim?: boolean }) {
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

/** One row: what it is about and why, the amounts, and its own Apply. */
export function ProposalLine({
  name,
  reason,
  figure,
  apply,
  applyLabel,
  onApply,
}: {
  name: string;
  reason: string;
  figure: ReactNode;
  apply: string;
  applyLabel: string;
  onApply: () => void;
}) {
  return (
    <Group
      justify="space-between"
      gap="xs"
      py={8}
      style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}
    >
      <Stack gap={0} style={{ minWidth: 0, flex: "1 1 200px" }}>
        <Text fz={14} fw={600}>
          {name}
        </Text>
        <Text fz="xs" c="dimmed">
          {reason}
        </Text>
      </Stack>
      <Group gap="md" wrap="nowrap">
        <Text fz={14}>{figure}</Text>
        <Button size="xs" variant="light" aria-label={applyLabel} onClick={onApply}>
          {apply}
        </Button>
      </Group>
    </Group>
  );
}

/** "was → now", the old amount struck through; "none" when there was none. */
export function FromTo({ from, to }: { from: string | null; to: string }) {
  const { t } = useTranslation();
  return (
    <>
      {from === null ? (
        <Text span c="dimmed" fz="inherit">
          {t("proposal.none")}
        </Text>
      ) : (
        <s>
          <Money dim>{from}</Money>
        </s>
      )}{" "}
      <Text span c="dimmed" fz="inherit" aria-hidden>
        →
      </Text>{" "}
      <Money>{to}</Money>
    </>
  );
}

export function ProposalBox({
  walletId,
  proposal: p,
  title,
  basis,
  why,
  link,
  children,
}: {
  walletId: number;
  proposal: AIProposal;
  title: string;
  /** What it rests on; {{date}} is filled in with the day it was made. */
  basis: (date: string) => string;
  why?: ReactNode;
  /** The short form's way to the page with the rows. */
  link?: ReactNode;
  /** The rows. */
  children?: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
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

  return (
    <AiBox
      label={t("proposal.label")}
      basis={basis(made)}
      title={title}
      why={why}
      feedback={p.feedback}
      onFeedback={(v) => feedback.mutate(v)}
      actions={
        <>
          {link}
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
      {children}
    </AiBox>
  );
}
