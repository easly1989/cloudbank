import { ActionIcon, Badge, Button, Group } from "@mantine/core";
import { IconX } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

/** One active filter, already named for the reader. */
export interface FilterChip {
  id: string;
  label: string;
  onRemove: () => void;
}

/**
 * The filters narrowing a list, one chip each, and a way to clear them all.
 *
 * The register and the reports both show them, and in two places (#502): in
 * the toolbar where there is room for them, and at the head of the filter
 * panel on a phone, where there is not. The button that opens the panel
 * carries their count either way, so the reader always knows something is
 * on; the chips say which.
 */
export function FilterChips({
  chips,
  onClear,
}: {
  chips: FilterChip[];
  /** Offered once there are two or more to clear. */
  onClear?: () => void;
}) {
  const { t } = useTranslation();
  if (chips.length === 0) return null;
  return (
    <Group gap={6} wrap="wrap" data-testid="filter-chips">
      {chips.map((c) => (
        <Badge
          key={c.id}
          variant="light"
          size="lg"
          rightSection={
            <ActionIcon
              size="xs"
              variant="transparent"
              color="gray"
              aria-label={t("filters.chip.remove", { name: c.label })}
              onClick={c.onRemove}
            >
              <IconX size={12} />
            </ActionIcon>
          }
        >
          {c.label}
        </Badge>
      ))}
      {onClear && chips.length > 1 && (
        <Button variant="subtle" color="gray" size="compact-sm" onClick={onClear}>
          {t("filters.clear")}
        </Button>
      )}
    </Group>
  );
}
