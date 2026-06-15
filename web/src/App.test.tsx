import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { AuthProvider } from "./auth/AuthProvider";
import "./i18n";

type Routes = Record<string, { status?: number; body: unknown }>;

function mockFetch(routes: Routes) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      const path = url.replace(/^https?:\/\/[^/]+/, "");
      const match = routes[path];
      if (!match) return new Response("null", { status: 404 });
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

afterEach(() => vi.unstubAllGlobals());

describe("App routing", () => {
  it("shows the setup wizard on first run", async () => {
    mockFetch({ "/api/v1/setup/status": { body: { needsSetup: true } } });
    renderApp("/");
    expect(await screen.findByText("Create admin account")).toBeInTheDocument();
  });

  it("shows the login page when not authenticated", async () => {
    mockFetch({
      "/api/v1/setup/status": { body: { needsSetup: false } },
      "/api/v1/auth/me": { status: 401, body: { error: { code: "unauthorized", message: "no" } } },
    });
    renderApp("/");
    expect(await screen.findByText("Sign in to CloudBank")).toBeInTheDocument();
  });

  it("shows the dashboard when authenticated", async () => {
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
    mockFetch({
      "/api/v1/setup/status": { body: { needsSetup: false } },
      "/api/v1/auth/me": { body: admin },
      "/healthz": { body: { status: "ok" } },
    });
    renderApp("/");
    await waitFor(() => expect(screen.getByText("Backend status")).toBeInTheDocument());
  });
});
