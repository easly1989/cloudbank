import { MantineProvider } from "@mantine/core";
import { fireEvent, render, screen } from "@testing-library/react";
import { Link, MemoryRouter, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import i18n from "../i18n";
import { PageErrorBoundary } from "./PageErrorBoundary";

function Broken(): never {
  throw new TypeError("Cannot read properties of null (reading 'map')");
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
      </nav>
      <PageErrorBoundary resetKey={location.key}>
        <Outlet />
      </PageErrorBoundary>
    </>
  );
}

function renderAt(path: string) {
  return render(
    <MantineProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<Shell />}>
            <Route path="/" element={<p>Dashboard</p>} />
            <Route path="/fine" element={<p>Everything is fine</p>} />
            <Route path="/broken" element={<Broken />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </MantineProvider>,
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

  it("renders the page untouched when nothing throws", () => {
    renderAt("/fine");

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("Everything is fine")).toBeInTheDocument();
  });
});
