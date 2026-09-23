import { Navigate, useSearchParams } from "react-router-dom";

import { LEGACY_TABS } from "./sections";

/**
 * Where `/settings` lands, and where an old bookmark lands.
 *
 * Settings used to be one page with a `?tab=` query and, inside the wallet tab,
 * a `?section=`. Those links are in people's browser history and in this repo's
 * own documentation, so they keep working: the tab maps to a section, and the
 * one section that moved elsewhere — import — goes with it.
 */
export function LegacySettingsRedirect() {
  const [params] = useSearchParams();
  const tab = params.get("tab");
  const section = params.get("section");
  const target =
    tab === "wallet" && (section === "import" || section === "backup")
      ? "data"
      : tab
        ? (LEGACY_TABS[tab] ?? "general")
        : "general";
  return <Navigate to={`/settings/${target}`} replace />;
}
