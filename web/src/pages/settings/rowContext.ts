import { useAuth, useAuthConfig } from "../../auth/AuthProvider";
import { SIDEBAR_ACCOUNTS_MAX } from "../../components/sidebarAccounts";
import { useWallet } from "../../wallet/WalletProvider";
import type { RowContext } from "./sections";

/** Who is reading, for the rows and sections only some people have. */
export function useRowContext(): RowContext {
  const { user } = useAuth();
  const config = useAuthConfig().data;
  const { currentWallet } = useWallet();
  return {
    isAdmin: !!user?.isAdmin,
    demo: __DEMO__,
    ssoOnly: config?.passwordLogin === false,
    passkeys: !!config?.passkeys,
    isOwner: currentWallet?.role === "owner",
  };
}

/** Values the rows' descriptions may name. */
export const HINT_VALUES = { max: SIDEBAR_ACCOUNTS_MAX };
