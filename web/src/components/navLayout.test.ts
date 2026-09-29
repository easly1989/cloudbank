import { describe, expect, it } from "vitest";

import {
  defaultNavLayout,
  migrateNavLayout,
  SETTINGS_GROUP_ID,
  unseenNavPages,
  type NavLayout,
} from "./navLayout";

const paths = (l: NavLayout, group: string) =>
  (l.groups.find((g) => g.id === group)?.entries ?? []).flatMap((e) =>
    e.kind === "item" ? [e.to] : [],
  );

// The default menu before #537, as a reader who customised it saved it.
const V1_DEFAULT = {
  version: 1,
  groups: [
    {
      id: "money",
      labelKey: "nav.group.money",
      entries: ["/accounts", "/transactions", "/templates", "/tags", "/assignments"].map((to) => ({
        kind: "item",
        to,
      })),
    },
    {
      id: "planning",
      labelKey: "nav.group.planning",
      entries: ["/schedules", "/bills", "/budget", "/goals"].map((to) => ({ kind: "item", to })),
    },
    {
      id: "insights",
      labelKey: "nav.group.insights",
      entries: ["/reports", "/vehicles"].map((to) => ({ kind: "item", to })),
    },
  ],
};

describe("navLayout", () => {
  // Settings reaches the reader through the gear at the foot of the sidebar. A
  // second copy in the list of pages would be the same destination twice.
  it("keeps Settings out of the navigation entirely", () => {
    const d = defaultNavLayout();
    expect(d.groups.some((g) => g.id === SETTINGS_GROUP_ID)).toBe(false);
    expect(
      d.groups.some((g) => g.entries.some((e) => e.kind === "item" && e.to === "/settings")),
    ).toBe(false);
  });

  it("returns the default for an absent/invalid saved layout", () => {
    expect(migrateNavLayout(undefined)).toEqual(defaultNavLayout());
    expect(migrateNavLayout({ foo: 1 })).toEqual(defaultNavLayout());
  });

  it("drops unknown, duplicate, pinned and locked items from user groups", () => {
    const m = migrateNavLayout({
      version: 1,
      groups: [
        {
          id: "money",
          labelKey: "nav.group.money",
          entries: [
            { kind: "item", to: "/accounts" },
            { kind: "item", to: "/accounts" }, // duplicate
            { kind: "item", to: "/bogus" }, // unknown
            { kind: "item", to: "/" }, // pinned dashboard
            { kind: "item", to: "/settings" }, // locked, wrong group
            { kind: "separator", id: "s1" },
          ],
        },
      ],
    });
    const money = m.groups.find((g) => g.id === "money");
    const items = (money?.entries ?? [])
      .filter((e) => e.kind === "item")
      .map((e) => (e as { to: string }).to);
    expect(items.filter((to) => to === "/accounts")).toHaveLength(1);
    expect(items).not.toContain("/bogus");
    expect(items).not.toContain("/");
    expect(items).not.toContain("/settings");
    expect(money?.entries.some((e) => e.kind === "separator")).toBe(true);
  });

  it("back-fills a known destination missing from the saved layout", () => {
    const base = defaultNavLayout();
    const groups = base.groups.map((g) =>
      g.id === "money"
        ? {
            ...g,
            entries: g.entries.filter((e) => !(e.kind === "item" && e.to === "/transactions")),
          }
        : g,
    );
    const m = migrateNavLayout({ version: 1, groups });
    const money = m.groups.find((g) => g.id === "money");
    expect(money?.entries.some((e) => e.kind === "item" && e.to === "/transactions")).toBe(true);
  });

  // A layout saved before the gear moved still carries the old Settings group.
  it("drops the Settings group a saved layout still carries", () => {
    const m = migrateNavLayout({
      version: 1,
      groups: [
        {
          id: "settings",
          labelKey: "nav.group.settings",
          locked: true,
          entries: [{ kind: "item", to: "/settings" }],
        },
        { id: "money", labelKey: "nav.group.money", entries: [{ kind: "item", to: "/accounts" }] },
      ],
    });
    expect(m.groups.some((g) => g.id === SETTINGS_GROUP_ID)).toBe(false);
    expect(
      m.groups.some((g) => g.entries.some((e) => e.kind === "item" && e.to === "/settings")),
    ).toBe(false);
    // /accounts keeps its place rather than being swept up with the removal.
    expect(
      m.groups
        .find((g) => g.id === "money")
        ?.entries.some((e) => e.kind === "item" && e.to === "/accounts"),
    ).toBe(true);
  });

  // Bank sync and Review left the sidebar (#504, #505). A layout saved before
  // loses them, and the group that held them unless the reader put their own
  // page in it.
  it("drops Bank sync, Review and their emptied Banking group", () => {
    const banking = (entries: { kind: "item"; to: string }[]) => ({
      id: "banking",
      labelKey: "nav.group.banking",
      entries,
    });
    const gone = migrateNavLayout({
      version: 1,
      groups: [
        banking([
          { kind: "item", to: "/bank-sync" },
          { kind: "item", to: "/review" },
        ]),
      ],
    });
    expect(gone.groups.some((g) => g.id === "banking")).toBe(false);
    const paths = gone.groups.flatMap((g) =>
      g.entries.flatMap((e) => (e.kind === "item" ? [e.to] : [])),
    );
    expect(paths).not.toContain("/bank-sync");
    expect(paths).not.toContain("/review");

    const kept = migrateNavLayout({
      version: 1,
      groups: [banking([{ kind: "item", to: "/reports" }])],
    });
    expect(kept.groups.find((g) => g.id === "banking")?.entries[0]).toEqual({
      kind: "item",
      to: "/reports",
      hidden: false,
    });
  });

  // #537: the wallet's own lists get a group; Money keeps the two work pages.
  it("gives the wallet's data a group of its own by default", () => {
    const d = defaultNavLayout();
    expect(paths(d, "money")).toEqual(["/accounts", "/transactions"]);
    expect(paths(d, "wallet")).toEqual([
      "/categories",
      "/payees",
      "/tags",
      "/assignments",
      "/templates",
      "/currencies",
    ]);
    expect(d.groups.at(-1)?.id).toBe("wallet");
    expect(unseenNavPages(undefined)).toEqual([]);
  });

  // A customised menu is the reader's: nothing moves, and the pages it has never
  // seen arrive hidden until the reader decides.
  it("keeps a customised menu as it was and brings the new pages hidden", () => {
    const m = migrateNavLayout(V1_DEFAULT);
    expect(paths(m, "money")).toEqual([
      "/accounts",
      "/transactions",
      "/templates",
      "/tags",
      "/assignments",
    ]);
    const wallet = m.groups.find((g) => g.id === "wallet");
    expect(wallet?.labelKey).toBe("nav.group.wallet");
    expect(wallet?.entries).toEqual([
      { kind: "item", to: "/categories", hidden: true },
      { kind: "item", to: "/payees", hidden: true },
      { kind: "item", to: "/currencies", hidden: true },
    ]);
    expect(unseenNavPages(V1_DEFAULT)).toEqual(["/categories", "/payees", "/currencies"]);
  });

  it("asks once: a saved choice leaves nothing unseen and does not change", () => {
    const saved = migrateNavLayout(V1_DEFAULT);
    expect(unseenNavPages(saved)).toEqual([]);
    expect(migrateNavLayout(saved)).toEqual(saved);
  });

  // Hiding a page a reader already sees would take it away from them.
  it("still brings an older page missing from a saved menu in visible", () => {
    const noVehicles = {
      ...V1_DEFAULT,
      groups: V1_DEFAULT.groups.map((g) =>
        g.id === "insights" ? { ...g, entries: [{ kind: "item", to: "/reports" }] } : g,
      ),
    };
    const insights = migrateNavLayout(noVehicles).groups.find((g) => g.id === "insights");
    expect(insights?.entries).toContainEqual({ kind: "item", to: "/vehicles" });
    expect(unseenNavPages(noVehicles)).not.toContain("/vehicles");
  });
});
