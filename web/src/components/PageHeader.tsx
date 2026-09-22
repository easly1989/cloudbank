import { Group, Stack, Text, Title } from "@mantine/core";
import type { ReactNode } from "react";

// The one page header in the app: what the page is called, optionally a line
// saying what it is for, and the page's own actions on the right.
//
// It exists because the alternative had grown into sixteen slightly different
// headers — the hint above the buttons on one page and below them on the next,
// the title alone on a third — and a reader moving between pages pays for every
// one of those differences without ever being told why.
//
// The actions wrap underneath on a narrow screen rather than squeezing the
// title, which is what keeps the phone layout readable.
export function PageHeader({
  title,
  hint,
  actions,
}: {
  title: string;
  /** One line on what the page is for. Skip it when the title already says. */
  hint?: ReactNode;
  /** Buttons, switches, anything that acts on the page as a whole. */
  actions?: ReactNode;
}) {
  return (
    <Group justify="space-between" align="flex-start" gap="md">
      <Stack gap={2} style={{ minWidth: 0 }}>
        <Title order={2}>{title}</Title>
        {hint && (
          <Text c="dimmed" size="sm" maw={680}>
            {hint}
          </Text>
        )}
      </Stack>
      {actions && (
        <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
          {actions}
        </Group>
      )}
    </Group>
  );
}
