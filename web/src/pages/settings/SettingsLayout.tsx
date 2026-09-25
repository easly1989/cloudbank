import { Badge, Box, Group, Loader, ScrollArea, Stack, Text, Title } from "@mantine/core";
import { Suspense } from "react";
import { IconArrowLeft } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";

import { useAuth } from "../../auth/AuthProvider";
import { DemoChrome } from "../../demo/DemoChrome";
import { TourButton } from "../../onboarding/TourButton";
import { usePageTour } from "../../onboarding/tourContext";
import type { TourId } from "../../onboarding/tours";
import { useWallet } from "../../wallet/WalletProvider";
import { RAIL, SECTION } from "./settingsTheme";
import { SETTINGS_SECTIONS } from "./sections";

// The sections with a tour of their own (#421): General, where the screen as a
// whole is introduced, and Data, where import and export live.
const SECTION_TOURS: Partial<Record<string, TourId>> = { general: "settings", data: "data" };

/**
 * Settings is its own screen, not a page inside the app.
 *
 * The style tile is explicit about this: the sidebar's list of pages is
 * replaced by a rail of settings sections, and the only way back is one link at
 * the top. The reason is that settings is somewhere you go, do a thing and
 * leave — keeping the app's navigation visible invites you to wander off
 * mid-change, and the horizontal tabs this replaces could hold five sections
 * before they wrapped, which is why half of what belongs here was living
 * somewhere else.
 *
 * Sections are routes, so each one is a link you can send someone.
 */
export function SettingsLayout() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { currentWallet } = useWallet();
  const { pathname } = useLocation();
  const sections = SETTINGS_SECTIONS.filter(
    (s) => (!s.adminOnly || user?.isAdmin) && !(__DEMO__ && s.notInDemo),
  );
  const current = sections.find((s) => pathname === `/settings/${s.id}`);
  const tour = current ? SECTION_TOURS[current.id] : undefined;
  usePageTour(tour);

  return (
    <Box className="cb-settings-screen">
      <Box
        component="nav"
        aria-label={t("settings.title")}
        className="cb-sidebar cb-settings-rail"
        data-tour="settings-rail"
        style={{ width: RAIL.width, padding: `${RAIL.padY}px ${RAIL.padX}px` }}
      >
        <Stack gap={RAIL.gap}>
          <Stack gap={RAIL.gap}>
            {/* One way out, and it says where it goes. A bare arrow would not:
                this screen has no other landmark to infer "back" from. */}
            <Text
              component={Link}
              to="/"
              className="cb-settings-back"
              data-tour="settings-back"
              c="dimmed"
              fz={RAIL.back.fz}
              px={RAIL.back.inset}
              style={{ display: "flex", alignItems: "center", gap: RAIL.back.gap }}
            >
              <IconArrowLeft size={14} />
              {t("settings.back")}
            </Text>
            <Title order={1} fz={RAIL.title.fz} fw={RAIL.title.fw} px={RAIL.title.inset}>
              {t("settings.title")}
            </Title>
          </Stack>

          <Stack gap={2}>
            {sections.map((s) => (
              <NavLink
                key={s.id}
                to={`/settings/${s.id}`}
                className="cb-settings-section"
                style={{
                  height: RAIL.item.height,
                  borderRadius: RAIL.item.radius,
                  padding: `${RAIL.item.padY}px ${RAIL.item.padX}px`,
                  gap: RAIL.item.gap,
                  fontSize: RAIL.item.fz,
                }}
              >
                <s.icon size={16} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  {s.id === "wallet" ? (currentWallet?.title ?? t(s.labelKey)) : t(s.labelKey)}
                </span>
              </NavLink>
            ))}
          </Stack>
        </Stack>
      </Box>

      <ScrollArea className="cb-settings-body" style={{ flex: 1, minWidth: 0, height: "100vh" }}>
        <Stack gap={SECTION.gap} p="xl" maw={1100}>
          {__DEMO__ && (
            <div>
              <DemoChrome />
            </div>
          )}
          {current && (
            <Stack gap={6}>
              <Group justify="space-between" wrap="nowrap" gap="sm">
                <Title order={2} fz={SECTION.title.fz} fw={SECTION.title.fw}>
                  {current.id === "wallet"
                    ? (currentWallet?.title ?? t(current.labelKey))
                    : t(current.labelKey)}
                </Title>
                {tour && <TourButton id={tour} size={40} />}
              </Group>
              <Text c="dimmed" fz={SECTION.hint.fz}>
                {t(current.hintKey)}
              </Text>
            </Stack>
          )}
          <Suspense fallback={<Loader />}>
            <Outlet />
          </Suspense>
        </Stack>
      </ScrollArea>
    </Box>
  );
}

/** A heading inside a section, with the line that says what it is for. */
export function SettingsGroup({
  title,
  hint,
  action,
  children,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Stack gap="sm">
      <Group justify="space-between" align="flex-end" wrap="wrap" gap="sm">
        <Stack gap={2} style={{ minWidth: 0, flex: "1 1 auto" }}>
          <Title order={3} fz={SECTION.heading.fz} fw={SECTION.heading.fw}>
            {title}
          </Title>
          {hint && (
            <Text c="dimmed" fz={SECTION.headingHint.fz}>
              {hint}
            </Text>
          )}
        </Stack>
        {action}
      </Group>
      {children}
    </Stack>
  );
}

/** A count beside a section's name, for the ones that carry one. */
export function SectionCount({ value }: { value: number }) {
  return (
    <Badge variant="default" size="sm" radius={RAIL.badge.radius}>
      {value}
    </Badge>
  );
}
