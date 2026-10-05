import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getMe, updateMe, type User } from "./auth";
import { ApiError } from "./core";
import { followOtherTabs, saveMe, savePreferences } from "./preferences";

vi.mock("./auth", () => ({ updateMe: vi.fn(), getMe: vi.fn() }));
const mockedUpdateMe = vi.mocked(updateMe);
const mockedGetMe = vi.mocked(getMe);

const user = (preferences: User["preferences"], preferencesRevision?: number): User =>
  ({
    id: 1,
    username: "admin",
    locale: "en",
    theme: "auto",
    preferences,
    preferencesRevision,
  }) as unknown as User;

// A server that stores what it is sent, answering when the test says so. Like
// the real one, it refuses a write that started from an old revision (#576).
function server(initial: User["preferences"], initialRevision = 0) {
  let stored = initial;
  let revision = initialRevision;
  const pending: (() => void)[] = [];
  mockedUpdateMe.mockImplementation(
    (body) =>
      new Promise<User>((resolve, reject) => {
        pending.push(() => {
          if (body.preferences && "fail" in body.preferences) {
            reject(new Error("refused"));
            return;
          }
          if (body.preferencesRevision !== undefined && body.preferencesRevision !== revision) {
            reject(new ApiError(409, "saved elsewhere", "stale_preferences"));
            return;
          }
          if (body.preferences) stored = JSON.parse(JSON.stringify(body.preferences));
          revision++;
          resolve(user(stored, revision));
        });
      }),
  );
  mockedGetMe.mockImplementation(async () => user(stored, revision));
  return {
    stored: () => stored,
    revision: () => revision,
    /** A save made on another device: stored, and the revision moves on. */
    elsewhere: (prefs: User["preferences"]) => {
      stored = prefs;
      revision++;
    },
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

  it("sends the revision it started from", async () => {
    const srv = server({ tutorialSeen: true }, 4);
    qc.setQueryData(["me"], user({ tutorialSeen: true }, 4));
    const done = savePreferences(qc, { sidebarCollapsed: true });
    await settle();
    expect(mockedUpdateMe).toHaveBeenCalledWith({
      preferences: { tutorialSeen: true, sidebarCollapsed: true },
      preferencesRevision: 4,
    });
    await srv.answer();
    await done;
    expect(qc.getQueryData<User>(["me"])?.preferencesRevision).toBe(5);
  });

  it("makes the change again over a save made on another device", async () => {
    const srv = server({ tutorialSeen: true }, 4);
    qc.setQueryData(["me"], user({ tutorialSeen: true }, 4));
    // The other device hid the footer after this tab read the settings.
    srv.elsewhere({ tutorialSeen: true, showFooter: false });
    const done = savePreferences(qc, { sidebarCollapsed: true });
    await settle();
    await srv.answer(); // refused: started from revision 4, the server is at 5
    await settle();
    await srv.answer(); // made again from what is stored
    const saved = await done;
    expect(srv.stored()).toEqual({ tutorialSeen: true, showFooter: false, sidebarCollapsed: true });
    expect(saved.preferencesRevision).toBe(6);
    expect(qc.getQueryData<User>(["me"])?.preferences).toEqual(srv.stored());
  });

  it("gives up after a few refusals in a row", async () => {
    const srv = server({ tutorialSeen: true }, 1);
    qc.setQueryData(["me"], user({ tutorialSeen: true }, 0));
    // Each re-read finds a revision that has moved on again by the time it is sent.
    mockedGetMe.mockImplementation(async () => user({ tutorialSeen: true }, -1));
    const done = savePreferences(qc, { sidebarCollapsed: true });
    for (let i = 0; i < 4; i++) {
      await settle();
      await srv.answer();
    }
    await expect(done).rejects.toMatchObject({ status: 409, code: "stale_preferences" });
    expect(mockedUpdateMe).toHaveBeenCalledTimes(4);
  });
});

describe("followOtherTabs", () => {
  // A stand-in for the browser's channel: every instance of a name hears what
  // the others post.
  class FakeChannel {
    static all: FakeChannel[] = [];
    onmessage: ((e: MessageEvent) => void) | null = null;
    constructor(public name: string) {
      FakeChannel.all.push(this);
    }
    postMessage(data: unknown) {
      for (const c of FakeChannel.all)
        if (c !== this && c.name === this.name) c.onmessage?.({ data } as MessageEvent);
    }
    close() {
      FakeChannel.all = FakeChannel.all.filter((c) => c !== this);
    }
  }

  it("takes a newer copy of the same user, and nothing else", () => {
    vi.stubGlobal("BroadcastChannel", FakeChannel);
    const qc = new QueryClient();
    qc.setQueryData(["me"], user({ a: 1 } as never, 3));
    const stop = followOtherTabs(qc);
    const otherTab = new FakeChannel("cloudbank-me");

    otherTab.postMessage(user({ a: 2 } as never, 2)); // older
    otherTab.postMessage({ ...user({ a: 3 } as never, 9), id: 2 }); // someone else
    expect(qc.getQueryData<User>(["me"])?.preferences).toEqual({ a: 1 });

    otherTab.postMessage(user({ a: 4 } as never, 4));
    expect(qc.getQueryData<User>(["me"])?.preferences).toEqual({ a: 4 });

    stop();
    otherTab.postMessage(user({ a: 5 } as never, 5));
    expect(qc.getQueryData<User>(["me"])?.preferences).toEqual({ a: 4 });
    otherTab.close();
    vi.unstubAllGlobals();
  });
});
