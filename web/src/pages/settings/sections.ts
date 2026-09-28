import {
  IconBuildingBank,
  IconDatabase,
  IconInfoCircle,
  IconPalette,
  IconSettings,
  IconShieldLock,
  IconUsers,
  IconWallet,
  type Icon,
} from "@tabler/icons-react";

export interface SettingsSection {
  id: string;
  labelKey: string;
  hintKey: string;
  icon: Icon;
  adminOnly?: boolean;
  /** Everything in it is switched off in the demo build, so it is not shown. */
  notInDemo?: boolean;
}

/**
 * The eight sections of the settings screen, in the tile's order.
 *
 * The order is not alphabetical and not by size: it runs from what everyone
 * changes on day one to what most people never touch, so the thing you came for
 * is usually near the top.
 */
export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    id: "general",
    labelKey: "settings.general",
    hintKey: "settings.generalHint",
    icon: IconSettings,
  },
  {
    id: "appearance",
    labelKey: "settings.appearance",
    hintKey: "settings.appearanceHint",
    icon: IconPalette,
  },
  { id: "wallet", labelKey: "settings.wallet", hintKey: "settings.walletHint", icon: IconWallet },
  {
    id: "security",
    labelKey: "settings.security",
    hintKey: "settings.securityHint",
    icon: IconShieldLock,
    notInDemo: true,
  },
  {
    id: "integrations",
    // The demo build has no AI, so the section is the bank sync alone.
    labelKey: __DEMO__ ? "banksync.title" : "settings.integrations",
    hintKey: __DEMO__ ? "settings.bankSyncHint" : "settings.integrationsHint",
    icon: IconBuildingBank,
  },
  { id: "data", labelKey: "settings.data", hintKey: "settings.dataHint", icon: IconDatabase },
  {
    id: "people",
    labelKey: "settings.people",
    hintKey: "settings.peopleHint",
    icon: IconUsers,
    adminOnly: true,
  },
  // Last, and for everyone: what this installation is and where its source is
  // (#513). The footer says the same, but the reader can turn the footer off.
  { id: "about", labelKey: "settings.about", hintKey: "settings.aboutHint", icon: IconInfoCircle },
];

/** Where an older `?tab=` bookmark now lands. */
export const LEGACY_TABS: Record<string, string> = {
  general: "general",
  wallet: "wallet",
  nav: "appearance",
  tokens: "security",
  people: "people",
};
