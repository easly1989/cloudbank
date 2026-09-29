import { ActionIcon, Box, Indicator, TextInput, Tooltip } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import {
  IconColumns3,
  IconEye,
  IconEyeOff,
  IconFilter,
  IconSearch,
  IconX,
} from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

import { clearedFacets, registerChips } from "./registerChips";
import { type Filters } from "./registerFilterModel";
import type { PanelId, RegisterPanels } from "./registerPanels";

// One row above the ledger: search, and the buttons that open a panel.
//
// It is a row and not a block on purpose. Everything here used to stack
// vertically — a collapsible section, a count badge, a clear button, a second
// clear button — and each of those took height from the only thing on the page
// worth looking at. A ledger you can see ten rows of is a different tool from
// one you can see four rows of.
//
// The chips naming each filter live at the head of the filter panel, on every
// screen (#535): in the row they took a second line as soon as there were a
// few. The Filters button keeps their count, and on a desktop a red × on its
// other corner clears them all without opening anything.
export function RegisterToolbar({
  filters,
  onFilters,
  panels,
  onTogglePanel,
  privacy,
  onPrivacy,
}: {
  filters: Filters;
  onFilters: (f: Filters) => void;
  panels: RegisterPanels;
  onTogglePanel: (id: PanelId) => void;
  privacy: boolean;
  onPrivacy: (v: boolean) => void;
}) {
  const { t } = useTranslation();
  const phone = useMediaQuery("(max-width: 47.99em)") ?? false;
  const chips = registerChips(filters, onFilters, t);
  const privacyLabel = t(privacy ? "register.privacy.show" : "register.privacy.hide");
  const filtersLabel =
    chips.length > 0 ? `${t("filters.section")} (${chips.length})` : t("filters.section");

  return (
    <div className="cb-register-toolbar" data-tour="register-toolbar">
      <TextInput
        className="cb-register-search"
        aria-label={t("register.search")}
        placeholder={t("register.search")}
        leftSection={<IconSearch size={15} />}
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
      />

      <div className="cb-register-toolbar-buttons">
        <Box pos="relative">
          <Tooltip label={t("filters.section")}>
            <Indicator
              label={chips.length}
              size={18}
              offset={4}
              disabled={chips.length === 0}
              data-testid="filters-count"
            >
              <ActionIcon
                variant={panels.filters ? "filled" : "default"}
                size={44}
                aria-label={filtersLabel}
                aria-pressed={panels.filters}
                onClick={() => onTogglePanel("filters")}
              >
                <IconFilter size={16} />
              </ActionIcon>
            </Indicator>
          </Tooltip>
          {/* A 18px target is fine for a mouse and too small for a finger: the
              phone's sheet has its own "Clear filters". */}
          {!phone && chips.length > 0 && (
            <Tooltip label={t("filters.clearAll")}>
              <ActionIcon
                className="cb-filters-clear-all"
                variant="filled"
                color="red"
                radius="xl"
                size={18}
                aria-label={t("filters.clearAll")}
                onClick={() => onFilters(clearedFacets(filters))}
              >
                <IconX size={12} stroke={3} />
              </ActionIcon>
            </Tooltip>
          )}
        </Box>
        <Tooltip label={t("register.columns")}>
          <ActionIcon
            variant={panels.columns ? "filled" : "default"}
            size={44}
            aria-label={t("register.columns")}
            aria-pressed={panels.columns}
            onClick={() => onTogglePanel("columns")}
          >
            <IconColumns3 size={16} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label={privacyLabel}>
          <ActionIcon
            variant={privacy ? "filled" : "default"}
            size={44}
            aria-label={privacyLabel}
            aria-pressed={privacy}
            onClick={() => onPrivacy(!privacy)}
          >
            {privacy ? <IconEyeOff size={16} /> : <IconEye size={16} />}
          </ActionIcon>
        </Tooltip>
      </div>
    </div>
  );
}
