import { AppShell, Burger, Group, NavLink, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconChartBar, IconLayoutDashboard, IconSettings, IconWallet } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { NavLink as RouterNavLink, Outlet } from "react-router-dom";

import { ColorSchemeToggle } from "./ColorSchemeToggle";
import { LanguageSwitcher } from "./LanguageSwitcher";

const navItems = [
  { to: "/", labelKey: "nav.dashboard", icon: IconLayoutDashboard, end: true },
  { to: "/accounts", labelKey: "nav.accounts", icon: IconWallet, end: false },
  { to: "/reports", labelKey: "nav.reports", icon: IconChartBar, end: false },
  { to: "/settings", labelKey: "nav.settings", icon: IconSettings, end: false },
];

export function AppLayout() {
  const [opened, { toggle }] = useDisclosure();
  const { t } = useTranslation();

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
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="sm">
        {navItems.map((item) => (
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
