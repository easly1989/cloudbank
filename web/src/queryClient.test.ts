import { describe, expect, it } from "vitest";

import { LIVE_REFETCH_MS, makeQueryClient } from "./queryClient";

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
