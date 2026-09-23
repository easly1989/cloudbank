import { ActionIcon, Badge, Button, Group, TextInput, Tooltip } from "@mantine/core";
import {
  IconColumns3,
  IconEye,
  IconEyeOff,
  IconFilter,
  IconSearch,
  IconX,
} from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

import { activeFilters, type Filters } from "./registerFilterModel";

/** Which side panel is open, if any. */
export type RegisterPanel = "filters" | "columns" | null;

// One row above the ledger: search, what is currently narrowing it, and the two
// buttons that open a panel.
//
// It is a row and not a block on purpose. Everything here used to stack
// vertically — a collapsible section, a count badge, a clear button, a second
// clear button — and each of those took height from the only thing on the page
// worth looking at. A ledger you can see ten rows of is a different tool from
// one you can see four rows of.
export function RegisterToolbar({
  filters,
  onFilters,
  panel,
  onPanel,
  privacy,
  onPrivacy,
}: {
  filters: Filters;
  onFilters: (f: Filters) => void;
  panel: RegisterPanel;
  onPanel: (p: RegisterPanel) => void;
  privacy: boolean;
  onPrivacy: (v: boolean) => void;
}) {
  const { t } = useTranslation();
  const chips = activeFilters(filters);
  const privacyLabel = t(privacy ? "register.privacy.show" : "register.privacy.hide");

  return (
    <Group gap="xs" wrap="wrap" align="center">
      <TextInput
        aria-label={t("register.search")}
        placeholder={t("register.search")}
        leftSection={<IconSearch size={16} />}
        rightSection={
          filters.text ? (
            <ActionIcon
              variant="subtle"
              color="gray"
              aria-label={t("filters.clear")}
              onClick={() => onFilters({ ...filters, text: "" })}
            >
              <IconX size={15} />
            </ActionIcon>
          ) : undefined
        }
        value={filters.text}
        onChange={(e) => onFilters({ ...filters, text: e.currentTarget.value })}
        style={{ flex: 1, minWidth: 220 }}
      />

      {/* Each filter names itself and goes on its own. A badge reading "3" told
          the reader that three were on without saying which, so the only way to
          find out was to open the panel and read every control. */}
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
              aria-label={t("filters.chip.remove", { name: t(c.labelKey) })}
              onClick={() => onFilters(c.clear(filters))}
            >
              <IconX size={12} />
            </ActionIcon>
          }
        >
          {c.value ? `${t(c.labelKey)}: ${c.value}` : t(c.labelKey)}
        </Badge>
      ))}
      {chips.length > 1 && (
        <Button
          variant="subtle"
          color="gray"
          size="compact-sm"
          onClick={() => onFilters({ ...filters, ...clearedFacets(filters) })}
        >
          {t("filters.clear")}
        </Button>
      )}

      <Tooltip label={t("filters.section")}>
        <ActionIcon
          variant={panel === "filters" ? "filled" : "default"}
          size={36}
          aria-label={t("filters.section")}
          aria-pressed={panel === "filters"}
          onClick={() => onPanel(panel === "filters" ? null : "filters")}
        >
          <IconFilter size={17} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label={privacyLabel}>
        <ActionIcon
          variant={privacy ? "filled" : "default"}
          size={36}
          aria-label={privacyLabel}
          aria-pressed={privacy}
          onClick={() => onPrivacy(!privacy)}
        >
          {privacy ? <IconEyeOff size={17} /> : <IconEye size={17} />}
        </ActionIcon>
      </Tooltip>
      <Tooltip label={t("register.columns")}>
        <ActionIcon
          variant={panel === "columns" ? "filled" : "default"}
          size={36}
          aria-label={t("register.columns")}
          aria-pressed={panel === "columns"}
          onClick={() => onPanel(panel === "columns" ? null : "columns")}
        >
          <IconColumns3 size={17} />
        </ActionIcon>
      </Tooltip>
    </Group>
  );
}

// Clearing every chip at once, by asking each one to clear itself — so "clear
// all" can never drift from what the individual chips do.
function clearedFacets(f: Filters): Filters {
  return activeFilters(f).reduce((acc, c) => c.clear(acc), f);
}
