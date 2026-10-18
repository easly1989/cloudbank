import { QueryClient } from "@tanstack/react-query";

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

export const makeQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        refetchInterval: (query) =>
          LIVE_ROOTS.has(String(query.queryKey[0])) ? LIVE_REFETCH_MS : false,
      },
    },
  });
