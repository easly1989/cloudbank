import { beforeEach, describe, expect, it } from "vitest";

import { AFTER_LOGIN } from "./afterLogin";
import { ApiError } from "./api/core";
import { failsThePage, LIVE_REFETCH_MS, makeQueryClient, sessionLost } from "./queryClient";

describe("failsThePage", () => {
  const query = (data: unknown) => ({ state: { data } }) as Parameters<typeof failsThePage>[1];

  it("fails the page on a server or network error before any data", () => {
    expect(failsThePage(new ApiError(500, "boom"), query(undefined))).toBe(true);
    expect(failsThePage(new ApiError(503, "unavailable"), query(undefined))).toBe(true);
    expect(failsThePage(new TypeError("Failed to fetch"), query(undefined))).toBe(true);
  });

  it("keeps what is on screen when a refetch fails", () => {
    expect(failsThePage(new ApiError(500, "boom"), query([]))).toBe(false);
  });

  it("leaves 4xx answers to their components, and a 401 to sign-in", () => {
    // 502: a service CloudBank calls (a mailbox, a bank) did not answer.
    for (const s of [400, 401, 403, 404, 409, 429, 502]) {
      expect(failsThePage(new ApiError(s, "x"), query(undefined))).toBe(false);
    }
  });
});

describe("sessionLost", () => {
  const signedIn = () => {
    const qc = makeQueryClient();
    qc.setQueryData(["me"], { id: 1, username: "ada" });
    qc.setQueryData(["setup-status"], { needsSetup: false });
    qc.setQueryData(["register", 7], [{ id: 1 }]);
    return qc;
  };
  beforeEach(() => {
    sessionStorage.clear();
    history.replaceState(null, "", "/reports?tab=trend");
  });

  it("signs out, drops the wallet's data and keeps the way back", () => {
    const qc = signedIn();
    sessionLost(qc, new ApiError(401, "authentication required", "unauthorized"));
    expect(qc.getQueryData(["me"])).toBeNull();
    expect(qc.getQueryData(["register", 7])).toBeUndefined();
    expect(qc.getQueryData(["setup-status"])).toEqual({ needsSetup: false });
    expect(JSON.parse(sessionStorage.getItem(AFTER_LOGIN)!).path).toBe("/reports?tab=trend");
  });

  it("leaves a wrong password, a proxy's 401 and other errors alone", () => {
    for (const err of [
      new ApiError(401, "invalid username or password", "invalid_credentials"),
      new ApiError(401, "Unauthorized"),
      new ApiError(500, "boom", "internal"),
      new Error("network"),
    ]) {
      const qc = signedIn();
      sessionLost(qc, err);
      expect(qc.getQueryData(["me"])).toEqual({ id: 1, username: "ada" });
      expect(qc.getQueryData(["register", 7])).toEqual([{ id: 1 }]);
    }
    expect(sessionStorage.getItem(AFTER_LOGIN)).toBeNull();
  });

  it("keeps a way back already asked for", () => {
    sessionStorage.setItem(AFTER_LOGIN, JSON.stringify({ path: "/settings/account", at: 1 }));
    sessionLost(signedIn(), new ApiError(401, "authentication required", "unauthorized"));
    expect(JSON.parse(sessionStorage.getItem(AFTER_LOGIN)!).path).toBe("/settings/account");
  });

  it("does nothing when nobody is signed in", () => {
    const qc = makeQueryClient();
    sessionLost(qc, new ApiError(401, "authentication required", "unauthorized"));
    expect(sessionStorage.getItem(AFTER_LOGIN)).toBeNull();
  });

  it("does not retry a 401", () => {
    const retry = makeQueryClient().getDefaultOptions().queries?.retry as (
      n: number,
      e: unknown,
    ) => boolean;
    expect(retry(0, new ApiError(401, "x", "unauthorized"))).toBe(false);
    expect(retry(0, new ApiError(500, "x"))).toBe(true);
    expect(retry(1, new ApiError(500, "x"))).toBe(false);
  });
});

describe("makeQueryClient", () => {
  const defaults = makeQueryClient().getDefaultOptions().queries;
  const intervalFor = (...key: unknown[]) => {
    const fn = defaults?.refetchInterval as unknown as (q: { queryKey: unknown[] }) => unknown;
    return fn({ queryKey: key });
  };

  it("refetches when the tab regains focus or the network returns", () => {
    expect(defaults?.refetchOnWindowFocus).toBe(true);
    expect(defaults?.refetchOnReconnect).toBe(true);
  });

  it("polls the data the server changes behind the page's back", () => {
    for (const root of ["register", "accounts", "dashboard", "review", "bills"]) {
      expect(intervalFor(root, 1)).toBe(LIVE_REFETCH_MS);
    }
  });

  it("leaves reference data alone", () => {
    for (const root of ["categories", "payees", "me", "version"]) {
      expect(intervalFor(root, 1)).toBe(false);
    }
  });
});
