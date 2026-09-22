// Customizable sidebar navigation layout (issue #339 follow-up). The static
// grouping introduced earlier is now user-editable: groups and items can be
// reordered, hidden, renamed, split with separators, and new groups created —
// all persisted per user (synced preferences) so the layout is identical on
// desktop and mobile. The dashboard ("/") stays pinned above the groups, and
// the Settings group is locked: it can't be moved, renamed,
// hidden, or have other items dropped into it. People management lives inside
// the Settings page rather than as its own destination.

import { NAV_GROUPS, NAV_ITEMS } from "./navItems";

export const NAV_LAYOUT_VERSION = 1;

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

// The default group each destination belongs to, so back-filled items (a nav
// destination added after the user saved a layout) land in a sensible place.
const DEFAULT_GROUP_OF = new Map<string, string>();
for (const g of NAV_GROUPS)
  for (const to of g.items) DEFAULT_GROUP_OF.set(to, groupIdFromLabelKey(g.labelKey));

/** The Settings group, always the same: locked, Settings alone, no separators. */
function settingsGroup(): NavGroupLayout {
  return {
    id: SETTINGS_GROUP_ID,
    labelKey: SETTINGS_GROUP_LABELKEY,
    locked: true,
    entries: [{ kind: "item", to: "/settings" }],
  };
}

/** The default layout: the built-in groups in their natural order and contents. */
export function defaultNavLayout(): NavLayout {
  return {
    version: NAV_LAYOUT_VERSION,
    groups: NAV_GROUPS.map((g) =>
      g.labelKey === SETTINGS_GROUP_LABELKEY
        ? settingsGroup()
        : {
            id: groupIdFromLabelKey(g.labelKey),
            labelKey: g.labelKey,
            entries: g.items.map((to) => ({ kind: "item", to }) as NavEntry),
          },
    ),
  };
}

function isNavLayout(v: unknown): v is NavLayout {
  return (
    !!v &&
    typeof v === "object" &&
    (v as NavLayout).version === NAV_LAYOUT_VERSION &&
    Array.isArray((v as NavLayout).groups)
  );
}

/**
 * Normalize any saved layout into a valid one: drop unknown/duplicate/pinned/
 * locked destinations from user groups, enforce the locked Settings group as the
 * last group, and append any destination missing from the layout (e.g. a nav item
 * added in a later release) to its default group. An invalid/absent layout yields
 * the default.
 */
export function migrateNavLayout(saved: unknown): NavLayout {
  if (!isNavLayout(saved)) return defaultNavLayout();

  const seenItems = new Set<string>();
  const groups: NavGroupLayout[] = [];
  for (const g of saved.groups) {
    // The Settings group is rebuilt from scratch below, never trusted from storage.
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
    groups.push({
      id: g.id || `grp-${Math.random().toString(36).slice(2, 8)}`,
      labelKey: g.label ? undefined : g.labelKey,
      label: g.label,
      hidden: g.hidden === true,
      entries,
    });
  }

  // Back-fill destinations missing from every group (new nav items, or ones the
  // user's saved layout predates), into their default group when present.
  for (const item of NAV_ITEMS) {
    const to = item.to;
    if (to === PINNED_HOME || LOCKED_ITEMS.has(to) || seenItems.has(to)) continue;
    const defId = DEFAULT_GROUP_OF.get(to);
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

  // The Settings group is always present, locked, and last.
  groups.push(settingsGroup());
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
