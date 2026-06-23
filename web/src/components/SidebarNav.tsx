import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ActionIcon, Box, Button, Group, Menu, NavLink, Stack, Text, Tooltip } from "@mantine/core";
import {
  IconAdjustmentsHorizontal,
  IconCheck,
  IconDots,
  IconGripVertical,
  IconPin,
  IconPinnedOff,
} from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { NavLink as RouterNavLink } from "react-router-dom";

import { updateMe, type User } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { NAV_ITEMS, type NavItemDef } from "./navItems";

// resolveOrdered returns items in the user's saved order, appending any not
// listed (newly added destinations, or the admin item) in their default order.
function resolveOrdered(items: NavItemDef[], order?: string[]): NavItemDef[] {
  const byTo = new Map(items.map((i) => [i.to, i]));
  const out: NavItemDef[] = [];
  const seen = new Set<string>();
  for (const to of order ?? []) {
    const it = byTo.get(to);
    if (it && !seen.has(to)) {
      out.push(it);
      seen.add(to);
    }
  }
  for (const it of items) if (!seen.has(it.to)) out.push(it);
  return out;
}

// SidebarNav renders the navigation. Items are user-organizable: pinned items
// stay in the sidebar (drag to reorder in edit mode), unpinned items collapse
// into a "More" group. Order and pinned set persist in the user's preferences.
export function SidebarNav({ railMode }: { railMode: boolean }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);

  const prefs = user?.preferences;
  const available = NAV_ITEMS.filter((i) => !i.adminOnly || user?.isAdmin);

  const [order, setOrder] = useState<string[]>(() =>
    resolveOrdered(available, prefs?.navOrder).map((i) => i.to),
  );
  const [pinned, setPinned] = useState<string[]>(
    () => prefs?.navPinned ?? available.map((i) => i.to),
  );

  const persist = useMutation({
    mutationFn: (patch: { navOrder?: string[]; navPinned?: string[] }) =>
      updateMe({ preferences: { ...(prefs ?? {}), ...patch } }),
    onSuccess: (u: User) => qc.setQueryData(["me"], u),
  });

  const ordered = resolveOrdered(available, order);
  const pinnedSet = new Set(pinned);
  const pinnedItems = ordered.filter((i) => pinnedSet.has(i.to));
  const unpinnedItems = ordered.filter((i) => !pinnedSet.has(i.to));

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = pinnedItems.map((i) => i.to);
    const oldI = ids.indexOf(String(active.id));
    const newI = ids.indexOf(String(over.id));
    if (oldI < 0 || newI < 0) return;
    const newOrder = [...arrayMove(ids, oldI, newI), ...unpinnedItems.map((i) => i.to)];
    setOrder(newOrder);
    persist.mutate({ navOrder: newOrder });
  };

  const togglePin = (to: string) => {
    const next = pinnedSet.has(to) ? pinned.filter((x) => x !== to) : [...pinned, to];
    setPinned(next);
    persist.mutate({ navPinned: next });
  };

  // Collapsed rail: pinned icons (tooltips) + a "More" menu for the rest.
  if (railMode) {
    return (
      <Stack gap={4}>
        {pinnedItems.map((item) => (
          <Tooltip key={item.to} label={t(item.labelKey)} position="right" withinPortal>
            <NavLink
              component={RouterNavLink}
              to={item.to}
              end={item.end}
              leftSection={<item.icon size={18} />}
              styles={{ body: { display: "none" } }}
            />
          </Tooltip>
        ))}
        {unpinnedItems.length > 0 && (
          <Menu position="right-start" withinPortal>
            <Menu.Target>
              <Tooltip label={t("nav.more")} position="right" withinPortal>
                <ActionIcon variant="subtle" color="gray" mx="auto" aria-label={t("nav.more")}>
                  <IconDots size={18} />
                </ActionIcon>
              </Tooltip>
            </Menu.Target>
            <Menu.Dropdown>
              {unpinnedItems.map((item) => (
                <Menu.Item
                  key={item.to}
                  component={RouterNavLink}
                  to={item.to}
                  leftSection={<item.icon size={16} />}
                >
                  {t(item.labelKey)}
                </Menu.Item>
              ))}
            </Menu.Dropdown>
          </Menu>
        )}
      </Stack>
    );
  }

  // Edit mode: reorder pinned items by drag, pin/unpin from either list.
  if (editing) {
    return (
      <Stack gap={2}>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext
            items={pinnedItems.map((i) => i.to)}
            strategy={verticalListSortingStrategy}
          >
            {pinnedItems.map((item) => (
              <SortableNavRow key={item.to} item={item} onUnpin={() => togglePin(item.to)} />
            ))}
          </SortableContext>
        </DndContext>
        {unpinnedItems.length > 0 && (
          <>
            <Text size="xs" c="dimmed" tt="uppercase" mt="sm" mb={2} px="xs">
              {t("nav.hidden")}
            </Text>
            {unpinnedItems.map((item) => (
              <Group key={item.to} gap="xs" px="xs" py={4} justify="space-between" wrap="nowrap">
                <Group gap="xs" wrap="nowrap" c="dimmed">
                  <item.icon size={18} />
                  <Text size="sm">{t(item.labelKey)}</Text>
                </Group>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  aria-label={t("nav.pin")}
                  onClick={() => togglePin(item.to)}
                >
                  <IconPin size={16} />
                </ActionIcon>
              </Group>
            ))}
          </>
        )}
        <Button
          variant="light"
          size="xs"
          mt="sm"
          leftSection={<IconCheck size={16} />}
          onClick={() => setEditing(false)}
        >
          {t("nav.done")}
        </Button>
      </Stack>
    );
  }

  // Normal expanded sidebar.
  return (
    <Stack gap={4}>
      {pinnedItems.map((item) => (
        <NavLink
          key={item.to}
          component={RouterNavLink}
          to={item.to}
          end={item.end}
          label={t(item.labelKey)}
          leftSection={<item.icon size={18} />}
        />
      ))}
      {unpinnedItems.length > 0 && (
        <NavLink label={t("nav.more")} leftSection={<IconDots size={18} />} childrenOffset={28}>
          {unpinnedItems.map((item) => (
            <NavLink
              key={item.to}
              component={RouterNavLink}
              to={item.to}
              end={item.end}
              label={t(item.labelKey)}
              leftSection={<item.icon size={16} />}
            />
          ))}
        </NavLink>
      )}
      <Button
        variant="subtle"
        color="gray"
        size="xs"
        mt="xs"
        leftSection={<IconAdjustmentsHorizontal size={16} />}
        onClick={() => setEditing(true)}
      >
        {t("nav.customize")}
      </Button>
    </Stack>
  );
}

function SortableNavRow({ item, onUnpin }: { item: NavItemDef; onUnpin: () => void }) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.to,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <Group
      ref={setNodeRef}
      style={style}
      gap="xs"
      px="xs"
      py={4}
      justify="space-between"
      wrap="nowrap"
      bg="var(--mantine-color-default-hover)"
    >
      <Group gap="xs" wrap="nowrap">
        <Box
          {...attributes}
          {...listeners}
          style={{ cursor: "grab", display: "flex" }}
          aria-label={t("nav.drag")}
        >
          <IconGripVertical size={16} opacity={0.5} />
        </Box>
        <item.icon size={18} />
        <Text size="sm">{t(item.labelKey)}</Text>
      </Group>
      <ActionIcon variant="subtle" color="gray" aria-label={t("nav.unpin")} onClick={onUnpin}>
        <IconPinnedOff size={16} />
      </ActionIcon>
    </Group>
  );
}
