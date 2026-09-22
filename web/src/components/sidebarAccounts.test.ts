import { describe, expect, it } from "vitest";

import type { Account } from "../api/client";
import { pickSidebarAccounts, SIDEBAR_ACCOUNTS_MAX } from "./sidebarAccounts";

const account = (id: number, name: string) => ({ id, name }) as Account;

const all = [account(1, "Checking"), account(2, "Savings"), account(3, "Card"), account(4, "Cash")];

describe("pickSidebarAccounts", () => {
  it("is off until the user turns it on", () => {
    expect(pickSidebarAccounts(all, undefined)).toEqual([]);
    expect(pickSidebarAccounts(all, [])).toEqual([]);
  });

  it("keeps the order the user chose, not the account order", () => {
    expect(pickSidebarAccounts(all, [3, 1]).map((a) => a.name)).toEqual(["Card", "Checking"]);
  });

  it("drops an account that no longer exists rather than showing a blank row", () => {
    expect(pickSidebarAccounts(all, [99, 2]).map((a) => a.name)).toEqual(["Savings"]);
  });

  it("caps the strip even when a stale preference holds more", () => {
    const picked = pickSidebarAccounts(all, [1, 2, 3, 4]);
    expect(picked).toHaveLength(SIDEBAR_ACCOUNTS_MAX);
    expect(picked.map((a) => a.name)).toEqual(["Checking", "Savings", "Card"]);
  });
});
