import {
  AppShell,
  Avatar,
  Burger,
  Button,
  Group,
  Menu,
  NavLink,
  Text,
  UnstyledButton,
  useMantineColorScheme,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useEffect } from "react";
import {
  IconArrowsExchange,
  IconCalendarRepeat,
  IconChartBar,
  IconChevronDown,
  IconCoin,
  IconFileImport,
  IconLayoutDashboard,
  IconLogout,
  IconReportMoney,
  IconPlus,
  IconSettings,
  IconTags,
  IconUserDollar,
  IconUsers,
  IconWallet,
  IconWand,
} from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { NavLink as RouterNavLink, Outlet, useNavigate } from "react-router-dom";

import { useAuth, useLogout } from "../auth/AuthProvider";
import { useWallet } from "../wallet/WalletProvider";
import { AppFooter } from "./AppFooter";
import { ColorSchemeToggle } from "./ColorSchemeToggle";
import { LanguageSwitcher } from "./LanguageSwitcher";

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
        <Menu.Item leftSection={<IconTags size={16} />} onClick={() => navigate("/categories")}>
          {t("categories.title")}
        </Menu.Item>
        <Menu.Item leftSection={<IconUserDollar size={16} />} onClick={() => navigate("/payees")}>
          {t("payees.title")}
        </Menu.Item>
        <Menu.Item leftSection={<IconCoin size={16} />} onClick={() => navigate("/currencies")}>
          {t("currencies.title")}
        </Menu.Item>
        <Menu.Item leftSection={<IconSettings size={16} />} onClick={() => navigate("/wallet")}>
          {t("wallet.settings")}
        </Menu.Item>
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
  const { setColorScheme } = useMantineColorScheme();
  const logout = useLogout();

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
      navbar={{ width: 240, breakpoint: "sm", collapsed: { mobile: !opened } }}
      footer={{ height: 36 }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group>
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
            <Text fw={700} size="lg">
              {t("app.name")}
            </Text>
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

      <AppShell.Footer>
        <AppFooter />
      </AppShell.Footer>
    </AppShell>
  );
}
