import {
  AppShell,
  Box,
  Burger,
  Center,
  Group,
  Loader,
  ScrollArea,
  Stack,
  Text,
  useMantineColorScheme,
} from "@mantine/core";
import { useDisclosure, useMediaQuery } from "@mantine/hooks";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Suspense, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Outlet } from "react-router-dom";

import { updateMe, type User } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { useWallet } from "../wallet/WalletProvider";
import { AppFooter } from "./AppFooter";
import {
  SIDEBAR_BLOCK_GAP,
  SIDEBAR_PAD_X,
  SIDEBAR_PAD_Y,
  SIDEBAR_RAIL_WIDTH,
  SIDEBAR_WIDTH,
} from "./shellTheme";
import { Logo } from "./Logo";
import { SidebarFoot } from "./SidebarFoot";
import { SidebarHead } from "./SidebarHead";
import { SidebarNav } from "./SidebarNav";

export function AppLayout() {
  const [opened, { toggle, close }] = useDisclosure();
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const { currentWallet } = useWallet();
  const qc = useQueryClient();
  const { setColorScheme } = useMantineColorScheme();

  // Desktop sidebar collapse to an icon-only rail, remembered per user. The rail
  // only applies on desktop; the mobile drawer always shows full labels.
  const [collapsed, setCollapsed] = useState(() => user?.preferences?.sidebarCollapsed ?? false);
  const isDesktop = useMediaQuery("(min-width: 48em)");
  const railMode = collapsed && !!isDesktop;
  // On a touch screen the footer leaves the fixed bar for the end of the page.
  // Its links need 44px for a finger (#465), and five of them wrap to two lines
  // on a phone — 88px of permanent bar, where 36 was already cutting the second
  // line off. At the end of the page it costs nothing until it is reached.
  const touch = useMediaQuery("(pointer: coarse)");
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
      // No bar across the top: the style tile puts the product, the wallet and
      // the search at the head of the sidebar, and the page's own actions in
      // its header. A phone still needs somewhere to open the drawer from, so
      // the bar survives there and only there.
      header={{ height: 48, collapsed: !!isDesktop }}
      navbar={{
        width: railMode ? SIDEBAR_RAIL_WIDTH : SIDEBAR_WIDTH,
        breakpoint: "sm",
        collapsed: { mobile: !opened },
      }}
      footer={{ height: 36, collapsed: !!touch }}
      padding="md"
    >
      <AppShell.Header hiddenFrom="sm">
        <Group h="100%" px="md" gap="xs" wrap="nowrap">
          <Burger opened={opened} onClick={toggle} size="sm" aria-label={t("nav.toggleSidebar")} />
          <Logo size={22} />
          <Text fw={700} truncate>
            {currentWallet?.title ?? t("app.name")}
          </Text>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar
        className="cb-sidebar"
        data-tour="nav"
        style={{ padding: `${SIDEBAR_PAD_Y}px ${SIDEBAR_PAD_X}px` }}
      >
        {/* The nav scrolls; the foot does not. Settings is the one
              destination reachable from anywhere, so it must not depend on how
              far down a long list of pages the reader has scrolled. */}
        <Stack h="100%" gap={SIDEBAR_BLOCK_GAP} justify="space-between">
          <SidebarHead railMode={railMode} onToggleCollapse={toggleCollapsed} onNavigate={close} />
          <ScrollArea style={{ flex: 1, minHeight: 0 }} type="scroll">
            <SidebarNav railMode={railMode} onNavigate={close} />
          </ScrollArea>
          <SidebarFoot railMode={railMode} onNavigate={close} onToggleCollapse={toggleCollapsed} />
        </Stack>
      </AppShell.Navbar>

      <AppShell.Main>
        {/* Each page is a lazy chunk; show a loader in the content area (the
              shell stays put) while it loads. */}
        <Suspense
          fallback={
            <Center mih="60vh">
              <Loader />
            </Center>
          }
        >
          <Outlet />
        </Suspense>
        {touch && (
          <Box component="footer" mt="xl" className="cb-footer-inline">
            <AppFooter />
          </Box>
        )}
      </AppShell.Main>

      {!touch && (
        <AppShell.Footer>
          <AppFooter />
        </AppShell.Footer>
      )}
    </AppShell>
  );
}
