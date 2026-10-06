import { MantineProvider } from "@mantine/core";
import { act, fireEvent, render, screen } from "@testing-library/react";

import type { AppUpdate } from "../appUpdate";
import i18n from "../i18n";
import { UpdateNotice } from "./UpdateNotice";

function fakeUpdate() {
  const listeners = new Set<() => void>();
  let visible = false;
  const update: AppUpdate = {
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    visible: () => visible,
    update: vi.fn(),
    later: vi.fn(),
  };
  const set = (v: boolean) =>
    act(() => {
      visible = v;
      listeners.forEach((l) => l());
    });
  return { update, set };
}

const wrap = (update: AppUpdate | null) =>
  render(
    <MantineProvider>
      <UpdateNotice update={update} />
    </MantineProvider>,
  );

describe("UpdateNotice", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("en");
  });

  it("stays out of the way until a new build is ready", () => {
    const { update, set } = fakeUpdate();
    wrap(update);
    expect(screen.queryByRole("status")).toBeNull();
    set(true);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("passes the choice on", () => {
    const { update, set } = fakeUpdate();
    wrap(update);
    set(true);
    fireEvent.click(screen.getByRole("button", { name: "Update" }));
    expect(update.update).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Later" }));
    expect(update.later).toHaveBeenCalled();
  });

  it("renders nothing without a service worker", () => {
    wrap(null);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
