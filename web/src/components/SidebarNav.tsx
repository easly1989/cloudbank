import { Box, Collapse, Group, NavLink, Stack, Text, Tooltip, UnstyledButton } from "@mantine/core";
import { IconChevronDown, IconChevronRight } from "@tabler/icons-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { NavLink as RouterNavLink } from "react-router-dom";

import { useAuth } from "../auth/AuthProvider";
import { NAV_GROUPS, NAV_ITEMS, type NavItemDef } from "./navItems";

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

// SidebarNav renders the navigation organized into sections (Money, Planning,
// Banking, …), with the dashboard on top. Each section header collapses.
export function SidebarNav({
  railMode,
  onNavigate,
}: {
  railMode: boolean;
  onNavigate?: () => void;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const canSee = (i: NavItemDef) => !i.adminOnly || Boolean(user?.isAdmin);

  const byTo = new Map(NAV_ITEMS.map((i) => [i.to, i]));
  const home = NAV_ITEMS[0]; // "/" — the dashboard, rendered standalone above the groups
  const groups = NAV_GROUPS.map((g) => ({
    labelKey: g.labelKey,
    items: g.items.map((to) => byTo.get(to)).filter((i): i is NavItemDef => i != null && canSee(i)),
  })).filter((g) => g.items.length > 0);

  // Safety net: any visible destination not in home or a group lands in "Other".
  const placed = new Set<string>([home.to, ...NAV_GROUPS.flatMap((g) => g.items)]);
  const leftovers = NAV_ITEMS.filter((i) => canSee(i) && !placed.has(i.to));
  if (leftovers.length > 0) groups.push({ labelKey: "nav.group.other", items: leftovers });

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
          <Stack key={g.labelKey} gap={4} mt={6}>
            {g.items.map((item) => (
              <RailIcon key={item.to} item={item} onNavigate={onNavigate} />
            ))}
          </Stack>
        ))}
      </Stack>
    );
  }

  return (
    <Stack gap={2}>
      <NavItemLink item={home} onNavigate={onNavigate} />
      {groups.map((g) => {
        const isCollapsed = collapsed.has(g.labelKey);
        return (
          <Box key={g.labelKey} mt="xs">
            <UnstyledButton
              onClick={() => toggle(g.labelKey)}
              aria-expanded={!isCollapsed}
              style={{ width: "100%" }}
            >
              <Group gap={4} px="xs" py={4} justify="space-between" wrap="nowrap">
                <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                  {t(g.labelKey)}
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
                {g.items.map((item) => (
                  <NavItemLink key={item.to} item={item} onNavigate={onNavigate} />
                ))}
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
