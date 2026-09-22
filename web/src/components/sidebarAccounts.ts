import type { Account } from "../api/client";

/**
 * How many accounts may appear at the foot of the sidebar.
 *
 * The strip is meant to answer "how much have I got?" at a glance. Past three
 * it stops being a glance and becomes a second, worse copy of the Accounts
 * page — so the cap is part of the design, not a technical limit.
 */
export const SIDEBAR_ACCOUNTS_MAX = 3;

/**
 * The accounts to show in the sidebar, in the order the user picked them.
 *
 * Ids that no longer exist — an account deleted after it was chosen — are
 * dropped silently rather than rendering a blank row, and the result is capped
 * even if a stale preference holds more.
 */
export function pickSidebarAccounts(accounts: Account[], ids: number[] | undefined): Account[] {
  if (!ids?.length) return [];
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const out: Account[] = [];
  for (const id of ids) {
    const account = byId.get(id);
    if (account) out.push(account);
    if (out.length === SIDEBAR_ACCOUNTS_MAX) break;
  }
  return out;
}
