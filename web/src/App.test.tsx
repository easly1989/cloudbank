import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { App } from "./App";
import "./i18n";

// Avoid real network in the health query.
vi.stubGlobal(
  "fetch",
  vi.fn(async () => new Response(JSON.stringify({ status: "ok" }), { status: 200 })),
);

function renderApp(route = "/") {
  const client = new QueryClient();
  return render(
    <MantineProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[route]}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

describe("App", () => {
  it("renders the dashboard at the index route", () => {
    renderApp("/");
    expect(screen.getByText("Welcome to CloudBank")).toBeInTheDocument();
  });

  it("renders the login page", () => {
    renderApp("/login");
    expect(screen.getByText("Sign in to CloudBank")).toBeInTheDocument();
  });
});
