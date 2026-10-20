import { useQuery } from "@tanstack/react-query";

import {
  AI_SETTINGS_KEY,
  aiUnusualKey,
  getAISettings,
  getAIUnusual,
  type AIUnusual,
} from "../api/ai";
import { aiFeatureOn } from "./proposalData";

// Where the AI's unusual transactions (#700) come from, for the box, Review
// and the overview's list of what wants attention.

/** The flags waiting on a wallet, if the AI looks for them there. */
export function useUnusual(walletId: number): AIUnusual | undefined {
  const settings = useQuery({ queryKey: AI_SETTINGS_KEY, queryFn: getAISettings });
  const on = aiFeatureOn(settings.data, walletId, "unusual");
  const q = useQuery({
    queryKey: aiUnusualKey(walletId),
    queryFn: () => getAIUnusual(walletId),
    enabled: on && walletId > 0,
  });
  return on ? q.data : undefined;
}

/** Where a double's pair sits on Review, for "See the pair" to scroll to. */
export const pairAnchor = (a: number, b: number) => `pair-${Math.min(a, b)}-${Math.max(a, b)}`;
