import { ActionIcon, Indicator, TextInput, Tooltip } from "@mantine/core";
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

import { FilterChips } from "../components/FilterChips";
import { clearedFacets, registerChips } from "./registerChips";
import { type Filters } from "./registerFilterModel";

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
//
// On a phone even the chips were too much: six of them filled the screen
// before the first row (#502). There the Filters button keeps only their count
// and the chips move to the head of the filter panel, so search and the three
// buttons share one line; the search box is what gives way.
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

      {/* Each filter names itself and goes on its own. A badge reading "3" told
          the reader that three were on without saying which, so the only way to
          find out was to open the panel and read every control. The count on
          the button is there as well, not instead. */}
      {!phone && <FilterChips chips={chips} onClear={() => onFilters(clearedFacets(filters))} />}

      <div className="cb-register-toolbar-buttons">
        <Tooltip label={t("filters.section")}>
          <Indicator
            label={chips.length}
            size={18}
            offset={4}
            disabled={chips.length === 0}
            data-testid="filters-count"
          >
            <ActionIcon
              variant={panel === "filters" ? "filled" : "default"}
              size={44}
              aria-label={filtersLabel}
              aria-pressed={panel === "filters"}
              onClick={() => onPanel(panel === "filters" ? null : "filters")}
            >
              <IconFilter size={16} />
            </ActionIcon>
          </Indicator>
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
        <Tooltip label={t("register.columns")}>
          <ActionIcon
            variant={panel === "columns" ? "filled" : "default"}
            size={44}
            aria-label={t("register.columns")}
            aria-pressed={panel === "columns"}
            onClick={() => onPanel(panel === "columns" ? null : "columns")}
          >
            <IconColumns3 size={16} />
          </ActionIcon>
        </Tooltip>
      </div>
    </div>
  );
}
