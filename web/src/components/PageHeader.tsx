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
// On a narrow screen the whole action block drops under the title, and the
// buttons inside it wrap among themselves. Both are needed: the register's
// header carries an account picker and five buttons, and a block that only
// moved down as one piece would still be 400px wider than a phone.
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
    <Group justify="space-between" align="flex-start" gap="md" wrap="wrap">
      <Stack gap={2} style={{ minWidth: 0, flex: "1 1 auto" }}>
        <Title order={2}>{title}</Title>
        {hint && (
          <Text c="dimmed" size="sm" maw={680}>
            {hint}
          </Text>
        )}
      </Stack>
      {actions && (
        <Group gap="xs" wrap="wrap" justify="flex-end" style={{ minWidth: 0 }}>
          {actions}
        </Group>
      )}
    </Group>
  );
}
