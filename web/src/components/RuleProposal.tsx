import { Stack, Table, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import type { AIProposal, AIProposalRow } from "../api/ai";
import { ProposalBox, ProposalLine } from "./ProposalBox";
import { applyPath } from "./proposalData";

// The AI's rule proposal (#705): the payees always filed under one category,
// each with its own Create rule. Apply never saves: it opens a new rule filled
// in, the payee exactly the name and that category.

const pathOf = (path: string) => path.replace(/:/g, " › ");
const leafOf = (path: string) => path.slice(path.lastIndexOf(":") + 1);

export function RuleProposal({
  walletId,
  proposal: p,
  onApply,
}: {
  walletId: number;
  proposal: AIProposal;
  /** Opens the rule; without it Create rule goes to Rules. */
  onApply?: (p: AIProposal, r: AIProposalRow) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const reason = (r: AIProposalRow) => {
    const filed = t("proposal.rule.reason", {
      category: leafOf(r.category ?? ""),
      hits: r.hits,
      total: r.total ?? 0,
    });
    return r.without ? `${filed} · ${t("proposal.rule.without", { count: r.without })}` : filed;
  };

  const why = (
    <Table.ScrollContainer minWidth={520}>
      <Table verticalSpacing={4} fz="xs">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t("proposal.rule.why.payee")}</Table.Th>
            <Table.Th>{t("proposal.rule.why.category")}</Table.Th>
            <Table.Th ta="right">{t("proposal.rule.why.hits")}</Table.Th>
            <Table.Th ta="right">{t("proposal.rule.why.total")}</Table.Th>
            <Table.Th ta="right">{t("proposal.rule.why.without")}</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {p.basis.rows.map((r) => (
            <Table.Tr key={r.payeeId}>
              <Table.Td>{r.name}</Table.Td>
              <Table.Td>{pathOf(r.category ?? "")}</Table.Td>
              <Table.Td ta="right">{r.hits}</Table.Td>
              <Table.Td ta="right">{r.total ?? 0}</Table.Td>
              <Table.Td ta="right">{r.without ?? 0}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Text fz="xs" c="dimmed" mt={6}>
        {t("proposal.rule.why.note", { model: p.model })}
      </Text>
    </Table.ScrollContainer>
  );

  return (
    <ProposalBox
      walletId={walletId}
      proposal={p}
      title={t("proposal.rule.title", { count: p.basis.rows.length })}
      basis={(date) => t("proposal.rule.basis", { date })}
      why={why}
    >
      <Stack gap={0} mt={10}>
        {p.basis.rows.map((r) => (
          <ProposalLine
            key={r.payeeId}
            name={r.name}
            reason={reason(r)}
            figure={
              <>
                <Text span c="dimmed" fz="inherit" aria-hidden>
                  →{" "}
                </Text>
                {leafOf(r.category ?? "")}
              </>
            }
            apply={t("proposal.rule.create")}
            applyLabel={t("proposal.rule.createLabel", {
              name: r.name,
              category: pathOf(r.category ?? ""),
            })}
            onApply={() => (onApply ? onApply(p, r) : navigate(applyPath(p, r)))}
          />
        ))}
      </Stack>
    </ProposalBox>
  );
}
