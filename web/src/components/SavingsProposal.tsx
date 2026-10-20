import { Button, Stack, Table, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";

import type { AIProposal } from "../api/ai";
import { formatMinor } from "../money";
import { FromTo, Money, ProposalBox, ProposalLine } from "./ProposalBox";
import { applyPath, round, useProposal } from "./proposalData";

// The AI's savings proposal (#699): the categories spent on more lately, each
// with what going back to before would keep a month. Apply never saves: it
// opens the budget form on Budget at the earlier level. The short form, for
// the overview, leaves the rows to AI insights.

const pathOf = (name: string) => name.replace(/:/g, " › ");

export function SavingsProposal({
  walletId,
  proposal: p,
  short,
}: {
  walletId: number;
  proposal: AIProposal;
  /** The overview's form: no rows, a link to AI insights. */
  short?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const cur = p.basis.currency;
  const kept = p.basis.rows.reduce((sum, r) => sum + (r.recent ?? 0) - r.proposed, 0);
  // The title's amount in whole units: "183 €", as the rows' amounts are rounded too.
  const unit = 10 ** cur.fracDigits;
  const whole = Math.round(kept / unit) * unit;
  const monthHead = (m: string) =>
    new Intl.DateTimeFormat(i18n.language, { month: "short", timeZone: "UTC" }).format(
      new Date(`${m}-01T00:00:00Z`),
    );

  const why = (
    <Table.ScrollContainer minWidth={720}>
      <Table verticalSpacing={4} fz="xs">
        <Table.Thead>
          <Table.Tr>
            <Table.Th />
            {p.basis.months.map((m) => (
              <Table.Th key={m} ta="right">
                {monthHead(m)}
              </Table.Th>
            ))}
            <Table.Th ta="right">{t("proposal.save.why.before")}</Table.Th>
            <Table.Th ta="right">{t("proposal.save.why.recent")}</Table.Th>
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
                <Money>{formatMinor(r.before ?? 0, cur)}</Money>
              </Table.Td>
              <Table.Td ta="right">
                <Money>{formatMinor(r.recent ?? 0, cur)}</Money>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Text fz="xs" c="dimmed" mt={6}>
        {t("proposal.save.why.note", { model: p.model })}
      </Text>
    </Table.ScrollContainer>
  );

  return (
    <ProposalBox
      walletId={walletId}
      proposal={p}
      title={t("proposal.save.title", { amount: round(whole, cur) })}
      basis={(date) => t("proposal.save.basis", { date })}
      why={short ? undefined : why}
      link={
        short && (
          <Button size="xs" variant="light" component={Link} to="/insights">
            {t("proposal.save.details")}
          </Button>
        )
      }
    >
      {!short && (
        <Stack gap={0} mt={10}>
          {p.basis.rows.map((r) => {
            const before = r.before ?? 0;
            const recent = r.recent ?? 0;
            return (
              <ProposalLine
                key={r.categoryId}
                name={pathOf(r.name)}
                reason={t("proposal.save.reason", {
                  pct: before > 0 ? Math.trunc(((recent - before) * 100) / before) : 0,
                  recent: formatMinor(recent, cur),
                  before: formatMinor(before, cur),
                })}
                figure={<FromTo from={formatMinor(recent, cur)} to={round(r.proposed, cur)} />}
                apply={t("proposal.save.apply")}
                applyLabel={t("proposal.save.applyLabel", {
                  amount: round(r.proposed, cur),
                  name: pathOf(r.name),
                })}
                onApply={() => navigate(applyPath(p, r))}
              />
            );
          })}
        </Stack>
      )}
    </ProposalBox>
  );
}

/** Mounts the savings proposal waiting on a wallet, if any. */
export function SavingsProposalBox(props: { walletId: number; short?: boolean }) {
  const p = useProposal(props.walletId, "savings");
  return p ? <SavingsProposal {...props} proposal={p} /> : null;
}
