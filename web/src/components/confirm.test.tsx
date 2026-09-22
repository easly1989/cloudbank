import { MantineProvider } from "@mantine/core";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ConfirmProvider } from "./confirm";
import { useConfirm } from "./confirmContext";

// A button that asks, and records what came back, so the test can assert on the
// promise rather than on internal state.
function Harness({ onResult }: { onResult: (ok: boolean) => void }) {
  const confirm = useConfirm();
  return (
    <button
      type="button"
      onClick={async () => {
        const ok = await confirm({
          title: "Delete 2 transactions?",
          body: "They are gone for good.",
          confirmLabel: "Delete",
          cancelLabel: "Keep them",
          danger: true,
        });
        onResult(ok);
      }}
    >
      ask
    </button>
  );
}

function setup() {
  const results: boolean[] = [];
  render(
    <MantineProvider>
      <ConfirmProvider>
        <Harness onResult={(ok) => results.push(ok)} />
      </ConfirmProvider>
    </MantineProvider>,
  );
  return { results };
}

describe("useConfirm", () => {
  it("shows nothing until something asks", () => {
    setup();
    expect(screen.queryByText("Delete 2 transactions?")).not.toBeInTheDocument();
  });

  it("names the consequence and labels the buttons with verbs", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "ask" }));

    expect(await screen.findByText("Delete 2 transactions?")).toBeInTheDocument();
    expect(screen.getByText("They are gone for good.")).toBeInTheDocument();
    // Never "OK" and "Cancel" when the action has a name.
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keep them" })).toBeInTheDocument();
  });

  it("resolves true when the action is confirmed", async () => {
    const { results } = setup();
    fireEvent.click(screen.getByRole("button", { name: "ask" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() => expect(results).toEqual([true]));
  });

  it("resolves false when the way out is taken", async () => {
    const { results } = setup();
    fireEvent.click(screen.getByRole("button", { name: "ask" }));
    fireEvent.click(await screen.findByRole("button", { name: "Keep them" }));
    await waitFor(() => expect(results).toEqual([false]));
  });

  // The one that matters: a dialog treating dismissal as consent is how people
  // delete things they never meant to.
  it("treats Escape as a no, not as consent", async () => {
    const { results } = setup();
    fireEvent.click(screen.getByRole("button", { name: "ask" }));
    await screen.findByText("Delete 2 transactions?");
    fireEvent.keyDown(document.body, { key: "Escape" });
    await waitFor(() => expect(results).toEqual([false]));
  });

  it("closes after answering, so the next question starts clean", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "ask" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(screen.queryByText("Delete 2 transactions?")).not.toBeInTheDocument(),
    );
  });
});
