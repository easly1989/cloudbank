import {
  ActionIcon,
  Avatar,
  Box,
  Group,
  Menu,
  Stack,
  Text,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { IconLayoutSidebarLeftCollapse, IconLogout, IconSettings } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { useAuth, useLogout } from "../auth/AuthProvider";
import { DonateButton } from "./DonateButton";
import { FOOT } from "./shellTheme";

// The foot of the sidebar: support, and who you are signed in as.
//
// The gear lives here, beside your name, because that is where the style tile
// put it and because the alternative — a nav entry at the end of the list — is
// below the fold on any 720px laptop, which is the same as not having one. It
// is the one destination you reach from anywhere and rarely twice in a row, so
// it belongs at the edge of the frame rather than in the flow of pages.
//
// The row sits outside the scrolling nav, so it stays put however long the
// list of pages grows.
export function SidebarFoot({
  railMode,
  onNavigate,
  onToggleCollapse,
}: {
  railMode: boolean;
  onNavigate?: () => void;
  onToggleCollapse: () => void;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const logout = useLogout();

  const initials = (user?.username ?? "").slice(0, 2).toUpperCase();
  const gearLabel = t("nav.settings");

  if (railMode) {
    return (
      <Box pt={FOOT.padTop}>
        <Group justify="center" gap={6}>
          <Tooltip label={gearLabel} position="right" withinPortal>
            <ActionIcon
              component={Link}
              to="/settings"
              onClick={onNavigate}
              variant="subtle"
              color="gray"
              size="lg"
              aria-label={gearLabel}
              data-tour="settings"
            >
              <IconSettings size={18} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Box>
    );
  }

  return (
    <Stack gap={FOOT.gap} pt={FOOT.padTop}>
      <DonateButton fullWidth />
      <Group justify="space-between" wrap="nowrap" gap={FOOT.user.gearGap} h={FOOT.user.height}>
        <Menu position="top-start" withinPortal>
          <Menu.Target>
            <UnstyledButton
              className="cb-user-row"
              aria-label={user?.username}
              h={FOOT.user.height}
              fz={FOOT.user.fz}
              px={FOOT.user.inset}
              style={{ minWidth: 0, flex: 1, borderRadius: FOOT.user.radius }}
            >
              <Group gap={FOOT.user.gap} wrap="nowrap">
                <Avatar radius="xl" size={24} color="teal.9" variant="filled">
                  {initials}
                </Avatar>
                <Text fz={FOOT.user.fz} truncate>
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
        <Group gap={2} wrap="nowrap">
          {/* Collapsing the sidebar is chrome, like the gear — it sat in the
              title row and crowded the product name out of its own line. */}
          <Tooltip label={t("nav.toggleSidebar")} withinPortal>
            <ActionIcon
              variant="subtle"
              color="gray"
              size="lg"
              visibleFrom="sm"
              onClick={onToggleCollapse}
              aria-label={t("nav.toggleSidebar")}
            >
              <IconLayoutSidebarLeftCollapse size={18} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label={gearLabel} withinPortal>
            <ActionIcon
              component={Link}
              to="/settings"
              onClick={onNavigate}
              variant="subtle"
              color="gray"
              size="lg"
              aria-label={gearLabel}
              data-tour="settings"
            >
              <IconSettings size={18} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>
    </Stack>
  );
}
