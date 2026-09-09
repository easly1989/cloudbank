import { Center, Stack, Text, ThemeIcon } from "@mantine/core";
import { IconInbox } from "@tabler/icons-react";
import type { ComponentType, ReactNode } from "react";

// EmptyState is the shared "nothing here yet" placeholder for list pages: a
// centered icon, a message, and optional hint text or a call-to-action, so every
// empty list reads the same way instead of a bare dimmed line.
export function EmptyState({
  message,
  hint,
  action,
  icon: Icon = IconInbox,
}: {
  message: string;
  hint?: string;
  action?: ReactNode;
  icon?: ComponentType<{ size?: number | string }>;
}) {
  return (
    <Center py="xl">
      <Stack align="center" gap="xs" maw={360} ta="center">
        <ThemeIcon variant="light" color="gray" size={48} radius="xl">
          <Icon size={26} />
        </ThemeIcon>
        <Text c="dimmed">{message}</Text>
        {hint && (
          <Text size="sm" c="dimmed">
            {hint}
          </Text>
        )}
        {action}
      </Stack>
    </Center>
  );
}
