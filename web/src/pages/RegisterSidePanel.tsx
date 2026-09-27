import { ActionIcon, Drawer, Group, Paper, ScrollArea, Stack, Text } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
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
// A phone has no width to spare either. There the panel stacked after the
// ledger, off the screen, so opening it seemed to do nothing (#502); it now
// rises from the bottom as a sheet over the ledger, with `footer` — the
// filters' "Show N transactions" — pinned under it.
export function RegisterSidePanel({
  title,
  hint,
  onClose,
  footer,
  children,
}: {
  title: string;
  hint?: string;
  onClose: () => void;
  /** Shown only in the phone's sheet, under the scrolling content. */
  footer?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const phone = useMediaQuery("(max-width: 47.99em)") ?? false;

  if (phone) {
    return (
      <Drawer
        opened
        onClose={onClose}
        position="bottom"
        size="auto"
        title={title}
        closeButtonProps={{ "aria-label": t("actions.close") }}
        styles={{
          content: { maxHeight: "88dvh", display: "flex", flexDirection: "column" },
          body: { flex: 1, minHeight: 0, display: "flex", flexDirection: "column" },
        }}
        data-testid="register-panel-sheet"
      >
        <Stack gap="sm" style={{ flex: 1, minHeight: 0 }}>
          {hint && (
            <Text size="xs" c="dimmed">
              {hint}
            </Text>
          )}
          <ScrollArea.Autosize mah="calc(88dvh - 150px)" type="auto">
            {children}
          </ScrollArea.Autosize>
          {footer}
        </Stack>
      </Drawer>
    );
  }

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
