import { describe, expect, it } from "vitest";

import { defaultNavLayout, migrateNavLayout, SETTINGS_GROUP_ID } from "./navLayout";

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
});
