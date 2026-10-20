import { Stack, Table, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import type { AIProposal, AIProposalRow } from "../api/ai";
import { formatMinor } from "../money";
import { useMonthName } from "../pages/goals/goalWords";
import { FromTo, Money, ProposalBox, ProposalLine } from "./ProposalBox";
import { applyPath, round } from "./proposalData";

// The AI's goal proposal (#699): goals behind their date, dates worth moving,
// and dates to set. Apply never saves: a late goal opens Put in, where the
// month's share is filled in; the others open the goal with the new date.

export function GoalProposal({
  walletId,
  proposal: p,
  onApply,
}: {
  walletId: number;
  proposal: AIProposal;
  /** Opens the goal's sheet; without it Apply goes to Goals. */
  onApply?: (p: AIProposal, r: AIProposalRow) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const monthName = useMonthName();
  const month = (d: string) => monthName(Number(d.slice(0, 4)) * 12 + Number(d.slice(5, 7)) - 1);
  const cur = p.basis.currency;
  const money = (v: number) => round(v, cur);

  const reason = (r: AIProposalRow) => {
    const pace = r.pace ?? 0;
    switch (r.reason) {
      case "late":
        return pace > 0 && r.newDate
          ? t("proposal.goal.reason.late", {
              month: month(r.date ?? ""),
              pace: money(pace),
              eta: month(r.newDate),
            })
          : t("proposal.goal.reason.lateNone", { month: month(r.date ?? "") });
      case "move":
        return t("proposal.goal.reason.move", {
          month: month(r.date ?? ""),
          need: money(r.proposed),
          kept: money(p.basis.kept ?? 0),
        });
      default:
        return t("proposal.goal.reason.eta", { pace: money(pace), eta: month(r.newDate ?? "") });
    }
  };

  const figure = (r: AIProposalRow) => {
    if (r.reason === "late")
      return (
        <FromTo
          from={(r.pace ?? 0) > 0 ? money(r.pace ?? 0) : null}
          to={t("proposal.goal.perMonth", { amount: money(r.proposed) })}
        />
      );
    return (
      <>
        {r.reason === "move" && (
          <>
            <Text span c="dimmed" fz="inherit" td="line-through">
              {month(r.date ?? "")}
            </Text>{" "}
            <Text span c="dimmed" fz="inherit" aria-hidden>
              →
            </Text>{" "}
          </>
        )}
        {month(r.newDate ?? "")}
      </>
    );
  };

  const why = (
    <Table.ScrollContainer minWidth={560}>
      <Table verticalSpacing={4} fz="xs">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t("proposal.goal.why.goal")}</Table.Th>
            <Table.Th ta="right">{t("proposal.goal.why.left")}</Table.Th>
            <Table.Th ta="right">{t("proposal.goal.why.by")}</Table.Th>
            <Table.Th ta="right">{t("proposal.goal.why.need")}</Table.Th>
            <Table.Th ta="right">{t("proposal.goal.why.pace")}</Table.Th>
            <Table.Th ta="right">{t("proposal.goal.why.eta")}</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {p.basis.rows.map((r) => (
            <Table.Tr key={r.goalId}>
              <Table.Td>{r.name}</Table.Td>
              <Table.Td ta="right">
                <Money>{formatMinor(r.left ?? 0, cur)}</Money>
              </Table.Td>
              <Table.Td ta="right">{r.date ? month(r.date) : "—"}</Table.Td>
              <Table.Td ta="right">
                {r.reason === "eta" ? "—" : <Money>{formatMinor(r.proposed, cur)}</Money>}
              </Table.Td>
              <Table.Td ta="right">
                <Money>{formatMinor(r.pace ?? 0, cur)}</Money>
              </Table.Td>
              <Table.Td ta="right">{r.newDate ? month(r.newDate) : "—"}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Text fz="xs" c="dimmed" mt={6}>
        {t("proposal.goal.why.note", {
          kept: formatMinor(p.basis.kept ?? 0, cur),
          model: p.model,
        })}
      </Text>
    </Table.ScrollContainer>
  );

  return (
    <ProposalBox
      walletId={walletId}
      proposal={p}
      title={t("proposal.goal.title", { count: p.basis.rows.length })}
      basis={(date) => t("proposal.goal.basis", { date })}
      why={why}
    >
      <Stack gap={0} mt={10}>
        {p.basis.rows.map((r) => {
          const late = r.reason === "late";
          const to = month(r.newDate ?? "");
          return (
            <ProposalLine
              key={r.goalId}
              name={r.name}
              reason={reason(r)}
              figure={figure(r)}
              apply={t(late ? "goals.putIn" : `proposal.goal.${r.reason}`)}
              applyLabel={
                late
                  ? t("proposal.goal.lateLabel", { name: r.name, amount: money(r.proposed) })
                  : t(`proposal.goal.${r.reason}Label`, { name: r.name, month: to })
              }
              onApply={() => (onApply ? onApply(p, r) : navigate(applyPath(p, r)))}
            />
          );
        })}
      </Stack>
    </ProposalBox>
  );
}
