import { describe, expect, it } from "vitest";

import { defaultNavLayout, migrateNavLayout, SETTINGS_GROUP_ID } from "./navLayout";

const lastGroup = (l: ReturnType<typeof migrateNavLayout>) => l.groups[l.groups.length - 1];

describe("navLayout", () => {
  it("default layout ends with the locked Settings group", () => {
    const d = defaultNavLayout();
    const settings = lastGroup(d);
    expect(settings.id).toBe(SETTINGS_GROUP_ID);
    expect(settings.locked).toBe(true);
    // People management moved inside the Settings page, so Settings is alone here.
    expect(settings.entries.map((e) => (e.kind === "item" ? e.to : "sep"))).toEqual(["/settings"]);
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

  it("always rebuilds the canonical locked Settings group, ignoring tampering", () => {
    const m = migrateNavLayout({
      version: 1,
      groups: [
        {
          id: "settings",
          labelKey: "nav.group.settings",
          locked: false,
          label: "Hacked",
          entries: [{ kind: "item", to: "/accounts" }],
        },
        { id: "money", labelKey: "nav.group.money", entries: [{ kind: "item", to: "/accounts" }] },
      ],
    });
    const settings = lastGroup(m);
    expect(settings.id).toBe(SETTINGS_GROUP_ID);
    expect(settings.locked).toBe(true);
    expect(settings.label).toBeUndefined();
    // People management moved inside the Settings page, so Settings is alone here.
    expect(settings.entries.map((e) => (e.kind === "item" ? e.to : "sep"))).toEqual(["/settings"]);
    // /accounts stays in the money group (its copy in the tampered settings group is ignored).
    expect(
      m.groups
        .find((g) => g.id === "money")
        ?.entries.some((e) => e.kind === "item" && e.to === "/accounts"),
    ).toBe(true);
  });
});
