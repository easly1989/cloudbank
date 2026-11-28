import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";

import { AFTER_LOGIN } from "./afterLogin";
import { ApiError } from "./api/core";

// Data the server changes without this tab's help: a transaction posted from
// another device, by a bank sync, a bank mail or a schedule, moves all of these.
// Each stays fresh by polling while its page is open (#712); the rest of the
// cache only refetches on mount, focus and reconnect.
const LIVE_ROOTS = new Set([
  "register",
  "accounts",
  "dashboard",
  "balance",
  "review",
  "bills",
  "schedules",
  "schedule-calendar",
  "budgetReport",
  "trend",
  "statistics",
  "cashflow",
  "uncleared",
  "mailMessages",
]);

// Polling pauses by itself while the tab is hidden (refetchIntervalInBackground
// is off), and coming back to the tab refetches at once, so this only bounds
// how stale a tab the reader is watching can get.
export const LIVE_REFETCH_MS = 30_000;

// What the app reads before anyone is signed in: kept when a session ends, so
// the sign-in page does not load them again behind a spinner.
const SIGNED_OUT_ROOTS = new Set(["me", "setup-status", "authConfig"]);

/**
 * CloudBank answered that this browser has no session any more: it expired, or
 * it was signed out elsewhere (#804). Every page used to go on showing what its
 * failed queries left, an empty register and "0,00 €" spent, with nothing to
 * say why. Go back to sign-in instead, and to this page after it
 * (afterLogin.ts). The cached data goes too, since the next person to sign in
 * here may be someone else.
 *
 * A wrong password is a 401 too, with another code; a 401 with no code comes
 * from a sign-in proxy and reloads through it (core.ts).
 */
export function sessionLost(qc: QueryClient, err: unknown) {
  if (!(err instanceof ApiError) || err.status !== 401 || err.code !== "unauthorized") return;
  // Already signed out, or never signed in: the sign-in page is showing.
  if (qc.getQueryData(["me"]) == null) return;
  sessionStorage.setItem(
    AFTER_LOGIN,
    JSON.stringify({ path: location.pathname + location.search, at: Date.now() }),
  );
  qc.removeQueries({ predicate: (q) => !SIGNED_OUT_ROOTS.has(String(q.queryKey[0])) });
  qc.setQueryData(["me"], null);
}

export const makeQueryClient = () => {
  const qc: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError: (err) => sessionLost(qc, err) }),
    mutationCache: new MutationCache({ onError: (err) => sessionLost(qc, err) }),
    defaultOptions: {
      queries: {
        // No session is not a hiccup: asking again only delays the sign-in.
        retry: (failures, err) =>
          failures < 1 && !(err instanceof ApiError && err.status === 401),
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        refetchInterval: (query) =>
          LIVE_ROOTS.has(String(query.queryKey[0])) ? LIVE_REFETCH_MS : false,
      },
    },
  });
  return qc;
};
