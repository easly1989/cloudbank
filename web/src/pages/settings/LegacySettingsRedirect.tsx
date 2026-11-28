import { Navigate, useLocation } from "react-router-dom";

import { legacyTarget } from "./legacy";

/**
 * Where `/settings` lands, and where an old bookmark lands.
 *
 * Settings used to be one page with a `?tab=` query (and, in the wallet tab, a
 * `?section=`), then eleven sections, now eight (#800). Those links are in
 * people's browser history, in this repo's documentation and in the app's own
 * code, so they keep working: each lands where its content went, with its
 * query and its `#row` kept.
 */
export function LegacySettingsRedirect({ from }: { from?: string }) {
  const { search, hash } = useLocation();
  return <Navigate to={legacyTarget(from, search, hash)} replace />;
}
