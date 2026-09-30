import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { listAccounts, type Account } from "../../api/client";
import { formatMinor, type MoneyFormat } from "../../money";

/** An account's money format, or plain two-decimal numbers while it is unknown. */
export const accountFormat = (a?: Account): MoneyFormat => ({
  fracDigits: a?.currencyFracDigits ?? 2,
  decimalChar: a?.currencyDecimalChar ?? ".",
  groupChar: a?.currencyGroupChar ?? ",",
  symbol: a?.currencySymbol ?? "",
  symbolPrefix: a?.currencySymbolPrefix ?? false,
});

/** The wallet's accounts by id, and a formatter for an amount in one of them. */
export function useAccountMoney(walletId: number) {
  const accounts = useQuery({
    queryKey: ["accounts", walletId],
    queryFn: () => listAccounts(walletId),
    enabled: walletId > 0,
  });
  return useMemo(() => {
    const byId = new Map((accounts.data ?? []).map((a) => [a.id, a]));
    const first = accounts.data?.[0];
    return {
      byId,
      /** The format of the first account, for totals across accounts. */
      base: accountFormat(first),
      format: (amount: number, accountId?: number) =>
        formatMinor(amount, accountFormat(accountId != null ? byId.get(accountId) : first)),
    };
  }, [accounts.data]);
}
