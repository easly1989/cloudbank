import {
  ActionIcon,
  Alert,
  Box,
  Button,
  Card,
  Divider,
  Group,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconEye,
  IconEyeOff,
  IconGripVertical,
  IconInfoCircle,
  IconLock,
  IconMinus,
  IconPlus,
  IconRestore,
  IconTrash,
} from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  closestCorners,
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { ApiError, updateMe, type User } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { NAV_ITEMS, type NavItemDef } from "./navItems";
import {
  defaultNavLayout,
  migrateNavLayout,
  newGroupId,
  newSeparatorId,
  type NavEntry,
  type NavGroupLayout,
  type NavLayout,
} from "./navLayout";

const BY_TO = new Map(NAV_ITEMS.map((i) => [i.to, i]));

// dnd-kit ids: groups are "G:<id>", item entries "I:<to>", separators "S:<id>".
const groupDndId = (id: string) => `G:${id}`;
const entryDndId = (e: NavEntry) => (e.kind === "item" ? `I:${e.to}` : `S:${e.id}`);

// NavLayoutEditor lets the user reshape the sidebar by drag-and-drop: reorder
// groups, drag items within a group or across groups, show/hide items and whole
// groups, rename or create groups, add separators, and reset to the default.
// Changes are debounce-saved to the user's preferences, so they apply on desktop
// and mobile alike. The dashboard is pinned and the Settings group is locked, so
// neither is editable here.
export function NavLayoutEditor() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { user } = useAuth();
  const isAdmin = Boolean(user?.isAdmin);
  const prefsRef = useRef(user?.preferences ?? {});
  prefsRef.current = user?.preferences ?? {};

  const [layout, setLayout] = useState<NavLayout>(() =>
    migrateNavLayout(user?.preferences?.navLayout),
  );
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const [activeId, setActiveId] = useState<string | null>(null);
  const beforeDrag = useRef<NavLayout | null>(null);

  const save = useMutation({
    mutationFn: (next: NavLayout) =>
      updateMe({ preferences: { ...prefsRef.current, navLayout: next } }),
    onSuccess: (u: User) => qc.setQueryData(["me"], u),
    onError: (err: unknown) =>
      notifications.show({
        color: "red",
        message: err instanceof ApiError ? err.message : String(err),
      }),
  });
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Update local state now; persist (debounced) only when `save` is true, so a
  // drag's intermediate cross-group moves don't each trigger a network write.
  const apply = (next: NavLayout, opts?: { save?: boolean }) => {
    layoutRef.current = next;
    setLayout(next);
    if (opts?.save) {
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => save.mutate(next), 400);
    }
  };
  useEffect(() => () => clearTimeout(saveTimer.current), []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const movable = layout.groups.filter((g) => !g.locked);
  const settings = layout.groups.find((g) => g.locked);

  const rebuild = (movableGroups: NavGroupLayout[], opts?: { save?: boolean }) =>
    apply(
      { version: layout.version, groups: settings ? [...movableGroups, settings] : movableGroups },
      opts,
    );

  const mapMovable = (
    id: string,
    fn: (g: NavGroupLayout) => NavGroupLayout,
    opts?: { save?: boolean },
  ) =>
    rebuild(
      layoutRef.current.groups.filter((g) => !g.locked).map((g) => (g.id === id ? fn(g) : g)),
      { save: true, ...opts },
    );

  // --- editing actions ---
  const addGroup = () =>
    rebuild(
      [
        ...movable,
        { id: newGroupId(layout.groups), label: t("settings.nav.newGroupName"), entries: [] },
      ],
      {
        save: true,
      },
    );
  const deleteGroup = (id: string) =>
    rebuild(
      movable.filter((g) => g.id !== id),
      { save: true },
    );
  const reset = () => {
    if (window.confirm(t("settings.nav.resetConfirm"))) apply(defaultNavLayout(), { save: true });
  };
  const renameGroup = (id: string, label: string) =>
    mapMovable(id, (g) => ({ ...g, label, labelKey: undefined }));
  const toggleGroupHidden = (id: string) => mapMovable(id, (g) => ({ ...g, hidden: !g.hidden }));
  const addSeparator = (id: string) =>
    mapMovable(id, (g) => ({
      ...g,
      entries: [...g.entries, { kind: "separator", id: newSeparatorId() }],
    }));
  const removeEntry = (id: string, idx: number) =>
    mapMovable(id, (g) => ({ ...g, entries: g.entries.filter((_, i) => i !== idx) }));
  const toggleEntryHidden = (id: string, idx: number) =>
    mapMovable(id, (g) => ({
      ...g,
      entries: g.entries.map((e, i) =>
        i === idx && e.kind === "item" ? { ...e, hidden: !e.hidden } : e,
      ),
    }));

  // --- drag helpers ---
  const containerOf = (dndId: string): string | null => {
    if (dndId.startsWith("G:")) return dndId.slice(2);
    for (const g of layoutRef.current.groups)
      if (!g.locked && g.entries.some((e) => entryDndId(e) === dndId)) return g.id;
    return null;
  };

  const onDragStart = (e: DragStartEvent) => {
    beforeDrag.current = layoutRef.current;
    setActiveId(String(e.active.id));
  };

  const onDragOver = (e: DragOverEvent) => {
    const activeIdStr = String(e.active.id);
    if (activeIdStr.startsWith("G:") || !e.over) return; // group drags reorder on end
    const fromId = containerOf(activeIdStr);
    const toId = containerOf(String(e.over.id));
    if (!fromId || !toId || fromId === toId) return;
    const groups = layoutRef.current.groups.map((g) => ({ ...g, entries: [...g.entries] }));
    const from = groups.find((g) => g.id === fromId);
    const to = groups.find((g) => g.id === toId);
    if (!from || !to || to.locked) return;
    const ai = from.entries.findIndex((x) => entryDndId(x) === activeIdStr);
    if (ai < 0) return;
    const [moved] = from.entries.splice(ai, 1);
    const overId = String(e.over.id);
    let oi = to.entries.findIndex((x) => entryDndId(x) === overId);
    if (oi < 0) oi = to.entries.length; // dropped on the container itself → append
    to.entries.splice(oi, 0, moved);
    apply({ version: layoutRef.current.version, groups });
  };

  const onDragEnd = (e: DragEndEvent) => {
    const activeIdStr = String(e.active.id);
    setActiveId(null);
    if (!e.over) {
      if (beforeDrag.current) apply(beforeDrag.current);
      return;
    }
    const overId = String(e.over.id);
    if (activeIdStr.startsWith("G:")) {
      // Reorder movable groups (Settings stays pinned last).
      const cur = layoutRef.current.groups.filter((g) => !g.locked);
      const from = cur.findIndex((g) => groupDndId(g.id) === activeIdStr);
      const to = cur.findIndex(
        (g) =>
          groupDndId(g.id) ===
          (overId.startsWith("G:") ? overId : groupDndId(containerOf(overId) ?? "")),
      );
      if (from >= 0 && to >= 0 && from !== to) rebuild(arrayMove(cur, from, to), { save: true });
      else if (beforeDrag.current) apply(beforeDrag.current, { save: true });
      return;
    }
    // Entry: reorder within its (possibly newly moved) container.
    const cId = containerOf(activeIdStr);
    if (!cId) return;
    const groups = layoutRef.current.groups.map((g) => ({ ...g, entries: [...g.entries] }));
    const g = groups.find((x) => x.id === cId);
    if (!g) return;
    const from = g.entries.findIndex((x) => entryDndId(x) === activeIdStr);
    let to = g.entries.findIndex((x) => entryDndId(x) === overId);
    if (to < 0) to = g.entries.length - 1;
    if (from >= 0 && to >= 0 && from !== to) g.entries = arrayMove(g.entries, from, to);
    apply({ version: layoutRef.current.version, groups }, { save: true });
  };

  const onDragCancel = () => {
    setActiveId(null);
    if (beforeDrag.current) apply(beforeDrag.current);
  };

  const activeLabel = (() => {
    if (!activeId) return null;
    if (activeId.startsWith("G:")) {
      const g = layout.groups.find((x) => groupDndId(x.id) === activeId);
      return g ? (g.label ?? (g.labelKey ? t(g.labelKey) : "")) : null;
    }
    for (const g of layout.groups)
      for (const e of g.entries)
        if (entryDndId(e) === activeId)
          return e.kind === "item"
            ? t(BY_TO.get(e.to)?.labelKey ?? e.to)
            : t("settings.nav.separator");
    return null;
  })();

  return (
    <Stack>
      <Group justify="space-between" align="flex-start">
        <Text c="dimmed" size="sm" maw={560}>
          {t("settings.nav.hint")}
        </Text>
        <Group gap="xs">
          <Button
            variant="default"
            size="xs"
            leftSection={<IconPlus size={16} />}
            onClick={addGroup}
          >
            {t("settings.nav.addGroup")}
          </Button>
          <Button
            variant="default"
            size="xs"
            color="gray"
            leftSection={<IconRestore size={16} />}
            onClick={reset}
          >
            {t("settings.nav.reset")}
          </Button>
        </Group>
      </Group>

      <Alert variant="light" color="blue" icon={<IconInfoCircle size={16} />} py="xs">
        {t("settings.nav.locked")}
      </Alert>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      >
        <SortableContext
          items={movable.map((g) => groupDndId(g.id))}
          strategy={verticalListSortingStrategy}
        >
          <Stack>
            {movable.map((g) => (
              <SortableGroupCard
                key={g.id}
                group={g}
                isAdmin={isAdmin}
                onRename={(label) => renameGroup(g.id, label)}
                onToggleHidden={() => toggleGroupHidden(g.id)}
                onDelete={() => deleteGroup(g.id)}
                onAddSeparator={() => addSeparator(g.id)}
                onRemoveEntry={(idx) => removeEntry(g.id, idx)}
                onToggleEntryHidden={(idx) => toggleEntryHidden(g.id, idx)}
              />
            ))}
          </Stack>
        </SortableContext>
        <DragOverlay>
          {activeLabel != null ? (
            <Card withBorder padding="xs" shadow="md">
              <Text size="sm">{activeLabel}</Text>
            </Card>
          ) : null}
        </DragOverlay>
      </DndContext>

      {settings && <LockedGroup group={settings} isAdmin={isAdmin} />}
    </Stack>
  );
}

function SortableGroupCard({
  group,
  isAdmin,
  onRename,
  onToggleHidden,
  onDelete,
  onAddSeparator,
  onRemoveEntry,
  onToggleEntryHidden,
}: {
  group: NavGroupLayout;
  isAdmin: boolean;
  onRename: (label: string) => void;
  onToggleHidden: () => void;
  onDelete: () => void;
  onAddSeparator: () => void;
  onRemoveEntry: (idx: number) => void;
  onToggleEntryHidden: (idx: number) => void;
}) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: groupDndId(group.id),
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  const hasItems = group.entries.some((e) => e.kind === "item");

  return (
    <Card withBorder padding="sm" ref={setNodeRef} style={style}>
      <Group justify="space-between" wrap="nowrap" gap="xs" mb="xs">
        <Group gap={4} wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
          <ActionIcon
            variant="subtle"
            color="gray"
            aria-label={t("settings.nav.drag")}
            {...attributes}
            {...listeners}
            style={{ cursor: "grab" }}
          >
            <IconGripVertical size={16} />
          </ActionIcon>
          <TextInput
            size="xs"
            style={{ flex: 1, minWidth: 0 }}
            aria-label={t("settings.nav.groupName")}
            placeholder={t("settings.nav.groupName")}
            value={group.label ?? (group.labelKey ? t(group.labelKey) : "")}
            onChange={(e) => onRename(e.currentTarget.value)}
          />
        </Group>
        <Group gap={4} wrap="nowrap">
          <Tooltip label={group.hidden ? t("settings.nav.show") : t("settings.nav.hide")} withArrow>
            <ActionIcon
              variant="subtle"
              color={group.hidden ? "gray" : "teal"}
              aria-label={group.hidden ? t("settings.nav.show") : t("settings.nav.hide")}
              onClick={onToggleHidden}
            >
              {group.hidden ? <IconEyeOff size={16} /> : <IconEye size={16} />}
            </ActionIcon>
          </Tooltip>
          <Tooltip
            label={hasItems ? t("settings.nav.deleteBlocked") : t("settings.nav.deleteGroup")}
            withArrow
          >
            <ActionIcon
              variant="subtle"
              color="red"
              aria-label={t("settings.nav.deleteGroup")}
              disabled={hasItems}
              onClick={onDelete}
            >
              <IconTrash size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>

      <Box pl="xl" style={{ opacity: group.hidden ? 0.5 : 1 }}>
        <SortableContext
          items={group.entries.map(entryDndId)}
          strategy={verticalListSortingStrategy}
        >
          <Stack gap={4} mih={8}>
            {group.entries.length === 0 && (
              <Text size="xs" c="dimmed">
                {t("settings.nav.emptyGroup")}
              </Text>
            )}
            {group.entries.map((entry, idx) => (
              <SortableEntryRow
                key={entryDndId(entry)}
                entry={entry}
                isAdmin={isAdmin}
                onRemove={() => onRemoveEntry(idx)}
                onToggleHidden={() => onToggleEntryHidden(idx)}
              />
            ))}
          </Stack>
        </SortableContext>
        <Group gap="xs" mt={4}>
          <Button
            size="compact-xs"
            variant="subtle"
            color="gray"
            leftSection={<IconMinus size={14} />}
            onClick={onAddSeparator}
          >
            {t("settings.nav.addSeparator")}
          </Button>
        </Group>
      </Box>
    </Card>
  );
}

function SortableEntryRow({
  entry,
  isAdmin,
  onRemove,
  onToggleHidden,
}: {
  entry: NavEntry;
  isAdmin: boolean;
  onRemove: () => void;
  onToggleHidden: () => void;
}) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: entryDndId(entry),
  });
  const item: NavItemDef | undefined = entry.kind === "item" ? BY_TO.get(entry.to) : undefined;
  // Hide admin-only destinations from a non-admin's editor.
  if (entry.kind === "item" && item?.adminOnly && !isAdmin) return null;
  const hidden = entry.kind === "item" && entry.hidden === true;
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : hidden ? 0.5 : 1,
  };

  return (
    <Group gap={4} wrap="nowrap" ref={setNodeRef} style={style}>
      <ActionIcon
        size="sm"
        variant="subtle"
        color="gray"
        aria-label={t("settings.nav.drag")}
        {...attributes}
        {...listeners}
        style={{ cursor: "grab" }}
      >
        <IconGripVertical size={14} />
      </ActionIcon>
      {entry.kind === "separator" ? (
        <>
          <Divider style={{ flex: 1 }} label={t("settings.nav.separator")} labelPosition="center" />
          <ActionIcon
            size="sm"
            variant="subtle"
            color="red"
            aria-label={t("actions.remove")}
            onClick={onRemove}
          >
            <IconTrash size={14} />
          </ActionIcon>
        </>
      ) : (
        <>
          {item && <item.icon size={16} />}
          <Text size="sm" style={{ flex: 1, minWidth: 0 }} truncate>
            {item ? t(item.labelKey) : entry.to}
          </Text>
          <Tooltip label={hidden ? t("settings.nav.show") : t("settings.nav.hide")} withArrow>
            <ActionIcon
              size="sm"
              variant="subtle"
              color={hidden ? "gray" : "teal"}
              aria-label={hidden ? t("settings.nav.show") : t("settings.nav.hide")}
              onClick={onToggleHidden}
            >
              {hidden ? <IconEyeOff size={16} /> : <IconEye size={16} />}
            </ActionIcon>
          </Tooltip>
        </>
      )}
    </Group>
  );
}

// The locked Settings group: shown for context but not editable or draggable.
function LockedGroup({ group, isAdmin }: { group: NavGroupLayout; isAdmin: boolean }) {
  const { t } = useTranslation();
  const items = group.entries
    .filter((e): e is Extract<NavEntry, { kind: "item" }> => e.kind === "item")
    .map((e) => BY_TO.get(e.to))
    .filter((i): i is NavItemDef => i != null && (!i.adminOnly || isAdmin));
  return (
    <Card withBorder padding="sm" bg="var(--mantine-color-default-hover)">
      <Group gap={6} mb="xs">
        <IconLock size={14} opacity={0.6} />
        <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
          {group.labelKey ? t(group.labelKey) : group.label}
        </Text>
      </Group>
      <Stack gap={4} pl="xl">
        {items.map((item) => (
          <Group key={item.to} gap={6} wrap="nowrap">
            <item.icon size={16} />
            <Text size="sm">{t(item.labelKey)}</Text>
          </Group>
        ))}
      </Stack>
    </Card>
  );
}
