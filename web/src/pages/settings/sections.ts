import {
  IconBell,
  IconBellRinging,
  IconBrandDiscord,
  IconBrandMatrix,
  IconBrandSlack,
  IconBrandTelegram,
  IconBuildingBank,
  IconCalendar,
  IconCalendarRepeat,
  IconCategory,
  IconChartDots,
  IconClock,
  IconCode,
  IconCoin,
  IconColorSwatch,
  IconDatabase,
  IconDatabaseExport,
  IconDeviceMobile,
  IconDownload,
  IconFileSpreadsheet,
  IconFingerprint,
  IconForms,
  IconHome,
  IconKey,
  IconLayoutBottombar,
  IconLayoutDashboard,
  IconLayoutSidebar,
  IconLifebuoy,
  IconListDetails,
  IconListNumbers,
  IconMail,
  IconMenu2,
  IconMessageQuestion,
  IconMoon,
  IconPalette,
  IconPencilBolt,
  IconPigMoney,
  IconPlug,
  IconReceipt,
  IconRefresh,
  IconScale,
  IconServer,
  IconShieldCheck,
  IconShieldLock,
  IconSparkles,
  IconPower,
  IconCpu,
  IconSunMoon,
  IconTarget,
  IconTrash,
  IconUpload,
  IconUser,
  IconUsers,
  IconWallet,
  IconWand,
  IconWebhook,
  IconWorld,
  IconZoomExclamation,
  type Icon,
} from "@tabler/icons-react";

import type { AIFeature } from "../../api/ai";
import type { NotificationChannel } from "../../api/client";

// The settings screen's map (#800): its eight sections and every setting in
// them, one row each. The pages render their rows from this list, and the
// search in the nav reads the same list, so what can be found is what is there.
// It holds names, icons and conditions only, never a page, so the nav and the
// search load without the sections' code.

/** Who is looking, for the rows that only some people have. */
export interface RowContext {
  isAdmin: boolean;
  demo: boolean;
  /** The server signs in through SSO only (#620): no password, no 2FA. */
  ssoOnly: boolean;
  /** The server offers passkeys (#798). */
  passkeys: boolean;
  /** The reader owns the open wallet. */
  isOwner: boolean;
}

type When = (c: RowContext) => boolean;

export type SectionId =
  | "home"
  | "account"
  | "personalization"
  | "wallet"
  | "connections"
  | "notifications"
  | "ai"
  | "admin";

export interface SettingsSection {
  id: SectionId;
  labelKey: string;
  icon: Icon;
  when?: When;
}

/**
 * The sections, from what everyone changes on day one to what most people
 * never touch, so the thing you came for is usually near the top.
 */
export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  { id: "home", labelKey: "settings.sections.home", icon: IconHome },
  { id: "account", labelKey: "settings.sections.account", icon: IconUser },
  { id: "personalization", labelKey: "settings.sections.personalization", icon: IconPalette },
  { id: "wallet", labelKey: "settings.wallet", icon: IconWallet },
  { id: "connections", labelKey: "settings.sections.connections", icon: IconPlug },
  { id: "notifications", labelKey: "notif.title", icon: IconBell },
  { id: "ai", labelKey: "settings.ai", icon: IconSparkles, when: (c) => !c.demo },
  {
    id: "admin",
    labelKey: "settings.sections.admin",
    icon: IconShieldCheck,
    when: (c) => c.isAdmin,
  },
];

export interface SettingRowDef {
  id: string;
  section: SectionId;
  /** The page it is on, below /settings/, when not the section's own. */
  page?: string;
  /** The page it opens, below /settings/: the row is then a link. */
  to?: string;
  icon: Icon;
  titleKey: string;
  hintKey: string;
  when?: When;
}

const notDemo: When = (c) => !c.demo;
const signsIn: When = (c) => !c.demo && !c.ssoOnly;

/** The notification channels (#688), in the order their list shows them. */
export const CHANNELS: { id: NotificationChannel; icon: Icon }[] = [
  { id: "inapp", icon: IconBell },
  { id: "push", icon: IconDeviceMobile },
  { id: "email", icon: IconMail },
  { id: "matrix", icon: IconBrandMatrix },
  { id: "telegram", icon: IconBrandTelegram },
  { id: "discord", icon: IconBrandDiscord },
  { id: "slack", icon: IconBrandSlack },
  { id: "ntfy", icon: IconBellRinging },
  { id: "gotify", icon: IconServer },
  { id: "webhook", icon: IconWebhook },
];

/** What the AI can do (#696), in the order its page lists them. */
export const AI_FEATURES: { key: AIFeature; icon: Icon }[] = [
  { key: "reports", icon: IconChartDots },
  { key: "ask", icon: IconMessageQuestion },
  { key: "budgets", icon: IconPigMoney },
  { key: "subscriptions", icon: IconCalendarRepeat },
  { key: "savings", icon: IconCoin },
  { key: "goals", icon: IconTarget },
  { key: "unusual", icon: IconZoomExclamation },
  { key: "rules", icon: IconWand },
  { key: "payees", icon: IconUsers },
  { key: "import", icon: IconFileSpreadsheet },
  { key: "suggest", icon: IconCategory },
  { key: "entry", icon: IconPencilBolt },
  { key: "receipts", icon: IconReceipt },
  { key: "mail", icon: IconMail },
];

const row = (
  section: SectionId,
  id: string,
  icon: Icon,
  titleKey: string,
  hintKey: string,
  extra: Partial<SettingRowDef> = {},
): SettingRowDef => ({ id, section, icon, titleKey, hintKey, ...extra });

export const SETTING_ROWS: readonly SettingRowDef[] = [
  // Account: your preferences, then how you get in.
  row("account", "language", IconWorld, "preferences.language", "settings.row.languageHint"),
  row("account", "date-format", IconCalendar, "preferences.dateFormat", "settings.row.dateHint"),
  row("account", "start-screen", IconHome, "preferences.startScreen", "settings.row.startHint"),
  row(
    "account",
    "tours",
    IconLayoutDashboard,
    "preferences.tourOffers",
    "preferences.tourOffersHint",
  ),
  row(
    "account",
    "smart-amount",
    IconListNumbers,
    "preferences.smartAmount",
    "preferences.smartAmountHint",
  ),
  row("account", "password", IconKey, "password.title", "password.hint", { when: signsIn }),
  row("account", "two-factor", IconShieldLock, "twofa.title", "twofa.hint", { when: signsIn }),
  row("account", "passkeys", IconFingerprint, "passkeys.title", "passkeys.hint", {
    when: (c) => signsIn(c) && c.passkeys,
  }),
  row("account", "recovery-codes", IconLifebuoy, "accessCodes.title", "settings.row.codesHint", {
    when: (c) => !c.demo && c.ssoOnly,
  }),
  row("account", "api-tokens", IconCode, "settings.apiTokens", "settings.apiTokensHint", {
    to: "account/tokens",
    when: notDemo,
  }),

  // Personalisation: how the app looks.
  row("personalization", "theme", IconSunMoon, "preferences.theme", "settings.row.themeHint"),
  row(
    "personalization",
    "accent",
    IconColorSwatch,
    "preferences.accent",
    "settings.row.accentHint",
  ),
  row(
    "personalization",
    "footer",
    IconLayoutBottombar,
    "preferences.showFooter",
    "preferences.showFooterHint",
  ),
  row(
    "personalization",
    "sidebar-accounts",
    IconLayoutSidebar,
    "preferences.sidebarAccounts",
    "preferences.sidebarAccountsHint",
  ),
  row("personalization", "balances", IconScale, "preferences.balances", "preferences.balancesHint"),
  row("personalization", "navigation", IconMenu2, "settings.navigation", "settings.navigationHint"),
  row("personalization", "entry-fields", IconForms, "entryFields.title", "settings.row.entryHint"),

  // The open wallet: what it is, what goes in and out, and deleting it.
  row("wallet", "wallet-name", IconWallet, "settings.row.walletName", "wallet.groupWalletHint"),
  row(
    "wallet",
    "default-account",
    IconListDetails,
    "preferences.defaultAccount",
    "settings.row.defaultAccountHint",
  ),
  row("wallet", "schedules", IconClock, "wallet.groupSchedules", "wallet.groupSchedulesHint"),
  row("wallet", "import", IconUpload, "settings.row.import", "settings.importHint", {
    to: "wallet/import",
  }),
  row("wallet", "export", IconDownload, "settings.row.export", "settings.row.exportHint", {
    to: "wallet/export",
  }),
  row("wallet", "backup", IconDatabase, "settings.sectionBackup", "settings.backupHint", {
    to: "wallet/backup",
  }),
  row("wallet", "integrity", IconShieldCheck, "integrity.title", "integrity.description", {
    page: "wallet/backup",
  }),
  row("wallet", "wallet-backup", IconDownload, "backup.title", "backup.description", {
    page: "wallet/backup",
  }),
  row("wallet", "restore", IconRefresh, "backup.restoreLabel", "backup.restoreHint", {
    page: "wallet/backup",
    when: notDemo,
  }),
  row("wallet", "delete-wallet", IconTrash, "wallet.delete", "wallet.deleteWarning", {
    when: (c) => c.isOwner,
  }),

  // The two ways transactions come in by themselves.
  row("connections", "bank-sync", IconBuildingBank, "banksync.title", "settings.bankSyncHint", {
    to: "connections/bank-sync",
  }),
  row("connections", "mail", IconMail, "mail.title", "mail.hint", {
    to: "connections/mail",
    when: notDemo,
  }),

  // Notifications: a page per channel, then the money and the timing.
  ...CHANNELS.map((c) =>
    row("notifications", `notif-${c.id}`, c.icon, `notif.name.${c.id}`, `notif.about.${c.id}`, {
      to: `notifications/${c.id}`,
      when: c.id === "inapp" ? undefined : notDemo,
    }),
  ),
  row("notifications", "notif-money", IconCoin, "notif.money.title", "notif.money.subtitle", {
    to: "notifications/money",
  }),
  row("notifications", "notif-timing", IconClock, "notif.timing.title", "notif.timing.subtitle", {
    to: "notifications/timing",
    when: notDemo,
  }),
  row("notifications", "digest", IconClock, "notif.timing.digest", "settings.row.digestHint", {
    page: "notifications/timing",
    when: notDemo,
  }),
  row("notifications", "quiet-hours", IconMoon, "notif.timing.quiet", "notif.timing.quietOff", {
    page: "notifications/timing",
    when: notDemo,
  }),
  row(
    "notifications",
    "review-days",
    IconClock,
    "settings.row.reviewDays",
    "settings.row.reviewDaysHint",
    {
      page: "notifications/timing",
      when: notDemo,
    },
  ),

  // AI: the provider, then each job it can do.
  row("ai", "ai-enable", IconPower, "ai.enable", "ai.enableHint", { when: notDemo }),
  row("ai", "ai-base-url", IconWorld, "ai.baseUrl", "settings.row.baseUrlHint", { when: notDemo }),
  row("ai", "ai-model", IconCpu, "ai.model", "settings.row.modelHint", { when: notDemo }),
  row("ai", "ai-key", IconKey, "ai.apiKey", "settings.row.apiKeyHint", { when: notDemo }),
  ...AI_FEATURES.map((f) =>
    row("ai", `ai-${f.key}`, f.icon, `ai.feature.${f.key}.name`, `ai.feature.${f.key}.sends`, {
      when: notDemo,
    }),
  ),
  row("ai", "ai-wallets", IconWallet, "ai.wallets", "ai.walletsHint", { when: notDemo }),
  row("ai", "ai-motion", IconPalette, "ai.motion", "ai.motionHint", { when: notDemo }),
  row("ai", "ai-limit", IconChartDots, "ai.limit.label", "ai.limit.note", { when: notDemo }),

  // Administration: the server, for whoever runs it.
  row("admin", "people", IconUsers, "settings.people", "settings.row.peopleHint", {
    to: "admin/people",
  }),
  row("admin", "sso", IconKey, "sso.title", "sso.hint", { when: notDemo }),
  row("admin", "updates", IconRefresh, "settings.row.updates", "settings.row.updatesHint", {
    when: notDemo,
  }),
  row("admin", "update-check", IconRefresh, "updates.switch", "updates.switchHint", {
    when: notDemo,
  }),
  row("admin", "database", IconDatabaseExport, "settings.row.database", "backup.hotHint"),
];

export const ROW_BY_ID: ReadonlyMap<string, SettingRowDef> = new Map(
  SETTING_ROWS.map((r) => [r.id, r]),
);

/** A section can be seen, and has at least one row for this reader. */
export function visibleSections(c: RowContext): SettingsSection[] {
  return SETTINGS_SECTIONS.filter(
    (s) =>
      (!s.when || s.when(c)) &&
      (s.id === "home" || SETTING_ROWS.some((r) => r.section === s.id && rowVisible(r, c))),
  );
}

export function rowVisible(r: SettingRowDef, c: RowContext): boolean {
  const section = SETTINGS_SECTIONS.find((s) => s.id === r.section);
  return (!section?.when || section.when(c)) && (!r.when || r.when(c));
}

/** The id of the panel a row opens, for the control that opens it. */
export const panelId = (rowId: string) => `${rowId}-panel`;

/** Where a row leads: its own page for a link row, else the row on its page. */
export const rowHref = (r: SettingRowDef) =>
  r.to ? `/settings/${r.to}` : `/settings/${r.page ?? r.section}#${r.id}`;

/** Folded for search: lower case, accents off ("integrità" finds "integrita"). */
export const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

/** The rows whose title or description holds every word of the query. */
export function searchRows(
  query: string,
  c: RowContext,
  text: (r: SettingRowDef) => string,
): SettingRowDef[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  return SETTING_ROWS.filter((r) => {
    if (!rowVisible(r, c)) return false;
    const hay = fold(text(r));
    return words.every((w) => hay.includes(w));
  });
}
