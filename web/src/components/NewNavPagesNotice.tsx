import { Button, Group, Paper, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconSparkles } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { ApiError, updateMe, type User } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { NAV_ITEMS } from "./navItems";
import { migrateNavLayout, unseenNavPages, type NavLayout } from "./navLayout";

const LABEL_KEY = new Map(NAV_ITEMS.map((i) => [i.to, i.labelKey]));

// NewNavPagesNotice tells a reader with a customised menu that pages have been
// added since they shaped it (#537). The menu is theirs, so the pages arrive
// hidden; this card, at the foot of the menu, is how they learn they exist.
// Either answer saves the layout, and a saved layout has nothing left unseen,
// so the card asks once.
export function NewNavPagesNotice() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const { user } = useAuth();
  const saved = user?.preferences?.navLayout;
  const unseen = useMemo(() => unseenNavPages(saved), [saved]);

  const save = useMutation({
    mutationFn: (next: NavLayout) =>
      updateMe({ preferences: { ...(user?.preferences ?? {}), navLayout: next } }),
    onSuccess: (u: User) => qc.setQueryData(["me"], u),
    onError: (err: unknown) =>
      notifications.show({
        color: "red",
        message: err instanceof ApiError ? err.message : String(err),
      }),
  });

  if (unseen.length === 0) return null;

  const decide = (show: boolean) => {
    const layout = migrateNavLayout(saved);
    save.mutate(
      show
        ? {
            ...layout,
            groups: layout.groups.map((g) => ({
              ...g,
              entries: g.entries.map((e) =>
                e.kind === "item" && unseen.includes(e.to) ? { ...e, hidden: false } : e,
              ),
            })),
          }
        : layout,
    );
  };
  const pages = new Intl.ListFormat(i18n.language, { type: "conjunction" }).format(
    unseen.map((to) => t(LABEL_KEY.get(to) ?? to)),
  );

  return (
    <Paper withBorder p="sm" radius="md" role="region" aria-label={t("nav.newPages.title")}>
      <Group gap={8} wrap="nowrap">
        <IconSparkles size={16} style={{ flexShrink: 0 }} />
        <Text fw={600} size="sm">
          {t("nav.newPages.title")}
        </Text>
      </Group>
      <Text size="xs" c="dimmed" mt={4} mb="xs">
        {t("nav.newPages.body", { pages, count: unseen.length })}
      </Text>
      <Group gap={6} grow wrap="nowrap">
        <Button
          size="compact-sm"
          variant="light"
          disabled={save.isPending}
          onClick={() => decide(true)}
        >
          {t("nav.newPages.show", { count: unseen.length })}
        </Button>
        <Button
          size="compact-sm"
          variant="subtle"
          color="gray"
          disabled={save.isPending}
          onClick={() => decide(false)}
        >
          {t("nav.newPages.keep", { count: unseen.length })}
        </Button>
      </Group>
    </Paper>
  );
}
