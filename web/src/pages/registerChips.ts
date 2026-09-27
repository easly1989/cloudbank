import type { FilterChip } from "../components/FilterChips";
import { activeFilters, type Filters } from "./registerFilterModel";

/** The register's active filters as chips, each clearing only itself. */
export function registerChips(
  filters: Filters,
  onFilters: (f: Filters) => void,
  t: (key: string) => string,
): FilterChip[] {
  return activeFilters(filters).map((c) => ({
    id: c.id,
    label: c.value ? `${t(c.labelKey)}: ${c.value}` : t(c.labelKey),
    onRemove: () => onFilters(c.clear(filters)),
  }));
}

// Clearing every chip at once, by asking each one to clear itself — so "clear
// all" can never drift from what the individual chips do.
export function clearedFacets(f: Filters): Filters {
  return activeFilters(f).reduce((acc, c) => c.clear(acc), f);
}
