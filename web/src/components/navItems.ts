import {
  IconArrowsExchange,
  IconCalendarRepeat,
  IconCar,
  IconCategory,
  IconChartBar,
  IconCoin,
  IconLayoutDashboard,
  IconPigMoney,
  IconReportMoney,
  IconTag,
  IconTemplate,
  IconUserDollar,
  IconWallet,
  IconWand,
} from "@tabler/icons-react";
import type { ComponentType } from "react";

export interface NavItemDef {
  to: string;
  labelKey: string;
  icon: ComponentType<{ size?: number | string }>;
  end: boolean;
  adminOnly: boolean;
}

// The full set of navigation destinations, in their default order.
//
// Bank sync and Review are not among them (#504, #505): the bank connections
// are a setting, under Settings › Bank sync & AI, and Review is reached from
// where its work is — the register's "to review" button and the overview's
// list of things that want doing — rather than from a page that sits in the
// sidebar whether or not there is anything to review.
export const NAV_ITEMS: NavItemDef[] = [
  { to: "/", labelKey: "nav.dashboard", icon: IconLayoutDashboard, end: true, adminOnly: false },
  { to: "/accounts", labelKey: "nav.accounts", icon: IconWallet, end: false, adminOnly: false },
  {
    to: "/transactions",
    labelKey: "nav.transactions",
    icon: IconArrowsExchange,
    end: false,
    adminOnly: false,
  },
  {
    to: "/schedules",
    labelKey: "nav.schedules",
    icon: IconCalendarRepeat,
    end: false,
    adminOnly: false,
  },
  { to: "/templates", labelKey: "nav.templates", icon: IconTemplate, end: false, adminOnly: false },
  { to: "/tags", labelKey: "nav.tags", icon: IconTag, end: false, adminOnly: false },
  { to: "/vehicles", labelKey: "nav.vehicles", icon: IconCar, end: false, adminOnly: false },
  { to: "/assignments", labelKey: "nav.assignments", icon: IconWand, end: false, adminOnly: false },
  { to: "/budget", labelKey: "nav.budget", icon: IconReportMoney, end: false, adminOnly: false },
  { to: "/goals", labelKey: "nav.goals", icon: IconPigMoney, end: false, adminOnly: false },
  { to: "/reports", labelKey: "nav.reports", icon: IconChartBar, end: false, adminOnly: false },
  // Until #537 these three were reached only from Settings › wallet › Manage data.
  {
    to: "/categories",
    labelKey: "nav.categories",
    icon: IconCategory,
    end: false,
    adminOnly: false,
  },
  { to: "/payees", labelKey: "nav.payees", icon: IconUserDollar, end: false, adminOnly: false },
  { to: "/currencies", labelKey: "nav.currencies", icon: IconCoin, end: false, adminOnly: false },
];

export interface NavGroupDef {
  labelKey: string;
  /** Destination paths in this group, in display order. */
  items: string[];
}

// Destinations organized into sections. The dashboard ("/") is rendered on its
// own above the groups. Any destination not listed here (e.g. a future one) falls
// into an "Other" group so it can never disappear from the nav.
//
// Money is where the work is done; "Wallet data" is what describes the wallet —
// the lists a transaction picks from, and the rules and templates that fill one
// in (#537). It comes last: those pages are set up once and visited now and then.
export const NAV_GROUPS: NavGroupDef[] = [
  { labelKey: "nav.group.money", items: ["/accounts", "/transactions"] },
  { labelKey: "nav.group.planning", items: ["/schedules", "/budget", "/goals"] },
  { labelKey: "nav.group.insights", items: ["/reports", "/vehicles"] },
  {
    labelKey: "nav.group.wallet",
    items: ["/categories", "/payees", "/tags", "/assignments", "/templates", "/currencies"],
  },
];
