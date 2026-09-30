import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { updateMe, type User } from "./auth";
import { saveMe, savePreferences } from "./preferences";

vi.mock("./auth", () => ({ updateMe: vi.fn() }));
const mockedUpdateMe = vi.mocked(updateMe);

const user = (preferences: User["preferences"]): User =>
  ({ id: 1, username: "admin", locale: "en", theme: "auto", preferences }) as unknown as User;

// A server that stores what it is sent, answering when the test says so.
function server(initial: User["preferences"]) {
  let stored = initial;
  const pending: (() => void)[] = [];
  mockedUpdateMe.mockImplementation(
    (body) =>
      new Promise<User>((resolve, reject) => {
        pending.push(() => {
          if (body.preferences && "fail" in body.preferences) {
            reject(new Error("refused"));
            return;
          }
          if (body.preferences) stored = JSON.parse(JSON.stringify(body.preferences));
          resolve(user(stored));
        });
      }),
  );
  return {
    stored: () => stored,
    inFlight: () => pending.length,
    answer: async () => {
      pending.shift()?.();
      await new Promise((r) => setTimeout(r, 0));
    },
  };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("saveMe", () => {
  let qc: QueryClient;
  beforeEach(() => {
    mockedUpdateMe.mockReset();
    qc = new QueryClient();
    qc.setQueryData(["me"], user({ tutorialSeen: true }));
  });

  it("keeps both of two saves made at the same moment", async () => {
    const srv = server({ tutorialSeen: true });
    const a = savePreferences(qc, { sidebarCollapsed: true });
    const b = savePreferences(qc, { dashboardPeriod: "ytd" });
    await settle();
    // One at a time: the second waits for the first to land.
    expect(srv.inFlight()).toBe(1);
    await srv.answer();
    await settle();
    expect(srv.inFlight()).toBe(1);
    await srv.answer();
    await Promise.all([a, b]);
    expect(srv.stored()).toEqual({
      tutorialSeen: true,
      sidebarCollapsed: true,
      dashboardPeriod: "ytd",
    });
    expect(qc.getQueryData<User>(["me"])?.preferences).toEqual(srv.stored());
  });

  it("builds a write from the latest copy, not the one the page rendered with", async () => {
    const srv = server({ tutorialSeen: true });
    // A change made elsewhere since the page rendered.
    qc.setQueryData(["me"], user({ tutorialSeen: true, showFooter: false }));
    const done = savePreferences(qc, { sidebarCollapsed: true });
    await settle();
    await srv.answer();
    await done;
    expect(srv.stored()).toEqual({ tutorialSeen: true, showFooter: false, sidebarCollapsed: true });
  });

  it("removes a key set to undefined", async () => {
    const srv = server({ tutorialSeen: true });
    const done = savePreferences(qc, { tutorialSeen: undefined, toursSeen: [] });
    await settle();
    await srv.answer();
    await done;
    expect(srv.stored()).toEqual({ toursSeen: [] });
  });

  it("rejects a failed write to its caller, and still runs the next", async () => {
    const srv = server({ tutorialSeen: true });
    const bad = savePreferences(qc, { fail: true } as never);
    const good = savePreferences(qc, { sidebarCollapsed: true });
    await settle();
    await srv.answer();
    await expect(bad).rejects.toThrow("refused");
    await settle();
    await srv.answer();
    await good;
    expect(srv.stored()).toEqual({ tutorialSeen: true, sidebarCollapsed: true });
  });

  it("sends account fields alone without touching the preferences", async () => {
    const srv = server({ tutorialSeen: true });
    const done = saveMe(qc, { theme: "dark" });
    await settle();
    expect(mockedUpdateMe).toHaveBeenCalledWith({ theme: "dark" });
    await srv.answer();
    await done;
    expect(srv.stored()).toEqual({ tutorialSeen: true });
  });
});
