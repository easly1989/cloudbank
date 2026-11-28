// Where the settings screen's old addresses land (#800). Kept apart from the
// map of rows so the app's router can read it without loading the icons.

/**
 * Where an old address now lands (#800): the eleven sections became eight.
 * The keys are the old section ids; `general` splits in two, and the entry
 * sheet's fields went to Personalisation.
 */
export const MOVED_SECTIONS: Record<string, string> = {
  general: "account",
  appearance: "personalization",
  security: "account",
  data: "wallet",
  people: "admin/people",
  about: "home",
  "bank-sync": "connections/bank-sync",
  integrations: "connections/bank-sync",
  mail: "connections/mail",
};

/** Where an older `?tab=` bookmark now lands. */
export const LEGACY_TABS: Record<string, string> = {
  general: "account",
  wallet: "wallet",
  nav: "personalization#navigation",
  tokens: "account/tokens",
  people: "admin/people",
};

/**
 * Where an old address lands: `from` is an old section's id, or undefined for
 * `/settings` itself, which reads the oldest bookmarks' `?tab=`. The query
 * and `#row` go along, so `?passkeys=add` and `#entry-fields` still work.
 */
export function legacyTarget(from: string | undefined, search: string, hash: string) {
  const params = new URLSearchParams(search);
  let target: string;
  if (from !== undefined) {
    // General split in two: the entry sheet's fields went to Personalisation;
    // single sign-on left Security for Administration.
    target =
      from === "general" && hash === "#entry-fields"
        ? "personalization"
        : from === "security" && hash === "#sso"
          ? "admin"
          : (MOVED_SECTIONS[from] ?? "home");
  } else {
    const tab = params.get("tab");
    const section = params.get("section");
    params.delete("tab");
    params.delete("section");
    target =
      tab === "wallet" && (section === "import" || section === "backup")
        ? `wallet/${section}`
        : tab
          ? (LEGACY_TABS[tab] ?? "home")
          : "home";
  }
  const [pathname, anchor] = target.split("#");
  const rest = params.toString();
  return {
    pathname: `/settings/${pathname}`,
    search: rest ? `?${rest}` : "",
    hash: anchor ? `#${anchor}` : hash,
  };
}
