import { Button, Group, Select } from "@mantine/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { type SavedReportView, type User, updateMe } from "../../api/client";
import { useAuth } from "../../auth/AuthProvider";

const genViewId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

// SavedViews lets the user name and re-open a report configuration. Views live
// in the per-user preferences blob, scoped by report tab + active wallet, so
// each report only sees its own. `current` is the tab's config to save;
// `onApply` restores a saved config into the tab's state.
export function SavedViews({
  tab,
  walletId,
  current,
  onApply,
}: {
  tab: string;
  walletId: number;
  current: Record<string, unknown>;
  onApply: (config: Record<string, unknown>) => void;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const all = useMemo(() => user?.preferences?.reportViews ?? [], [user]);
  const views = all.filter((v) => v.tab === tab && v.walletId === walletId);

  const persist = useMutation({
    mutationFn: (next: SavedReportView[]) =>
      updateMe({ preferences: { ...(user?.preferences ?? {}), reportViews: next } }),
    onSuccess: (u: User) => qc.setQueryData(["me"], u),
  });

  const save = () => {
    const name = window.prompt(t("reports.saveViewPrompt"))?.trim();
    if (!name) return;
    const id = genViewId();
    // Overwrite a same-named view in this tab/wallet, otherwise append.
    const rest = all.filter((v) => !(v.tab === tab && v.walletId === walletId && v.name === name));
    persist.mutate([...rest, { id, walletId, tab, name, config: current }]);
    setSelected(id);
  };

  const apply = (id: string | null) => {
    setSelected(id);
    const v = views.find((x) => x.id === id);
    if (v) onApply(v.config);
  };

  const del = () => {
    if (!selected) return;
    persist.mutate(all.filter((v) => v.id !== selected));
    setSelected(null);
  };

  return (
    <Group gap="xs" align="flex-end">
      <Select
        label={t("reports.savedViews")}
        placeholder={t("reports.savedViewsPlaceholder")}
        data={views.map((v) => ({ value: v.id, label: v.name }))}
        value={selected}
        onChange={apply}
        clearable
        w={200}
      />
      <Button variant="default" onClick={save}>
        {t("reports.saveView")}
      </Button>
      {selected && (
        <Button variant="subtle" color="red" onClick={del}>
          {t("reports.deleteView")}
        </Button>
      )}
    </Group>
  );
}
