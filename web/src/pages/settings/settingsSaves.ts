import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  AI_SETTINGS_KEY,
  updateAISettings,
  type AISettings,
  type AISettingsInput,
} from "../../api/ai";
import { updateWallet, type Wallet, type WalletInput } from "../../api/client";

// The two settings whose server takes the whole object at once (#800): a
// wallet and the AI. A change is sent with the rest of what is stored, so two
// changes in flight together would each lack the other's, and the later one
// would undo the earlier. Here the saves of each run one at a time, and each
// is built when its turn comes, from what the save before it left.

const WALLETS = ["wallets"];

/** Saves one change to a wallet's settings. */
export function useWalletSave(walletId: number) {
  const qc = useQueryClient();
  return useMutation({
    scope: { id: `wallet-settings-${walletId}` },
    mutationFn: async (patch: Partial<WalletInput>) => {
      await qc.cancelQueries({ queryKey: WALLETS });
      const w = qc.getQueryData<Wallet[]>(WALLETS)?.find((x) => x.id === walletId);
      if (!w) throw new Error("wallet not loaded");
      return updateWallet(walletId, {
        title: w.title,
        ownerName: w.ownerName,
        schedulePostMonths: w.schedulePostMonths,
        billsCategoryId: w.billsCategoryId ?? null,
        ...patch,
      });
    },
    // The answer is the stored wallet: what the next save starts from.
    onSuccess: (saved) =>
      qc.setQueryData<Wallet[]>(WALLETS, (list) =>
        list?.map((x) => (x.id === walletId ? { ...x, ...saved } : x)),
      ),
  });
}

/** What the server keeps, as the body of a save; the key stays out. */
const asInput = (s: AISettings): AISettingsInput => ({
  enabled: s.enabled,
  baseUrl: s.baseUrl,
  model: s.model,
  features: s.features,
  walletsOff: s.walletsOff,
  monthlyLimit: s.monthlyLimit,
  motion: s.motion,
  schedule: s.schedule,
});

/**
 * A change to the AI settings, made from the settings as they are when it
 * runs: a switch in a list (a feature, a wallet) changes its own entry only.
 */
export type AIChange = (cur: AISettings) => Partial<AISettingsInput>;

/** Saves one change to the AI settings; shown at once, settled by the server. */
export function useAiSave() {
  const qc = useQueryClient();
  return useMutation({
    scope: { id: "ai-settings" },
    onMutate: async (change: AIChange) => {
      await qc.cancelQueries({ queryKey: AI_SETTINGS_KEY });
      const cur = qc.getQueryData<AISettings>(AI_SETTINGS_KEY);
      if (cur) {
        const visible = { ...change(cur) };
        delete visible.apiKey;
        qc.setQueryData(AI_SETTINGS_KEY, { ...cur, ...visible });
      }
    },
    mutationFn: async (change: AIChange) => {
      const cur = qc.getQueryData<AISettings>(AI_SETTINGS_KEY);
      if (!cur) throw new Error("AI settings not loaded");
      // The key is sent only when one was typed: an empty one would clear it.
      return updateAISettings({ ...asInput(cur), ...change(cur) });
    },
    // What the server keeps decides, a refused change included.
    onSettled: () => qc.invalidateQueries({ queryKey: AI_SETTINGS_KEY }),
  });
}
