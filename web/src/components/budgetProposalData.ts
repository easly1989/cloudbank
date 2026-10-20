import { useQuery } from "@tanstack/react-query";

import {
  AI_SETTINGS_KEY,
  aiProposalsKey,
  getAISettings,
  listAIProposals,
  type AIProposal,
  type AIProposalRow,
  type AISettings,
} from "../api/ai";

// Where the AI's budget proposal (#698) comes from, for the box and the pages
// that open its rows.

/** Whether the AI makes budget proposals on a wallet. */
export const aiBudgetsOn = (s: AISettings | undefined, walletId: number) =>
  !!s &&
  s.enabled &&
  s.hasKey &&
  s.baseUrl !== "" &&
  s.model !== "" &&
  s.features.budgets &&
  !s.walletsOff.includes(walletId);

/** The proposal waiting on a wallet, if the AI makes them there. */
export function useBudgetProposal(walletId: number) {
  const settings = useQuery({ queryKey: AI_SETTINGS_KEY, queryFn: getAISettings });
  const on = aiBudgetsOn(settings.data, walletId);
  const q = useQuery({
    queryKey: aiProposalsKey(walletId),
    queryFn: () => listAIProposals(walletId),
    enabled: on && walletId > 0,
  });
  return on ? q.data?.proposals.find((p) => p.basis.rows.length > 0) : undefined;
}

/** Where Apply goes from a page that has no budget form: Budget, with it open. */
export const applyPath = (p: AIProposal, r: AIProposalRow) =>
  `/budget?apply=${p.id}:${r.categoryId}`;
