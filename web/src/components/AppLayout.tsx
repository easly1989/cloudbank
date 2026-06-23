import {
  ActionIcon,
  AppShell,
  Avatar,
  Burger,
  Button,
  Group,
  Menu,
  NavLink,
  Text,
  Tooltip,
  UnstyledButton,
  useMantineColorScheme,
} from "@mantine/core";
import { useDisclosure, useMediaQuery } from "@mantine/hooks";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  IconArrowsExchange,
  IconCalendarRepeat,
  IconChartBar,
  IconChevronDown,
  IconFileImport,
  IconLayoutDashboard,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconLogout,
  IconReportMoney,
  IconPlus,
  IconSettings,
  IconTemplate,
  IconUsers,
  IconWallet,
  IconWand,
} from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { NavLink as RouterNavLink, Outlet, useNavigate } from "react-router-dom";

import { updateMe, type User } from "../api/client";
import { useAuth, useLogout } from "../auth/AuthProvider";
import { useWallet } from "../wallet/WalletProvider";
import { AppFooter } from "./AppFooter";
import { ColorSchemeToggle } from "./ColorSchemeToggle";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { Logo } from "./Logo";

const navItems = [
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
  { to: "/assignments", labelKey: "nav.assignments", icon: IconWand, end: false, adminOnly: false },
  { to: "/budget", labelKey: "nav.budget", icon: IconReportMoney, end: false, adminOnly: false },
  { to: "/reports", labelKey: "nav.reports", icon: IconChartBar, end: false, adminOnly: false },
  { to: "/import", labelKey: "nav.import", icon: IconFileImport, end: false, adminOnly: false },
  { to: "/settings", labelKey: "nav.settings", icon: IconSettings, end: false, adminOnly: false },
  { to: "/admin/users", labelKey: "nav.admin", icon: IconUsers, end: false, adminOnly: true },
];

function WalletSwitcher() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { wallets, currentWallet, setCurrentWalletId } = useWallet();

  return (
    <Menu position="bottom-start" withinPortal>
      <Menu.Target>
        <Button variant="default" size="xs" rightSection={<IconChevronDown size={14} />}>
          {currentWallet?.title ?? "—"}
        </Button>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>{t("wallet.switch")}</Menu.Label>
        {wallets.map((w) => (
          <Menu.Item
            key={w.id}
            onClick={() => setCurrentWalletId(w.id)}
            leftSection={<IconWallet size={16} />}
            fw={w.id === currentWallet?.id ? 700 : 400}
          >
            {w.title}
          </Menu.Item>
        ))}
        <Menu.Divider />
        <Menu.Item leftSection={<IconPlus size={16} />} onClick={() => navigate("/wallet/new")}>
          {t("wallet.create")}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}

export function AppLayout() {
  const [opened, { toggle }] = useDisclosure();
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const qc = useQueryClient();
  const { setColorScheme } = useMantineColorScheme();
  const logout = useLogout();

  // Desktop sidebar collapse to an icon-only rail, remembered per user. The rail
  // only applies on desktop; the mobile drawer always shows full labels.
  const [collapsed, setCollapsed] = useState(() => user?.preferences?.sidebarCollapsed ?? false);
  const isDesktop = useMediaQuery("(min-width: 48em)");
  const railMode = collapsed && !!isDesktop;
  const persistCollapsed = useMutation({
    mutationFn: (next: boolean) =>
      updateMe({ preferences: { ...(user?.preferences ?? {}), sidebarCollapsed: next } }),
    onSuccess: (updated: User) => qc.setQueryData(["me"], updated),
  });
  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    persistCollapsed.mutate(next);
  };

  // Apply the user's server-persisted language and theme on load (and whenever
  // they change them in Preferences). The header toggles still work locally.
  useEffect(() => {
    if (user?.locale && user.locale !== i18n.resolvedLanguage) {
      void i18n.changeLanguage(user.locale);
    }
    if (user?.theme) {
      setColorScheme(user.theme as "auto" | "light" | "dark");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.locale, user?.theme]);

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: railMode ? 64 : 240, breakpoint: "sm", collapsed: { mobile: !opened } }}
      footer={{ height: 36 }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group>
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
            <ActionIcon
              variant="subtle"
              color="gray"
              onClick={toggleCollapsed}
              visibleFrom="sm"
              aria-label={t("nav.toggleSidebar")}
            >
              {collapsed ? (
                <IconLayoutSidebarLeftExpand size={20} />
              ) : (
                <IconLayoutSidebarLeftCollapse size={20} />
              )}
            </ActionIcon>
            <Group gap={8} wrap="nowrap">
              <Logo size={26} />
              <Text fw={700} size="lg">
                {t("app.name")}
              </Text>
            </Group>
            <WalletSwitcher />
          </Group>
          <Group>
            <LanguageSwitcher />
            <ColorSchemeToggle />
            <Menu position="bottom-end" withinPortal>
              <Menu.Target>
                <UnstyledButton aria-label={user?.username}>
                  <Group gap="xs">
                    <Avatar radius="xl" size={32} color="teal">
                      {user?.username.slice(0, 2).toUpperCase()}
                    </Avatar>
                    <Text size="sm" visibleFrom="sm">
                      {user?.username}
                    </Text>
                  </Group>
                </UnstyledButton>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item leftSection={<IconLogout size={16} />} onClick={() => logout.mutate()}>
                  {t("actions.signOut")}
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="sm">
        {navItems
          .filter((item) => !item.adminOnly || user?.isAdmin)
          .map((item) => {
            const link = (
              <NavLink
                key={item.to}
                component={RouterNavLink}
                to={item.to}
                end={item.end}
                label={railMode ? undefined : t(item.labelKey)}
                leftSection={<item.icon size={18} />}
                styles={railMode ? { body: { display: "none" } } : undefined}
              />
            );
            return railMode ? (
              <Tooltip key={item.to} label={t(item.labelKey)} position="right" withinPortal>
                {link}
              </Tooltip>
            ) : (
              link
            );
          })}
      </AppShell.Navbar>

      <AppShell.Main>
        <Outlet />
      </AppShell.Main>

      <AppShell.Footer>
        <AppFooter />
      </AppShell.Footer>
    </AppShell>
  );
}
