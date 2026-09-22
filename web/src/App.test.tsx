import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { AuthProvider } from "./auth/AuthProvider";
import "./i18n";

type Routes = Record<string, { status?: number; body: unknown }>;

// Paths the app asked for that no test route covers. A request that falls
// through used to 404 in silence — react-query swallows it into an error state,
// and a test asserting on a static heading passes anyway. Collecting the misses
// and failing on them keeps a test from claiming a page works when none of its
// data ever arrived.
let unmatched: string[] = [];

function mockFetch(routes: Routes) {
  unmatched = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      // Match on the path alone: several endpoints carry a query string (the
      // dashboard always does), and keying on the whole URL matched none of them.
      const path = url.replace(/^https?:\/\/[^/]+/, "").split("?")[0];
      const match = routes[path];
      if (!match) {
        unmatched.push(path);
        return new Response(JSON.stringify({ error: { code: "not_found", message: path } }), {
          status: 404,
        });
      }
      return new Response(JSON.stringify(match.body), { status: match.status ?? 200 });
    }),
  );
}

function renderApp(route = "/") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MantineProvider>
      <QueryClientProvider client={client}>
        <AuthProvider>
          <MemoryRouter initialEntries={[route]}>
            <App />
          </MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

// App loads every page with React.lazy. The dashboard drags in ECharts,
// gridstack and TanStack Table, and transforming that graph takes seconds on a
// cold run — which the assertions below were unknowingly waiting on, on top of
// waiting for data. Resolving it once up front leaves the assertions timing what
// they are meant to time. The hook, not the test, absorbs the one-off cost.
beforeAll(async () => {
  await import("./pages/DashboardPage");
}, 120_000);

afterEach(() => {
  vi.unstubAllGlobals();
  expect(unmatched, "the app requested endpoints the test does not mock").toEqual([]);
});

describe("App routing", () => {
  it("shows the setup wizard on first run", async () => {
    mockFetch({
      "/api/v1/setup/status": { body: { needsSetup: true } },
      "/api/v1/auth/me": { status: 401, body: { error: { code: "unauthorized", message: "no" } } },
      "/api/v1/auth/config": { body: { oidc: { enabled: false, name: "" } } },
    });
    renderApp("/");
    expect(await screen.findByText("Create admin account")).toBeInTheDocument();
  });

  it("shows the login page when not authenticated", async () => {
    mockFetch({
      "/api/v1/setup/status": { body: { needsSetup: false } },
      "/api/v1/auth/me": { status: 401, body: { error: { code: "unauthorized", message: "no" } } },
      "/api/v1/auth/config": { body: { oidc: { enabled: false, name: "" } } },
    });
    renderApp("/");
    expect(await screen.findByText("Sign in to CloudBank")).toBeInTheDocument();
  });

  const admin = {
    id: 1,
    username: "admin",
    email: "",
    isAdmin: true,
    locale: "en",
    theme: "auto",
    disabled: false,
    createdAt: "2026-01-01T00:00:00Z",
  };

  it("shows the first-wallet wizard when authenticated with no wallets", async () => {
    mockFetch({
      "/api/v1/setup/status": { body: { needsSetup: false } },
      "/api/v1/auth/me": { body: admin },
      "/api/v1/wallets": { body: [] },
      "/api/v1/catalog/currencies": {
        body: [{ code: "EUR", name: "Euro", symbol: "€", fracDigits: 2, symbolPrefix: false }],
      },
    });
    renderApp("/");
    expect(await screen.findByText("Create your first wallet")).toBeInTheDocument();
  });

  it("shows the dashboard when authenticated with a wallet", async () => {
    const wallet = {
      id: 1,
      title: "Home",
      ownerName: "",
      role: "owner",
      createdAt: "2026-01-01T00:00:00Z",
    };
    const eur = { code: "EUR", name: "Euro", symbol: "€", fracDigits: 2, symbolPrefix: false };
    mockFetch({
      "/api/v1/setup/status": { body: { needsSetup: false } },
      "/api/v1/auth/me": { body: admin },
      "/api/v1/wallets": { body: [wallet] },
      "/api/v1/version": { body: { version: "test" } },
      "/api/v1/wallets/1/dashboard": {
        body: {
          // One real account, so the assertion below proves the response was
          // read and rendered, rather than a static heading being present.
          accounts: [
            {
              id: 7,
              name: "Bank of Nowhere",
              type: "bank",
              groupName: "",
              closed: false,
              noSummary: false,
              bank: 1000,
              today: 1000,
              future: 1000,
              currency: eur,
              currencyId: 1,
            },
          ],
          totals: { bank: 1000, today: 1000, future: 1000 },
          baseCurrency: eur,
          topCategories: [],
          incomeExpense: [],
          from: "2026-06-01",
          to: "2026-06-30",
          upcoming: [],
        },
      },
      // The overview also asks what needs attention. Without these the three
      // queries fail and the page settles into an error state that happens to
      // look close enough to pass a loose assertion.
      "/api/v1/wallets/1/transactions/review": { body: { needsCategory: [], duplicates: [] } },
      "/api/v1/wallets/1/bills": {
        body: { from: "", to: "", baseCurrency: eur, bills: [], totalDue: 0, overdue: 0, due: 0 },
      },
      // Widgets on the default dashboard ask for these; empty lists are enough,
      // but leaving them out would put those widgets into an error state.
      "/api/v1/wallets/1/accounts": { body: [] },
      "/api/v1/wallets/1/templates": { body: [] },
      "/api/v1/wallets/1/schedules": { body: [] },
      "/api/v1/wallets/1/budgets/report": {
        body: { rows: [], totalBudget: 0, totalActual: 0, from: "", to: "" },
      },
    });
    renderApp("/");
    // Assert on data from the response, not on chrome that renders regardless.
    expect(await screen.findByText("Bank of Nowhere")).toBeInTheDocument();
  });
});
