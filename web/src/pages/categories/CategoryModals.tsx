import { Button, Group, Modal, Select, Stack, Text } from "@mantine/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { Category } from "../../api/client";

/** Move everything from one category (or payee) into another, then remove it. */
export function MergeModal({
  title,
  source,
  options,
  onClose,
  onMerge,
}: {
  title: string;
  source: { id: number; name: string } | null;
  options: { value: string; label: string }[];
  onClose: () => void;
  onMerge: (targetId: number) => void;
}) {
  const { t } = useTranslation();
  // Mounted per source (see the key at the call site), so the choice starts
  // empty for each merge without an effect to clear it.
  const [target, setTarget] = useState<string | null>(null);

  return (
    <Modal opened={source !== null} onClose={onClose} title={title}>
      <Stack>
        <Text size="sm">{t("categories.mergeHint", { name: source?.name ?? "" })}</Text>
        <Select data={options} value={target} onChange={setTarget} searchable />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t("categories.cancel")}
          </Button>
          <Button
            color="orange"
            disabled={!target}
            onClick={() => target && onMerge(Number(target))}
          >
            {t("categories.merge")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

/** Delete a category; one with subcategories first says where they go. */
export function DeleteCategoryModal({
  category,
  hasChildren,
  topLevelTargets,
  onClose,
  onDelete,
  pending,
}: {
  category: Category | null;
  hasChildren: boolean;
  topLevelTargets: { value: string; label: string }[];
  onClose: () => void;
  onDelete: (reassignTo?: number) => void;
  pending: boolean;
}) {
  const { t } = useTranslation();
  // Mounted per category (see the key at the call site).
  const [reassignTo, setReassignTo] = useState<string | null>(null);

  return (
    <Modal opened={category !== null} onClose={onClose} title={t("categories.deleteTitle")}>
      <Stack>
        <Text size="sm">{t("categories.deleteHint", { name: category?.name ?? "" })}</Text>
        {hasChildren && (
          <Select
            label={t("categories.reassignTo")}
            description={t("categories.reassignHint")}
            data={topLevelTargets}
            value={reassignTo}
            onChange={setReassignTo}
            searchable
          />
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t("categories.cancel")}
          </Button>
          <Button
            color="red"
            loading={pending}
            disabled={hasChildren && !reassignTo}
            onClick={() => onDelete(reassignTo ? Number(reassignTo) : undefined)}
          >
            {t("categories.delete")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
