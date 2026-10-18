import {
  ActionIcon,
  Anchor,
  Box,
  Button,
  Divider,
  Drawer,
  Group,
  Indicator,
  Popover,
  ScrollArea,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { IconAlertTriangle, IconBell, IconCalendarDue, IconSettings } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";

import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type AppNotification,
  type NotificationKind,
} from "../api/client";
import { useWallet } from "../wallet/WalletProvider";
import { bellSection, bellWhen, type BellSection } from "./notificationTime";

// The bell (#685): everything CloudBank told the reader in the last 90 days,
// newest first. It sits first among the page header's buttons, beside the
// privacy eye; on a phone it moves to the top bar and opens a sheet from the
// bottom, where a thumb reaches it.

const NOTIFICATIONS_KEY = ["notifications"] as const;

const KIND_ICON: Record<NotificationKind, React.ReactNode> = {
  mail_stopped: <IconAlertTriangle size={16} color="var(--cb-attention)" />,
  mail_unrecognized: <IconAlertTriangle size={16} color="var(--cb-attention)" />,
  bills: <IconCalendarDue size={16} color="var(--mantine-color-dimmed)" />,
};

const SECTIONS: BellSection[] = ["today", "week", "earlier"];

function Panel({ phone, onDone }: { phone: boolean; onDone: () => void }) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { currentWallet, setCurrentWalletId } = useWallet();
  const { data } = useQuery({ queryKey: NOTIFICATIONS_KEY, queryFn: listNotifications });
  const refresh = () => qc.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
  const markOne = useMutation({ mutationFn: markNotificationRead, onSettled: refresh });
  const markAll = useMutation({ mutationFn: markAllNotificationsRead, onSettled: refresh });
  const items = data?.items ?? [];
  const now = new Date();

  const open = (n: AppNotification) => {
    if (!n.read) markOne.mutate(n.id);
    // It is about another wallet: open it there, not in the one on screen.
    if (n.walletId && n.walletId !== currentWallet?.id) setCurrentWalletId(n.walletId);
    onDone();
    if (n.url.startsWith("/")) navigate(n.url);
  };

  return (
    <Stack gap={0} tabIndex={-1} data-autofocus style={{ outline: "none" }}>
      <Group justify="space-between" px={14} py={10}>
        <Text fw={700} fz={16}>
          {t("notif.title")}
        </Text>
        {(data?.unread ?? 0) > 0 && (
          <Button
            size="compact-xs"
            variant="subtle"
            loading={markAll.isPending}
            onClick={() => markAll.mutate()}
          >
            {t("notif.markAll")}
          </Button>
        )}
      </Group>
      <Divider />
      {items.length === 0 ? (
        <Text c="dimmed" fz={14} px={14} py={24} ta="center">
          {t("notif.empty")}
        </Text>
      ) : (
        <ScrollArea.Autosize mah={phone ? "calc(85vh - 120px)" : 460} type="scroll">
          <Stack gap={2} p={6}>
            {SECTIONS.map((section) => {
              const notes = items.filter((n) => bellSection(n.createdAt, now) === section);
              if (notes.length === 0) return null;
              return (
                <Box key={section}>
                  <Text fz={12} c="dimmed" px={12} pt={8} pb={2}>
                    {t(`notif.${section}`)}
                  </Text>
                  {notes.map((n) => (
                    <button key={n.id} type="button" className="cb-note" onClick={() => open(n)}>
                      <span className="cb-note-kind">{KIND_ICON[n.kind]}</span>
                      <Box style={{ minWidth: 0 }}>
                        <Group justify="space-between" gap={8} wrap="nowrap" align="baseline">
                          <Text fz={14} fw={n.read ? 500 : 650} lh={1.3}>
                            {n.title}
                          </Text>
                          <Text fz={12} c="dimmed" style={{ whiteSpace: "nowrap" }}>
                            {bellWhen(n.createdAt, now, i18n.language, t("notif.yesterday"))}
                          </Text>
                        </Group>
                        <Text fz={13} c="dimmed" lh={1.4} lineClamp={2}>
                          {n.body}
                        </Text>
                      </Box>
                      {n.read ? (
                        <span />
                      ) : (
                        <span className="cb-note-dot" role="img" aria-label={t("notif.unread")} />
                      )}
                    </button>
                  ))}
                </Box>
              );
            })}
          </Stack>
        </ScrollArea.Autosize>
      )}
      <Divider />
      <Group px={14} py={10}>
        <Anchor component={Link} to="/settings/notifications" fz="sm" onClick={onDone}>
          <Group gap={6}>
            <IconSettings size={15} />
            {t("notif.settingsLink")}
          </Group>
        </Anchor>
      </Group>
    </Stack>
  );
}

/** The bell. `size` and `variant` match the buttons it sits beside. */
export function NotificationBell({
  size = 40,
  variant = "default",
}: {
  size?: number;
  variant?: "default" | "subtle";
}) {
  const { t } = useTranslation();
  const phone = useMediaQuery("(max-width: 47.99em)") ?? false;
  const [opened, setOpened] = useState(false);
  // A light poll: the bell is on every page, and a reminder written by the
  // daily job should show without a reload.
  const { data } = useQuery({
    queryKey: NOTIFICATIONS_KEY,
    queryFn: listNotifications,
    refetchInterval: 60_000,
  });
  const unread = data?.unread ?? 0;
  const close = () => setOpened(false);

  const button = (
    <Indicator
      label={unread > 99 ? "99+" : unread}
      size={16}
      offset={5}
      color="blue"
      disabled={!unread}
    >
      <ActionIcon
        variant={variant}
        color="gray"
        size={size}
        radius={phone ? "xl" : undefined}
        aria-label={unread ? t("notif.bellLabel", { count: unread }) : t("notif.title")}
        aria-haspopup="dialog"
        aria-expanded={opened}
        onClick={() => setOpened((o) => !o)}
      >
        <IconBell size={18} />
      </ActionIcon>
    </Indicator>
  );

  if (phone) {
    return (
      <>
        {button}
        <Drawer
          opened={opened}
          onClose={close}
          position="bottom"
          size="85%"
          withCloseButton={false}
          padding={0}
          radius="md"
          aria-label={t("notif.title")}
        >
          <Panel phone onDone={close} />
        </Drawer>
      </>
    );
  }
  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      position="bottom-end"
      width={390}
      shadow="md"
      withinPortal
      trapFocus
    >
      <Popover.Target>
        <Tooltip label={t("notif.title")} withinPortal disabled={opened}>
          {button}
        </Tooltip>
      </Popover.Target>
      <Popover.Dropdown p={0} aria-label={t("notif.title")}>
        <Panel phone={false} onDone={close} />
      </Popover.Dropdown>
    </Popover>
  );
}
