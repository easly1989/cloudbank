// Customizable sidebar navigation layout (issue #339 follow-up). The static
// grouping introduced earlier is now user-editable: groups and items can be
// reordered, hidden, renamed, split with separators, and new groups created —
// all persisted per user (synced preferences) so the layout is identical on
// desktop and mobile. The dashboard ("/") stays pinned above the groups, and
// the Settings group is locked: it can't be moved, renamed,
// hidden, or have other items dropped into it. People management lives inside
// the Settings page rather than as its own destination.

import { NAV_GROUPS, NAV_ITEMS } from "./navItems";

// 2 (#537): Categories, Payees and Currencies joined the menu.
export const NAV_LAYOUT_VERSION = 2;

// The layout version each destination arrived in, when later than the first.
// A layout saved before a destination existed did not leave it out; it never
// saw it. A customised menu is the reader's, so such a page arrives hidden and
// the sidebar offers it (unseenNavPages) rather than putting it there unasked.
// Destinations older than a layout, but missing from it, still arrive visible,
// as they always have: hiding them now would take away a page the reader sees.
const ADDED_IN = new Map<string, number>([
  ["/categories", 2],
  ["/payees", 2],
  ["/currencies", 2],
]);

// The Settings group and its members are locked (never movable/hideable).
export const SETTINGS_GROUP_LABELKEY = "nav.group.settings";
export const SETTINGS_GROUP_ID = "settings";
export const LOCKED_ITEMS = new Set(["/settings"]);
// The dashboard is pinned above the groups, so it is never part of the layout.
export const PINNED_HOME = "/";

/** One entry inside a group: a nav destination, or a visual separator line. */
export type NavEntry =
  { kind: "item"; to: string; hidden?: boolean } | { kind: "separator"; id: string };

export interface NavGroupLayout {
  /** Stable id. Built-in groups use the short name ("money"); custom ones a generated id. */
  id: string;
  /** Built-in label (i18n key). A custom/renamed group carries `label` instead. */
  labelKey?: string;
  /** User-provided label; when set it overrides `labelKey`. */
  label?: string;
  /** The whole group is hidden from the sidebar (kept in the layout so it can be re-shown). */
  hidden?: boolean;
  /** The Settings group: not movable/editable and can't receive other items. */
  locked?: boolean;
  entries: NavEntry[];
}

export interface NavLayout {
  version: typeof NAV_LAYOUT_VERSION;
  groups: NavGroupLayout[];
}

const KNOWN_DESTINATIONS = new Set(NAV_ITEMS.map((i) => i.to));

const groupIdFromLabelKey = (labelKey: string) => labelKey.split(".").pop() ?? labelKey;
const DEFAULT_GROUP_LABELKEY = new Map(
  NAV_GROUPS.map((g) => [groupIdFromLabelKey(g.labelKey), g.labelKey]),
);

// Built-in groups a later release took away. A saved layout still holds them,
// emptied of their pages; unless the reader put something of their own in
// one, it goes too, rather than staying as a heading over nothing. "banking"
// held Bank sync and Review until #504/#505.
const RETIRED_GROUPS = new Set(["nav.group.banking"]);

// The default group each destination belongs to, so back-filled items (a nav
// destination added after the user saved a layout) land in a sensible place.
const DEFAULT_GROUP_OF = new Map<string, string>();
for (const g of NAV_GROUPS)
  for (const to of g.items) DEFAULT_GROUP_OF.set(to, groupIdFromLabelKey(g.labelKey));

// Settings is deliberately absent from the navigation. It reaches the reader
// through the gear at the foot of the sidebar, and a second copy in the list of
// pages would be the same destination twice — ambiguous to a screen reader, and
// one more row between the reader and the pages they came for. LOCKED_ITEMS
// keeps it from being back-filled into another group when an old saved layout
// is migrated.

/** The default layout: the built-in groups in their natural order and contents. */
export function defaultNavLayout(): NavLayout {
  return {
    version: NAV_LAYOUT_VERSION,
    groups: NAV_GROUPS.filter((g) => g.labelKey !== SETTINGS_GROUP_LABELKEY).map((g) => ({
      id: groupIdFromLabelKey(g.labelKey),
      labelKey: g.labelKey,
      entries: g.items.map((to) => ({ kind: "item", to }) as NavEntry),
    })),
  };
}

/** A layout as saved, by this release or an earlier one. */
interface SavedLayout {
  version: number;
  groups: NavGroupLayout[];
}

function savedLayout(v: unknown): SavedLayout | null {
  if (!v || typeof v !== "object") return null;
  const { version, groups } = v as SavedLayout;
  if (!Number.isInteger(version) || version < 1 || version > NAV_LAYOUT_VERSION) return null;
  return Array.isArray(groups) ? { version, groups } : null;
}

const isUnseen = (to: string, saved: SavedLayout) => (ADDED_IN.get(to) ?? 1) > saved.version;

/**
 * The pages a saved layout has never seen: added to the menu in a release after
 * it was saved, and missing from it. They are in the migrated layout, hidden;
 * the sidebar says they exist until the reader shows them or keeps them hidden,
 * which saves the layout and so empties this list. A reader who never
 * customised the menu has no saved layout, gets the default, and is not asked.
 */
export function unseenNavPages(raw: unknown): string[] {
  const saved = savedLayout(raw);
  if (!saved) return [];
  const present = new Set(
    saved.groups.flatMap((g) =>
      (Array.isArray(g.entries) ? g.entries : []).flatMap((e) => (e.kind === "item" ? [e.to] : [])),
    ),
  );
  return NAV_ITEMS.map((i) => i.to).filter((to) => isUnseen(to, saved) && !present.has(to));
}

/**
 * Normalize any saved layout into a valid one: drop unknown/duplicate/pinned/
 * locked destinations from user groups, enforce the locked Settings group as the
 * last group, and append any destination missing from the layout (e.g. a nav item
 * added in a later release) to its default group. An invalid/absent layout yields
 * the default.
 */
export function migrateNavLayout(raw: unknown): NavLayout {
  const saved = savedLayout(raw);
  if (!saved) return defaultNavLayout();

  const seenItems = new Set<string>();
  const groups: NavGroupLayout[] = [];
  for (const g of saved.groups) {
    // A saved layout from before the gear moved to the sidebar foot still holds
    // the old Settings group; drop it rather than migrating it forward.
    if (g.locked || g.id === SETTINGS_GROUP_ID) continue;
    const entries: NavEntry[] = [];
    for (const e of Array.isArray(g.entries) ? g.entries : []) {
      if (e.kind === "separator") {
        entries.push({
          kind: "separator",
          id: e.id || `sep-${Math.random().toString(36).slice(2, 8)}`,
        });
      } else if (
        e.kind === "item" &&
        KNOWN_DESTINATIONS.has(e.to) &&
        e.to !== PINNED_HOME &&
        !LOCKED_ITEMS.has(e.to) &&
        !seenItems.has(e.to)
      ) {
        seenItems.add(e.to);
        entries.push({ kind: "item", to: e.to, hidden: e.hidden === true });
      }
    }
    if (
      g.labelKey &&
      RETIRED_GROUPS.has(g.labelKey) &&
      !g.label &&
      !entries.some((e) => e.kind === "item")
    )
      continue;
    groups.push({
      id: g.id || `grp-${Math.random().toString(36).slice(2, 8)}`,
      labelKey: g.label ? undefined : g.labelKey,
      label: g.label,
      hidden: g.hidden === true,
      entries,
    });
  }

  // Back-fill destinations missing from every group (new nav items, or ones the
  // user's saved layout predates), into their default group when present. A page
  // the layout has never seen arrives hidden (see ADDED_IN), in its default
  // group — made for it at the end when the layout has none, where it shows
  // nothing until the reader shows the page.
  for (const item of NAV_ITEMS) {
    const to = item.to;
    if (to === PINNED_HOME || LOCKED_ITEMS.has(to) || seenItems.has(to)) continue;
    const defId = DEFAULT_GROUP_OF.get(to);
    if (isUnseen(to, saved) && defId) {
      let home = groups.find((g) => g.id === defId);
      if (!home) {
        home = {
          id: defId,
          labelKey: DEFAULT_GROUP_LABELKEY.get(defId),
          label: undefined,
          hidden: false,
          entries: [],
        };
        groups.push(home);
      }
      home.entries.push({ kind: "item", to, hidden: true });
      seenItems.add(to);
      continue;
    }
    const target = groups.find((g) => g.id === defId) ?? groups[0];
    if (target) target.entries.push({ kind: "item", to });
    else
      groups.push({
        id: defId ?? "other",
        labelKey: "nav.group.other",
        entries: [{ kind: "item", to }],
      });
    seenItems.add(to);
  }

  return { version: NAV_LAYOUT_VERSION, groups };
}

/** A fresh unique id for a user-created group. */
export function newGroupId(existing: NavGroupLayout[]): string {
  const ids = new Set(existing.map((g) => g.id));
  let n = 1;
  while (ids.has(`custom-${n}`)) n++;
  return `custom-${n}`;
}

/** A fresh unique id for a separator entry. */
export function newSeparatorId(): string {
  return `sep-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}
