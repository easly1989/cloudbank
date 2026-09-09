import {
  IconArrowsExchange,
  IconBuildingBank,
  IconCalendarRepeat,
  IconCar,
  IconChartBar,
  IconChecklist,
  IconLayoutDashboard,
  IconPigMoney,
  IconReceipt,
  IconReportMoney,
  IconSettings,
  IconTag,
  IconTemplate,
  IconUsers,
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
  { to: "/bills", labelKey: "nav.bills", icon: IconReceipt, end: false, adminOnly: false },
  {
    to: "/bank-sync",
    labelKey: "nav.bankSync",
    icon: IconBuildingBank,
    end: false,
    adminOnly: false,
  },
  { to: "/review", labelKey: "nav.review", icon: IconChecklist, end: false, adminOnly: false },
  { to: "/templates", labelKey: "nav.templates", icon: IconTemplate, end: false, adminOnly: false },
  { to: "/tags", labelKey: "nav.tags", icon: IconTag, end: false, adminOnly: false },
  { to: "/vehicles", labelKey: "nav.vehicles", icon: IconCar, end: false, adminOnly: false },
  { to: "/assignments", labelKey: "nav.assignments", icon: IconWand, end: false, adminOnly: false },
  { to: "/budget", labelKey: "nav.budget", icon: IconReportMoney, end: false, adminOnly: false },
  { to: "/goals", labelKey: "nav.goals", icon: IconPigMoney, end: false, adminOnly: false },
  { to: "/reports", labelKey: "nav.reports", icon: IconChartBar, end: false, adminOnly: false },
  { to: "/settings", labelKey: "nav.settings", icon: IconSettings, end: false, adminOnly: false },
  { to: "/admin/users", labelKey: "nav.admin", icon: IconUsers, end: false, adminOnly: true },
];

export interface NavGroupDef {
  labelKey: string;
  /** Destination paths in this group, in display order. */
  items: string[];
}

// Destinations organized into sections. The dashboard ("/") is rendered on its
// own above the groups. Any destination not listed here (e.g. a future one) falls
// into an "Other" group so it can never disappear from the nav.
export const NAV_GROUPS: NavGroupDef[] = [
  {
    labelKey: "nav.group.money",
    items: ["/accounts", "/transactions", "/templates", "/tags", "/assignments"],
  },
  { labelKey: "nav.group.planning", items: ["/schedules", "/bills", "/budget", "/goals"] },
  { labelKey: "nav.group.banking", items: ["/bank-sync", "/review"] },
  { labelKey: "nav.group.insights", items: ["/reports", "/vehicles"] },
  { labelKey: "nav.group.settings", items: ["/settings", "/admin/users"] },
];
