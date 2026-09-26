import {
  ActionIcon,
  Button,
  Group,
  Modal,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import { IconTrash } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { type SavedReportView, type User, updateMe } from "../../api/client";
import { useAuth } from "../../auth/AuthProvider";
import { VIEW_TAB, viewToSearch } from "./reportState";

const genViewId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

// Saved views: a report as it looks now, under a name, to open again in one
// click. A view is the page's URL — tab, period, filters and all — so it opens
// on whichever tab it was saved from. Views live in the user's preferences,
// scoped to the wallet.
export function SavedViewsModal({
  opened,
  onClose,
  walletId,
  search,
  onOpen,
}: {
  opened: boolean;
  onClose: () => void;
  walletId: number;
  /** The report's current query string, saved as the view. */
  search: string;
  onOpen: (search: string) => void;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const all = useMemo(() => user?.preferences?.reportViews ?? [], [user]);
  const views = all.filter((v) => v.walletId === walletId && viewToSearch(v) !== null);

  const persist = useMutation({
    mutationFn: (next: SavedReportView[]) =>
      updateMe({ preferences: { ...(user?.preferences ?? {}), reportViews: next } }),
    onSuccess: (u: User) => qc.setQueryData(["me"], u),
  });

  const save = () => {
    const n = name.trim();
    if (!n) return;
    // A view saved under a name already in use replaces it.
    const rest = all.filter(
      (v) => !(v.walletId === walletId && v.tab === VIEW_TAB && v.name === n),
    );
    persist.mutate([
      ...rest,
      { id: genViewId(), walletId, tab: VIEW_TAB, name: n, config: { search } },
    ]);
    setName("");
  };

  return (
    <Modal opened={opened} onClose={onClose} title={t("reports.views.title")}>
      <Stack>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <Group align="flex-end" wrap="nowrap">
            <TextInput
              label={t("reports.views.name")}
              placeholder={t("reports.views.namePlaceholder")}
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
              style={{ flex: 1 }}
            />
            <Button type="submit" disabled={!name.trim()} loading={persist.isPending}>
              {t("reports.views.save")}
            </Button>
          </Group>
        </form>
        {views.length === 0 ? (
          <Text c="dimmed" size="sm">
            {t("reports.views.empty")}
          </Text>
        ) : (
          <Stack gap={0}>
            {views.map((v) => (
              <Group
                key={v.id}
                justify="space-between"
                wrap="nowrap"
                py={6}
                style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}
              >
                <UnstyledButton
                  onClick={() => onOpen(viewToSearch(v)!)}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    color: "var(--cb-accent-text)",
                    fontWeight: 600,
                    fontSize: 14,
                  }}
                >
                  {v.name}
                </UnstyledButton>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  aria-label={t("reports.views.delete", { name: v.name })}
                  onClick={() => persist.mutate(all.filter((x) => x.id !== v.id))}
                >
                  <IconTrash size={16} />
                </ActionIcon>
              </Group>
            ))}
          </Stack>
        )}
      </Stack>
    </Modal>
  );
}
