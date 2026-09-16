import {
  Box,
  Collapse,
  Divider,
  Group,
  NavLink,
  Stack,
  Text,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { IconChevronDown, IconChevronRight } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { NavLink as RouterNavLink } from "react-router-dom";

import { useAuth } from "../auth/AuthProvider";
import { NAV_ITEMS, type NavItemDef } from "./navItems";
import { migrateNavLayout, PINNED_HOME, type NavGroupLayout } from "./navLayout";

// Which nav sections the user has collapsed. This is a per-device UI convenience,
// so it lives in localStorage rather than synced preferences.
const COLLAPSED_KEY = "cb.nav.collapsedGroups";

function loadCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function saveCollapsed(s: Set<string>) {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...s]));
  } catch {
    // storage unavailable (private window / blocked) — collapse is non-essential.
  }
}

// SidebarNav renders the navigation from the user's customizable layout: the
// dashboard pinned on top, then each visible group (with its visible items and
// separators). The same component drives desktop, the collapsed icon rail, and
// the mobile drawer, so all three stay in sync with the saved layout.
export function SidebarNav({
  railMode,
  onNavigate,
}: {
  railMode: boolean;
  onNavigate?: () => void;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isAdmin = Boolean(user?.isAdmin);

  const byTo = useMemo(() => new Map(NAV_ITEMS.map((i) => [i.to, i])), []);
  const home = byTo.get(PINNED_HOME) ?? NAV_ITEMS[0];
  const layout = useMemo(
    () => migrateNavLayout(user?.preferences?.navLayout),
    [user?.preferences?.navLayout],
  );

  const canSee = (i: NavItemDef) => !i.adminOnly || isAdmin;
  const groupLabel = (g: NavGroupLayout) => g.label ?? (g.labelKey ? t(g.labelKey) : "");

  // Resolve each visible group to its renderable items + separators. Groups with
  // no visible item are dropped so an empty header never shows.
  const groups = layout.groups
    .filter((g) => !g.hidden)
    .map((g) => {
      const entries = g.entries
        .map((e, idx) => {
          if (e.kind === "separator") return { key: e.id, sep: true as const };
          const item = byTo.get(e.to);
          if (e.hidden || !item || !canSee(item)) return null;
          return { key: `${g.id}:${e.to}:${idx}`, item };
        })
        .filter(
          (e): e is { key: string; sep: true } | { key: string; item: NavItemDef } => e != null,
        );
      return { id: g.id, label: groupLabel(g), entries };
    })
    .filter((g) => g.entries.some((e) => "item" in e));

  const [collapsed, setCollapsed] = useState<Set<string>>(loadCollapsed);
  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      saveCollapsed(next);
      return next;
    });

  // Collapsed rail: icons only (tooltips), a small gap between sections.
  if (railMode) {
    return (
      <Stack gap={4}>
        <RailIcon item={home} onNavigate={onNavigate} />
        {groups.map((g) => (
          <Stack key={g.id} gap={4} mt={6}>
            {g.entries.map((e) =>
              "sep" in e ? (
                <Divider key={e.key} my={2} />
              ) : (
                <RailIcon key={e.key} item={e.item} onNavigate={onNavigate} />
              ),
            )}
          </Stack>
        ))}
      </Stack>
    );
  }

  return (
    <Stack gap={2}>
      <NavItemLink item={home} onNavigate={onNavigate} />
      {groups.map((g) => {
        const isCollapsed = collapsed.has(g.id);
        return (
          <Box key={g.id} mt="xs">
            <UnstyledButton
              onClick={() => toggle(g.id)}
              aria-expanded={!isCollapsed}
              style={{ width: "100%" }}
            >
              <Group gap={4} px="xs" py={4} justify="space-between" wrap="nowrap">
                <Text size="xs" c="dimmed" tt="uppercase" fw={600} truncate>
                  {g.label}
                </Text>
                {isCollapsed ? (
                  <IconChevronRight size={14} opacity={0.5} />
                ) : (
                  <IconChevronDown size={14} opacity={0.5} />
                )}
              </Group>
            </UnstyledButton>
            <Collapse expanded={!isCollapsed}>
              <Stack gap={2}>
                {g.entries.map((e) =>
                  "sep" in e ? (
                    <Divider key={e.key} my={4} />
                  ) : (
                    <NavItemLink key={e.key} item={e.item} onNavigate={onNavigate} />
                  ),
                )}
              </Stack>
            </Collapse>
          </Box>
        );
      })}
    </Stack>
  );
}

function NavItemLink({ item, onNavigate }: { item: NavItemDef; onNavigate?: () => void }) {
  const { t } = useTranslation();
  return (
    <NavLink
      component={RouterNavLink}
      to={item.to}
      end={item.end}
      onClick={onNavigate}
      label={t(item.labelKey)}
      leftSection={<item.icon size={18} />}
      data-tour={item.to === "/settings" ? "settings" : undefined}
    />
  );
}

function RailIcon({ item, onNavigate }: { item: NavItemDef; onNavigate?: () => void }) {
  const { t } = useTranslation();
  return (
    <Tooltip label={t(item.labelKey)} position="right" withinPortal>
      <NavLink
        component={RouterNavLink}
        to={item.to}
        end={item.end}
        onClick={onNavigate}
        leftSection={<item.icon size={18} />}
        styles={{ body: { display: "none" } }}
      />
    </Tooltip>
  );
}
