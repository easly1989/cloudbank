import {
  AppShell,
  Avatar,
  Burger,
  Group,
  Menu,
  NavLink,
  Text,
  UnstyledButton,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconChartBar,
  IconLayoutDashboard,
  IconLogout,
  IconSettings,
  IconUsers,
  IconWallet,
} from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { NavLink as RouterNavLink, Outlet } from "react-router-dom";

import { useAuth, useLogout } from "../auth/AuthProvider";
import { ColorSchemeToggle } from "./ColorSchemeToggle";
import { LanguageSwitcher } from "./LanguageSwitcher";

const navItems = [
  { to: "/", labelKey: "nav.dashboard", icon: IconLayoutDashboard, end: true, adminOnly: false },
  { to: "/accounts", labelKey: "nav.accounts", icon: IconWallet, end: false, adminOnly: false },
  { to: "/reports", labelKey: "nav.reports", icon: IconChartBar, end: false, adminOnly: false },
  { to: "/settings", labelKey: "nav.settings", icon: IconSettings, end: false, adminOnly: false },
  { to: "/admin/users", labelKey: "nav.admin", icon: IconUsers, end: false, adminOnly: true },
];

export function AppLayout() {
  const [opened, { toggle }] = useDisclosure();
  const { t } = useTranslation();
  const { user } = useAuth();
  const logout = useLogout();

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: 240, breakpoint: "sm", collapsed: { mobile: !opened } }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group>
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
            <Text fw={700} size="lg">
              {t("app.name")}
            </Text>
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
          .map((item) => (
            <NavLink
              key={item.to}
              component={RouterNavLink}
              to={item.to}
              end={item.end}
              label={t(item.labelKey)}
              leftSection={<item.icon size={18} />}
            />
          ))}
      </AppShell.Navbar>

      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
