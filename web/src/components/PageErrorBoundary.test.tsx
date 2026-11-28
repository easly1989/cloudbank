import { MantineProvider } from "@mantine/core";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { Link, MemoryRouter, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ApiError } from "../api/core";
import i18n from "../i18n";
import { makeQueryClient } from "../queryClient";
import { PageErrorBoundary } from "./PageErrorBoundary";

function Broken(): never {
  throw new TypeError("Cannot read properties of null (reading 'map')");
}

// A page whose data fails to load until `serverUp` is set (#804).
let serverUp = false;
function DataPage() {
  const { data } = useQuery({
    queryKey: ["report"],
    queryFn: () =>
      serverUp
        ? Promise.resolve("Spent 120 €")
        : Promise.reject(new ApiError(500, "boom", "internal")),
    retry: false,
  });
  return <p>{data ?? "Spent 0 €"}</p>;
}

// The shape of AppLayout: navigation that must survive, and the page behind a
// boundary that resets on every navigation.
function Shell() {
  const location = useLocation();
  return (
    <>
      <nav>
        <Link to="/fine">Fine page</Link>
        <Link to="/broken">Broken page</Link>
        <Link to="/data">Data page</Link>
      </nav>
      <PageErrorBoundary resetKey={location.key}>
        <Outlet />
      </PageErrorBoundary>
    </>
  );
}

function renderAt(path: string) {
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <MantineProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route element={<Shell />}>
              <Route path="/" element={<p>Dashboard</p>} />
              <Route path="/fine" element={<p>Everything is fine</p>} />
              <Route path="/broken" element={<Broken />} />
              <Route path="/data" element={<DataPage />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </MantineProvider>
    </QueryClientProvider>,
  );
}

describe("PageErrorBoundary", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("en");
  });
  // React and the boundary both log the caught error; keep the output readable.
  const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
  afterEach(() => quiet.mockClear());

  it("shows the message in place of a page that throws, and keeps the shell", () => {
    renderAt("/broken");

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("This page stopped working")).toBeInTheDocument();
    expect(
      screen.getByText("TypeError: Cannot read properties of null (reading 'map')"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Fine page" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload the page" })).toBeInTheDocument();
  });

  it("clears the message when the reader goes to another page", () => {
    renderAt("/broken");
    fireEvent.click(screen.getByRole("link", { name: "Fine page" }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("Everything is fine")).toBeInTheDocument();
  });

  it("takes the reader to the dashboard", () => {
    renderAt("/broken");
    fireEvent.click(screen.getByRole("link", { name: "Go to the dashboard" }));

    expect(screen.getByText("Dashboard")).toBeInTheDocument();
  });

  it("reports on a blank issue, sending none of the reader's data", () => {
    renderAt("/broken");
    const report = screen.getByRole("link", { name: /Report the problem/ });

    expect(report).toHaveAttribute("href", "https://github.com/easly1989/cloudbank/issues/new");
    expect(report).toHaveAttribute("target", "_blank");
  });

  it("fills the screen when there is no shell left, and reloads the app to leave", () => {
    render(
      <MantineProvider>
        <PageErrorBoundary fullPage>
          <Broken />
        </PageErrorBoundary>
      </MantineProvider>,
    );

    expect(screen.getByText("This page stopped working")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to the dashboard" })).toHaveAttribute("href", "/");
  });

  it("says a page could not load its data, never zero, and loads it again later", async () => {
    serverUp = false;
    renderAt("/data");

    expect(await screen.findByText("This page could not load its data")).toBeInTheDocument();
    expect(screen.queryByText("Spent 0 €")).not.toBeInTheDocument();

    // Leaving clears the failed query, so coming back asks the server again.
    serverUp = true;
    fireEvent.click(screen.getByRole("link", { name: "Fine page" }));
    fireEvent.click(screen.getByRole("link", { name: "Data page" }));
    expect(await screen.findByText("Spent 120 €")).toBeInTheDocument();
  });

  it("renders the page untouched when nothing throws", () => {
    renderAt("/fine");

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("Everything is fine")).toBeInTheDocument();
  });
});
