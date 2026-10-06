import type { TFunction } from "i18next";

import type { DashboardAccount } from "../api/client";

/**
 * The accounts a wallet's totals add up: every account that is open and not
 * set to stay out of the totals. The same rule as the server's (#579).
 */
export function countedAccounts(accounts: readonly DashboardAccount[]) {
  return accounts.filter((a) => !a.closed && !a.noSummary);
}

/** "4 accounts", or "4 of 6 accounts" when some are left out of the totals. */
export function accountsLabel(t: TFunction, accounts: readonly DashboardAccount[]) {
  const count = countedAccounts(accounts).length;
  return count === accounts.length
    ? t("totals.accounts", { count })
    : t("totals.accountsOf", { count, total: accounts.length });
}
