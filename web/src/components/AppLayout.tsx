import {
  AppShell,
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
import { OnboardingTourProvider } from "../onboarding/TourProvider";
import { useWallet } from "../wallet/WalletProvider";
import { AppFooter } from "./AppFooter";
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
    <OnboardingTourProvider>
      <AppShell
        // No bar across the top: the style tile puts the product, the wallet and
        // the search at the head of the sidebar, and the page's own actions in
        // its header. A phone still needs somewhere to open the drawer from, so
        // the bar survives there and only there.
        header={{ height: 48, collapsed: !!isDesktop }}
        navbar={{ width: railMode ? 64 : 240, breakpoint: "sm", collapsed: { mobile: !opened } }}
        footer={{ height: 36 }}
        padding="md"
      >
        <AppShell.Header hiddenFrom="sm">
          <Group h="100%" px="md" gap="xs" wrap="nowrap">
            <Burger
              opened={opened}
              onClick={toggle}
              size="sm"
              aria-label={t("nav.toggleSidebar")}
            />
            <Logo size={22} />
            <Text fw={700} truncate>
              {currentWallet?.title ?? t("app.name")}
            </Text>
          </Group>
        </AppShell.Header>

        <AppShell.Navbar p="sm" data-tour="nav">
          {/* The nav scrolls; the foot does not. Settings is the one
              destination reachable from anywhere, so it must not depend on how
              far down a long list of pages the reader has scrolled. */}
          <Stack h="100%" gap="xs" justify="space-between">
            <SidebarHead
              railMode={railMode}
              onToggleCollapse={toggleCollapsed}
              onNavigate={close}
            />
            <ScrollArea style={{ flex: 1, minHeight: 0 }} type="scroll">
              <SidebarNav railMode={railMode} onNavigate={close} />
            </ScrollArea>
            <SidebarFoot railMode={railMode} onNavigate={close} />
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
        </AppShell.Main>

        <AppShell.Footer>
          <AppFooter />
        </AppShell.Footer>
      </AppShell>
    </OnboardingTourProvider>
  );
}
