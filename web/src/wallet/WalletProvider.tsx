import { useQuery } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { listWallets, type Wallet } from "../api/client";

interface WalletContextValue {
  wallets: Wallet[];
  currentWallet: Wallet | null;
  setCurrentWalletId: (id: number) => void;
  isLoading: boolean;
}

const WalletContext = createContext<WalletContextValue | undefined>(undefined);
const STORAGE_KEY = "cb.currentWalletId";

export function WalletProvider({ children }: { children: ReactNode }) {
  const query = useQuery({ queryKey: ["wallets"], queryFn: listWallets });
  const wallets = query.data ?? [];

  const [currentId, setCurrentId] = useState<number | null>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? Number(stored) : null;
  });

  // Resolve the current wallet, falling back to the first one.
  const currentWallet = wallets.find((w) => w.id === currentId) ?? wallets[0] ?? null;

  // Adopt the resolved wallet — first load, or the stored id naming a wallet
  // that is gone — during render, so nothing downstream sees the stale id.
  if (currentWallet && currentWallet.id !== currentId) setCurrentId(currentWallet.id);

  // Remembering it is a write to the outside, and stays in an effect.
  useEffect(() => {
    if (currentId != null) localStorage.setItem(STORAGE_KEY, String(currentId));
  }, [currentId]);

  const setCurrentWalletId = (id: number) => setCurrentId(id);

  const value: WalletContextValue = {
    wallets,
    currentWallet,
    setCurrentWalletId,
    isLoading: query.isLoading,
  };

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within a WalletProvider");
  return ctx;
}
