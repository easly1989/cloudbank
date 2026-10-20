import { useQuery } from "@tanstack/react-query";

import {
  AI_SETTINGS_KEY,
  aiProposalsKey,
  getAISettings,
  listAIProposals,
  type AIFeature,
  type AIProposal,
  type AIProposalKind,
  type AIProposalRow,
  type AISettings,
} from "../api/ai";
import { formatMinor } from "../money";

// Where the AI's proposals (#698, #699) come from, for the boxes and the pages
// that open their rows.

const FEATURE: Record<AIProposalKind, AIFeature> = {
  budget: "budgets",
  subscriptions: "subscriptions",
  savings: "savings",
};

/** Whether the AI makes proposals of a kind on a wallet. */
export const aiProposalsOn = (s: AISettings | undefined, walletId: number, kind: AIProposalKind) =>
  !!s &&
  s.enabled &&
  s.hasKey &&
  s.baseUrl !== "" &&
  s.model !== "" &&
  s.features[FEATURE[kind]] &&
  !s.walletsOff.includes(walletId);

/** The proposal of a kind waiting on a wallet, if the AI makes them there. */
export function useProposal(walletId: number, kind: AIProposalKind) {
  const settings = useQuery({ queryKey: AI_SETTINGS_KEY, queryFn: getAISettings });
  const on = aiProposalsOn(settings.data, walletId, kind);
  const q = useQuery({
    queryKey: aiProposalsKey(walletId),
    queryFn: () => listAIProposals(walletId),
    enabled: on && walletId > 0,
  });
  return on ? q.data?.proposals.find((p) => p.kind === kind && p.basis.rows.length > 0) : undefined;
}

/** Where Apply goes from a page that has no form for the row: the page with it open. */
export const applyPath = (p: AIProposal, r: AIProposalRow) =>
  p.kind === "subscriptions"
    ? `/schedules?view=list&apply=${p.id}:${r.scheduleId}`
    : `/budget?apply=${p.id}:${r.categoryId}`;

/** A whole amount without its zeros: "60 €" rather than "60,00 €". */
export function round(v: number, cur: AIProposal["basis"]["currency"]) {
  const s = formatMinor(v, cur);
  const zeros = cur.fracDigits > 0 ? cur.decimalChar + "0".repeat(cur.fracDigits) : "";
  return zeros && v % 10 ** cur.fracDigits === 0 ? s.replace(zeros, "") : s;
}
