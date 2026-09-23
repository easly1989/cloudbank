import { ActionIcon, Group, Paper, ScrollArea, Text } from "@mantine/core";
import { IconX } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

// Filters and columns open beside the ledger, not above it.
//
// Both used to push the transactions down the page: a filter panel that
// unfolded into eight controls, a column list that did the same. Everything
// they took, they took from the rows — and the rows are the page. On the side
// they cost width, which a ledger has to spare, instead of height, which it
// does not.
//
// Below the register's breakpoint it falls back to stacking, because a 320px
// phone has no width to spare either.
export function RegisterSidePanel({
  title,
  hint,
  onClose,
  children,
}: {
  title: string;
  hint?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <Paper withBorder p="sm" w={{ base: "100%", md: 300 }} style={{ flexShrink: 0 }}>
      <Group justify="space-between" wrap="nowrap" mb={hint ? 2 : "xs"}>
        <Text fw={600} size="sm">
          {title}
        </Text>
        <ActionIcon variant="subtle" color="gray" aria-label={t("actions.close")} onClick={onClose}>
          <IconX size={16} />
        </ActionIcon>
      </Group>
      {hint && (
        <Text size="xs" c="dimmed" mb="xs">
          {hint}
        </Text>
      )}
      <ScrollArea.Autosize mah={480} type="auto">
        {children}
      </ScrollArea.Autosize>
    </Paper>
  );
}
