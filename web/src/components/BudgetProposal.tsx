import { Button, Stack, Table, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";

import type { AIProposal, AIProposalRow } from "../api/ai";
import { formatMinor } from "../money";
import { FromTo, Money, ProposalBox, ProposalLine } from "./ProposalBox";
import { applyPath, round, useProposal } from "./proposalData";

// The AI's budget proposal (#698): CloudBank's amounts, a row per category
// with its own Apply, the model's two or three sentences above them. Apply
// never saves: it opens the budget form filled in. The short form, for the
// overview, leaves the rows to Budget.

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
  const navigate = useNavigate();
  const cur = p.basis.currency;
  const months = p.basis.months.length;

  const monthHead = (m: string) =>
    new Intl.DateTimeFormat(i18n.language, { month: "short", timeZone: "UTC" }).format(
      new Date(`${m}-01T00:00:00Z`),
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
    <ProposalBox
      walletId={walletId}
      proposal={p}
      title={t("proposal.title", { count: p.basis.rows.length })}
      basis={(date) => t("proposal.basis", { months, date })}
      why={short ? undefined : why}
      link={
        short && (
          <Button size="xs" variant="light" component={Link} to="/budget">
            {t("proposal.seeInBudget")}
          </Button>
        )
      }
    >
      {!short && (
        <Stack gap={0} mt={10}>
          {p.basis.rows.map((r) => (
            <ProposalLine
              key={r.categoryId}
              name={pathOf(r.name)}
              reason={t(`proposal.reason.${r.reason}`, { hits: r.hits, months })}
              figure={
                <FromTo
                  from={r.budget === 0 ? null : round(r.budget, cur)}
                  to={round(r.proposed, cur)}
                />
              }
              apply={t("proposal.apply")}
              applyLabel={t("proposal.applyLabel", {
                amount: round(r.proposed, cur),
                name: pathOf(r.name),
              })}
              onApply={() => (onApply ? onApply(p, r) : navigate(applyPath(p, r)))}
            />
          ))}
        </Stack>
      )}
    </ProposalBox>
  );
}

/** Mounts the budget proposal waiting on a wallet, if any. */
export function BudgetProposalBox(props: {
  walletId: number;
  short?: boolean;
  onApply?: (p: AIProposal, r: AIProposalRow) => void;
}) {
  const p = useProposal(props.walletId, "budget");
  return p ? <BudgetProposal {...props} proposal={p} /> : null;
}
