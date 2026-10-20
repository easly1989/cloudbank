import { Stack, Table, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import type { AIProposal, AIProposalRow } from "../api/ai";
import { useDateFormat } from "../dates";
import { formatMinor } from "../money";
import { FromTo, Money, ProposalBox, ProposalLine } from "./ProposalBox";
import { applyPath, round } from "./proposalData";

// The AI's subscription proposal (#699): the schedules worth a look, each with
// its own Apply. Apply never saves: a raised one opens the schedule with the
// new amount filled in, the others open the schedule, where Delete is.

export function SubscriptionProposal({
  walletId,
  proposal: p,
  onApply,
}: {
  walletId: number;
  proposal: AIProposal;
  /** Opens the schedule; without it Apply goes to Schedules. */
  onApply?: (p: AIProposal, r: AIProposalRow) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const date = useDateFormat();
  const cur = p.basis.currency;

  const reason = (r: AIProposalRow) => {
    const paid = r.paid ?? [];
    switch (r.reason) {
      case "raised":
        return paid[0] === paid[1]
          ? t("proposal.sub.reason.raised", { amount: formatMinor(r.proposed, cur) })
          : t("proposal.sub.reason.raisedTwo", {
              prev: formatMinor(paid[0] ?? 0, cur),
              amount: formatMinor(r.proposed, cur),
            });
      case "unused":
        return t("proposal.sub.reason.unused", { date: date(r.last ?? "") });
      default:
        return t(`proposal.sub.reason.${r.reason}`, { other: r.other ?? "" });
    }
  };

  const why = (
    <Table.ScrollContainer minWidth={520}>
      <Table verticalSpacing={4} fz="xs">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t("proposal.sub.why.schedule")}</Table.Th>
            <Table.Th ta="right">{t("proposal.sub.why.saved")}</Table.Th>
            <Table.Th ta="right">{t("proposal.sub.why.paid")}</Table.Th>
            <Table.Th ta="right">{t("proposal.sub.why.last")}</Table.Th>
            <Table.Th ta="right">{t("proposal.sub.why.yearly")}</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {p.basis.rows.map((r) => (
            <Table.Tr key={r.scheduleId}>
              <Table.Td>{r.name}</Table.Td>
              <Table.Td ta="right">
                <Money>{formatMinor(r.amount ?? 0, cur)}</Money>
              </Table.Td>
              <Table.Td ta="right">
                {(r.paid ?? []).length > 0 ? (
                  <Money>{(r.paid ?? []).map((v) => formatMinor(v, cur)).join(", ")}</Money>
                ) : (
                  "—"
                )}
              </Table.Td>
              <Table.Td ta="right">{r.last ? date(r.last) : "—"}</Table.Td>
              <Table.Td ta="right">
                <Money>{formatMinor(r.yearly ?? 0, cur)}</Money>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Text fz="xs" c="dimmed" mt={6}>
        {t("proposal.sub.why.note", { model: p.model })}
      </Text>
    </Table.ScrollContainer>
  );

  return (
    <ProposalBox
      walletId={walletId}
      proposal={p}
      title={t("proposal.sub.title", { count: p.basis.rows.length })}
      basis={(date) => t("proposal.sub.basis", { date })}
      why={why}
    >
      <Stack gap={0} mt={10}>
        {p.basis.rows.map((r) => {
          const raised = r.reason === "raised";
          return (
            <ProposalLine
              key={r.scheduleId}
              name={r.name}
              reason={reason(r)}
              figure={
                raised ? (
                  <FromTo
                    from={formatMinor(r.amount ?? 0, cur)}
                    to={formatMinor(r.proposed, cur)}
                  />
                ) : (
                  <Money>{t("proposal.sub.perYear", { amount: round(r.yearly ?? 0, cur) })}</Money>
                )
              }
              apply={raised ? t("proposal.sub.update") : t("proposal.sub.open")}
              applyLabel={
                raised
                  ? t("proposal.sub.updateLabel", {
                      name: r.name,
                      amount: formatMinor(r.proposed, cur),
                    })
                  : t("proposal.sub.openLabel", { name: r.name })
              }
              onApply={() => (onApply ? onApply(p, r) : navigate(applyPath(p, r)))}
            />
          );
        })}
      </Stack>
    </ProposalBox>
  );
}
