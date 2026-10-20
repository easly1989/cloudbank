import { ActionIcon, Group, Paper, Text, UnstyledButton } from "@mantine/core";
import { IconShare2, IconX } from "@tabler/icons-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * Text shared to CloudBank from another app (#702), such as a bank's
 * notification, shown at the top of the entry sheet to read while filling it
 * in. Nothing is taken from it: without the AI, the reader types the fields.
 */
export function SharedText({ text, onClose }: { text: string; onClose: () => void }) {
  const { t } = useTranslation();
  const [all, setAll] = useState(false);
  return (
    <Paper withBorder radius="md" p="sm" bg="var(--mantine-color-default-hover)">
      <Group justify="space-between" wrap="nowrap" mb={4}>
        <Group gap={6} wrap="nowrap">
          <IconShare2 size={16} color="var(--mantine-color-dimmed)" aria-hidden />
          <Text size="sm" fw={600}>
            {t("transactions.shared.title")}
          </Text>
        </Group>
        <ActionIcon
          variant="subtle"
          color="gray"
          size="sm"
          aria-label={t("transactions.shared.close")}
          onClick={onClose}
        >
          <IconX size={14} />
        </ActionIcon>
      </Group>
      <Text size="sm" lineClamp={all ? undefined : 2} style={{ whiteSpace: "pre-wrap" }}>
        {text}
      </Text>
      {/* shortcut: a length, not a measurement, decides whether it is clamped; measure if it misleads. */}
      {text.length > 80 && (
        <UnstyledButton mt={4} onClick={() => setAll((a) => !a)} aria-expanded={all}>
          <Text size="xs" c="blue">
            {t(all ? "transactions.shared.less" : "transactions.shared.all")}
          </Text>
        </UnstyledButton>
      )}
    </Paper>
  );
}
